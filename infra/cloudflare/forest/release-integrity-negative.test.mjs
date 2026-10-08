import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const retainedInputs = [
  'release-sources.tar.gz', 'release-manifest.json',
  'approved-consistency/candidate.json', 'approved-consistency/release-sources.tar.gz',
  'security-consistency/candidate.json', 'security-consistency/release-sources.tar.gz',
  ...['candidate.json', 'release-sources.tar.gz', 'scope.json', 'owner-approval.json']
    .map(name => `auth-upload-security/${name}`),
];
const tools = [
  'auth-upload-security.mjs', 'consistency-handoff.mjs',
  'consistency-security.mjs', 'build-approved-consistency.mjs',
];
const archivePath = 'auth-upload-security/release-sources.tar.gz';
const scopePath = 'auth-upload-security/scope.json';
const approvalPath = 'auth-upload-security/owner-approval.json';
const mismatch = /Auth\/upload archive or reviewed byte scope mismatch/;
const approvalMismatch = /Approved candidate or retained predecessor checksum mismatch/;
const json = async (fixture, path) => JSON.parse(await readFile(resolve(fixture.tools, path)));
async function changeJson(fixture, path, change) {
  const value = await json(fixture, path);
  change(value);
  await writeFile(resolve(fixture.tools, path), JSON.stringify(value, null, 2) + '\n');
}

async function withFixture(run) {
  const root = await mkdtemp(resolve(tmpdir(), 'release-integrity-negative-'));
  const fixture = { root, tools: resolve(root, 'infra/cloudflare/forest') };
  try {
    for (const name of [...tools, ...retainedInputs]) {
      const destination = resolve(fixture.tools, name);
      await mkdir(dirname(destination), { recursive: true });
      // Copy bytes, never hard-link inputs that corruption tests will overwrite.
      await cp(resolve(here, name), destination);
    }
    fixture.probe = resolve(root, 'probe.mjs');
    fixture.effects = resolve(root, 'unexpected-effects.txt');
    fixture.temporary = resolve(root, 'temporary');
    await mkdir(fixture.temporary);
    // A missing/late integrity gate must not actually install, compile, fetch,
    // or copy output even when a negative test regresses.
    await writeFile(fixture.probe, `
      import childProcess from 'node:child_process';
      import fs from 'node:fs';
      import promises from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const fail = operation => {
        fs.appendFileSync(${JSON.stringify(fixture.effects)}, operation + '\\n');
        throw new Error('UNEXPECTED_BUILD_EFFECT: ' + operation);
      };
      childProcess.spawn = () => fail('spawn');
      const execFileSync = childProcess.execFileSync;
      childProcess.execFileSync = (file, args, ...rest) => {
        if (process.env.REJECT_FIXTURE_EXTRACTION === '1' && file === 'tar'
            && args.some(arg => /^-[^-]*x/.test(arg) || arg === '--extract')) {
          fail('extract');
        }
        return execFileSync(file, args, ...rest);
      };
      promises.cp = async () => fail('copy-output');
      globalThis.fetch = async () => fail('fetch');
      syncBuiltinESMExports();
    `);
    for (const dir of ['api-server', 'projecthub']) {
      await mkdir(resolve(root, 'artifacts', dir, 'dist'), { recursive: true });
      await writeFile(resolve(root, 'artifacts', dir, 'dist/retained.txt'), 'retained-output');
    }
    await run(fixture);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function rejectsBeforeBuild(fixture, expected, { auth = true, noExtraction = false } = {}) {
  const env = {
    ...process.env, TMPDIR: fixture.temporary,
    REJECT_FIXTURE_EXTRACTION: noExtraction ? '1' : '0',
  };
  // Import fresh modules in each process: no module cache masks modified inputs.
  for (const [module, verifier] of [
    ...(auth ? [['auth-upload-security.mjs', 'verifyAuthUploadRevision']] : []),
    ['consistency-handoff.mjs', 'verifyHandoff'],
  ]) {
    const result = spawnSync(process.execPath, ['--import', fixture.probe, '--input-type=module', '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(resolve(fixture.tools, module)).href)});
       await m.${verifier}();`], {
      cwd: fixture.root, env, encoding: 'utf8', timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, `${verifier}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, expected, verifier);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_BUILD_EFFECT/);
  }
  for (const args of [['api', '--local-only'], ['api', '--copy-output'], ['hub', '--copy-output']]) {
    const result = spawnSync(process.execPath, ['--import', fixture.probe,
      resolve(fixture.tools, 'build-approved-consistency.mjs'), ...args], {
      cwd: fixture.root, env, encoding: 'utf8', timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, `${args}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, expected, args.join(' '));
    assert.doesNotMatch(result.stderr, /UNEXPECTED_BUILD_EFFECT/);
  }
  assert.ok(!(await readdir(fixture.root)).includes('.consistency-build'), 'must reject before staging');
  assert.ok(!(await readdir(fixture.root)).includes('unexpected-effects.txt'), 'no build or network effects');
  if (noExtraction) {
    assert.deepEqual(await readdir(fixture.temporary), [], 'must reject before creating extraction directories');
  }
  for (const dir of ['api-server', 'projecthub']) {
    const output = resolve(fixture.root, 'artifacts', dir, 'dist');
    assert.deepEqual(await readdir(output), ['retained.txt']);
    assert.equal(await readFile(resolve(output, 'retained.txt'), 'utf8'), 'retained-output');
  }
}

async function writePathArchive(fixture, names) {
  // Construct literal ustar members: tar's creation CLI otherwise normalizes
  // absolute/traversal names. Payloads and any potential destinations stay
  // disposable; the subprocess probe blocks extraction even if the guard regresses.
  const members = names.map(name => {
    assert.ok(Buffer.byteLength(name) <= 100, 'fixture name fits ustar header');
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    for (const [offset, width, value] of [
      [100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, 1], [136, 12, 0],
    ]) {
      header.write(value.toString(8).padStart(width - 1, '0') + '\0', offset, width);
    }
    header.fill(32, 148, 156);
    header.write('0', 156); // Regular file.
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    const payload = Buffer.alloc(512);
    payload[0] = 120;
    return Buffer.concat([header, payload]);
  });
  const archive = resolve(fixture.tools, archivePath);
  await writeFile(archive, gzipSync(Buffer.concat([...members, Buffer.alloc(1024)])));
  // Confirm the fixtures contain the exact offending names, not normalized ones.
  const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').filter(Boolean);
  assert.deepEqual(listed, names);
}

async function alterArchive(fixture, mutate) {
  const extracted = resolve(fixture.root, 'extracted');
  await mkdir(extracted);
  const archive = resolve(fixture.tools, archivePath);
  const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  execFileSync('tar', ['-xzf', archive, '-C', extracted]);
  await mutate(extracted, paths);
  // Preserve the original explicit path list rather than adding directory entries.
  const list = resolve(fixture.root, 'paths.txt');
  await writeFile(list, paths.join('\n') + '\n');
  execFileSync('tar', ['-czf', archive, '-C', extracted, '-T', list]);
}

async function repinFixtureScope(fixture) {
  // TEST ONLY: allow a forged review record through its outer checksum gate.
  // Candidate archives, candidate metadata and release selections stay untouched.
  const scopeHash = digest(await readFile(resolve(fixture.tools, scopePath)));
  await changeJson(fixture, approvalPath, value => { value.scopeSha256 = scopeHash; });
  const module = resolve(fixture.tools, 'auth-upload-security.mjs');
  const source = await readFile(module, 'utf8');
  assert.match(source, /export const SCOPE_SHA256 = '[a-f0-9]{64}'/);
  await writeFile(module, source
    .replace(/(export const SCOPE_SHA256 = ')[a-f0-9]{64}/, `$1${scopeHash}`));
}

async function repinFixtureEnvelope(fixture) {
  // TEST ONLY: move outer pins together so deliberately corrupted contents
  // reach the independent byte-scope/path guards. Never modify production tools,
  // review file hashes/lengths, or the retained source/rollback inputs.
  const candidate = digest(await readFile(resolve(fixture.tools, archivePath)));
  await changeJson(fixture, scopePath, value => { value.candidateSha256 = candidate; });
  await changeJson(fixture, 'auth-upload-security/candidate.json', value => {
    value.candidateSha256 = candidate;
  });
  await changeJson(fixture, approvalPath, value => {
    value.candidateSha256 = candidate;
  });
  const module = resolve(fixture.tools, 'auth-upload-security.mjs');
  const source = await readFile(module, 'utf8');
  await writeFile(module, source
    .replace(/(export const AUTH_UPLOAD_CANDIDATE = ')[a-f0-9]{64}/, `$1${candidate}`));
  await repinFixtureScope(fixture);
}

test('corrupted release inputs fail closed in isolated copies', async t => {
  const originals = new Map(await Promise.all(retainedInputs.map(async name =>
    [name, digest(await readFile(resolve(here, name)))])));
  try {
    await t.test('unmodified disposable copies pass both verifiers', () => withFixture(async fixture => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const auth = await import(${JSON.stringify(pathToFileURL(resolve(fixture.tools, 'auth-upload-security.mjs')).href)});
        const handoff = await import(${JSON.stringify(pathToFileURL(resolve(fixture.tools, 'consistency-handoff.mjs')).href)});
        await auth.verifyAuthUploadRevision();
        await handoff.verifyHandoff();
      `], { cwd: fixture.root, encoding: 'utf8', timeout: 30_000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    }));
    for (const path of [archivePath, 'security-consistency/release-sources.tar.gz',
      'approved-consistency/release-sources.tar.gz', 'release-sources.tar.gz']) {
      await t.test(`one changed archive byte: ${path}`, () => withFixture(async fixture => {
        const file = resolve(fixture.tools, path);
        const bytes = await readFile(file);
        bytes[Math.floor(bytes.length / 2)] ^= 1;
        await writeFile(file, bytes);
        const auth = [archivePath, 'security-consistency/release-sources.tar.gz'].includes(path);
        await rejectsBeforeBuild(fixture, auth ? mismatch : approvalMismatch, { auth });
      }));
    }
    await t.test('altered reviewed scope hash', () => withFixture(async fixture => {
      await changeJson(fixture, scopePath, value => { value.files[0].afterSha256 = '0'.repeat(64); });
      await rejectsBeforeBuild(fixture, mismatch);
    }));
    for (const field of ['beforeSha256', 'beforeBytes', 'afterBytes', 'unchangedParentFiles']) {
      await t.test(`forged review record: ${field}`, () => withFixture(async fixture => {
        const scope = await json(fixture, scopePath);
        const file = scope.files[0];
        assert.ok(file.beforeSha256 && file.beforeBytes > 0 && file.afterBytes > 0,
          'use an existing changed file so each forged field independently mismatches');
        await changeJson(fixture, scopePath, value => {
          if (field === 'unchangedParentFiles') value[field]++;
          else if (field === 'beforeSha256') {
            value.files[0][field] = (file[field][0] === '0' ? '1' : '0') + file[field].slice(1);
          } else value.files[0][field]++;
        });
        // First confirm the unchanged outer pins reject the forged scope.
        await rejectsBeforeBuild(fixture, mismatch);
        // Advance only disposable scope pins, leaving every archive byte and
        // all other review fields intact, to exercise the independent guard.
        await repinFixtureScope(fixture);
        const expected = field === 'unchangedParentFiles'
          ? /^Error: Unchanged parent file count mismatch$/m
          : new RegExp(`^Error: Unapproved security bytes: ${file.path.replaceAll('.', '\\.')}\\s*$`, 'm');
        await rejectsBeforeBuild(fixture, expected);
      }));
    }
    for (const [name, members] of [
      ['absolute member path', fixture => [resolve(fixture.root, 'absolute-escape.txt')]],
      ['parent-directory traversal', () => ['../parent-escape.txt']],
      ['nested parent-directory traversal', () => ['artifacts/../../parent-escape.txt']],
      ['duplicate member names', () => ['artifacts/uc-companion/app.json', 'artifacts/uc-companion/app.json']],
    ]) {
      await t.test(name, () => withFixture(async fixture => {
        const rootEntries = await readdir(fixture.root);
        await writePathArchive(fixture, members(fixture));
        await rejectsBeforeBuild(fixture, mismatch, { noExtraction: true });
        await repinFixtureEnvelope(fixture);
        await rejectsBeforeBuild(fixture, /Unsafe archive paths/, { noExtraction: true });
        assert.deepEqual(await readdir(fixture.root), rootEntries, 'no escaped extraction output');
      }));
    }
    for (const [key, value] of [
      ['candidateSha256', '0'.repeat(64)], ['scopeSha256', '0'.repeat(64)],
      ['selectionApproved', false], ['publicationApproved', true],
    ]) {
      await t.test(`owner approval mismatch: ${key}`, () => withFixture(async fixture => {
        await changeJson(fixture, approvalPath, approval => { approval[key] = value; });
        await rejectsBeforeBuild(fixture, approvalMismatch, { auth: false });
      }));
    }
    for (const [name, mutate, expected] of [
      ...[
        'artifacts/api-server/src/routes/uc.ts',
        'artifacts/api-server/src/tests/jwt-session-expiry.test.ts',
        'artifacts/api-server/src/routes/uc-impact.ts',
      ].map(path => [`unexpected byte: ${path}`, async extracted => {
        const file = resolve(extracted, path);
        const bytes = await readFile(file);
        bytes[0] ^= 1; // Same length: byte identity, not size alone, must be checked.
        await writeFile(file, bytes);
      }, new RegExp(`${path.includes('uc-impact') ? 'Unrelated frozen byte change' : 'Unapproved security bytes'}: ${path.replaceAll('.', '\\.')}`)]),
      ['extra path', async (extracted, paths) => {
        const path = 'artifacts/api-server/src/tests/unapproved.test.ts';
        await writeFile(resolve(extracted, path), '// unapproved fixture\n');
        paths.push(path);
      }, /Unapproved archive path delta/],
      ['missing reviewed path', async (extracted, paths) => {
        const path = 'artifacts/api-server/src/tests/jwt-session-expiry.test.ts';
        paths.splice(paths.indexOf(path), 1);
        await rm(resolve(extracted, path));
      }, /Unapproved archive path delta/],
      ['missing frozen path', async (extracted, paths) => {
        const path = 'artifacts/uc-companion/app.json';
        paths.splice(paths.indexOf(path), 1);
        await rm(resolve(extracted, path));
      }, /Unapproved archive path delta/],
    ]) {
      await t.test(name, () => withFixture(async fixture => {
        await alterArchive(fixture, mutate);
        await rejectsBeforeBuild(fixture, mismatch);
        await repinFixtureEnvelope(fixture);
        await rejectsBeforeBuild(fixture, expected);
      }));
    }
  } finally {
    for (const [name, hash] of originals) {
      assert.equal(digest(await readFile(resolve(here, name))), hash, `real retained input unchanged: ${name}`);
    }
  }
});
