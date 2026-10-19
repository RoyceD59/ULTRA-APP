import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const retainedInputs = [
  'release-sources.tar.gz', 'release-manifest.json',
  'approved-consistency/candidate.json', 'approved-consistency/release-sources.tar.gz',
  'security-consistency/candidate.json', 'security-consistency/release-sources.tar.gz',
  ...['candidate.json', 'release-sources.tar.gz', 'scope.json', 'owner-approval.json']
    .map(name => `auth-upload-security/${name}`),
  ...['candidate.json', 'release-sources.tar.gz', 'scope.json', 'owner-approval.json']
    .map(name => `security-dependency-review/${name}`),
  ...['candidate.json', 'release-sources.tar.gz', 'scope.json', 'owner-approval.json']
    .map(name => `security-center-cache-review/${name}`),
];
const tools = [
  'auth-upload-security.mjs', 'security-dependency-selection.mjs', 'consistency-handoff.mjs',
  'consistency-security.mjs', 'build-approved-consistency.mjs',
  'security-center-selection.mjs', 'security-patch-installation.mjs', 'prepare-security-center-cache-review.py',
  'prepare-security-center-review.py', 'prepare-security-dependency-review.py',
  'verify-security-center-lock.mjs',
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

function assertRegularFileArchive(fixture, path) {
  const members = execFileSync('tar', ['-tvzf', resolve(fixture.tools, path)], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.ok(members.length > 0, `${path} contains approved archive members`);
  assert.ok(members.every(member => member[0] === '-' || member[0] === 'd'),
    `${path} contains only regular files and directories`);
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
    await symlink(resolve(here, '../../../node_modules'), resolve(root, 'node_modules'), 'dir');
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
        if (file === 'tar' && args.some(arg => /^-[^-]*x/.test(arg) || arg === '--extract')) {
          if (process.env.REJECT_FIXTURE_EXTRACTION === '1') fail('extract');
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
    await assert.rejects(readdir(root), { code: 'ENOENT' }, 'disposable fixture is fully removed');
  }
}

async function rejectsBeforeBuild(fixture, expected, {
  auth = true, noExtraction = false, temporaryEntries = [],
} = {}) {
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
    assert.deepEqual((await readdir(fixture.temporary)).sort(), [...temporaryEntries].sort(),
      'must reject before creating extraction directories');
  }
  for (const dir of ['api-server', 'projecthub']) {
    const output = resolve(fixture.root, 'artifacts', dir, 'dist');
    assert.deepEqual(await readdir(output), ['retained.txt']);
    assert.equal(await readFile(resolve(output, 'retained.txt'), 'utf8'), 'retained-output');
  }
}

async function writePathArchive(fixture, names, { preserveApprovedPaths = false } = {}) {
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
  let bytes = Buffer.concat([...members, Buffer.alloc(1024)]);
  let expected = names;
  if (preserveApprovedPaths) {
    // Keep every approved member intact so rejection cannot be explained by
    // unrelated missing paths. Append only the forged alias, without extraction.
    const original = gunzipSync(await readFile(archive));
    const originalNames = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    const temporary = await mkdtemp(resolve(fixture.root, 'alias-archive-'));
    try {
      const base = resolve(temporary, 'base.tar'), extra = resolve(temporary, 'extra.tar');
      await writeFile(base, original);
      await writeFile(extra, bytes);
      execFileSync('tar', ['--concatenate', '-f', base, extra]);
      bytes = await readFile(base);
      expected = [...originalNames, ...names];
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  await writeFile(archive, gzipSync(bytes));
  // Confirm the fixtures contain the exact offending names, not normalized ones.
  const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').filter(Boolean);
  assert.deepEqual(listed, expected);
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

function tarChecksum(header) {
  header.fill(32, 148, 156);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8)
    .padStart(6, '0') + '\0 ', 148, 8);
}

function paxLinkpath(target, key = 'linkpath') {
  const record = ` ${key}=${target}\n`;
  let length = Buffer.byteLength(record) + 1;
  while (length !== Buffer.byteLength(record) + String(length).length) {
    length = Buffer.byteLength(record) + String(length).length;
  }
  const payload = Buffer.from(`${length}${record}`);
  assert.equal(payload.length, length, 'PAX record length includes its own decimal prefix');
  return payload;
}

function linkMetadata(header, encoding, target) {
  const payload = encoding === 'pax' ? paxLinkpath(target) : Buffer.from(target + '\0');
  const extension = Buffer.from(header);
  extension.fill(0, 0, 100);
  extension.write(encoding === 'pax' ? 'PaxHeaders/link' : '././@LongLink', 0, 100);
  extension.fill(0, 345, 500); // No inherited member prefix.
  extension.write(payload.length.toString(8).padStart(11, '0') + '\0', 124, 12);
  extension.write(encoding === 'pax' ? 'x' : 'K', 156, 1);
  extension.fill(0, 157, 257);
  tarChecksum(extension);
  const padded = Buffer.alloc(Math.ceil(payload.length / 512) * 512);
  payload.copy(padded);
  return Buffer.concat([extension, padded]);
}

async function writeLinkArchive(fixture, type, target, encoding = 'ustar') {
  // Replace one real member, keeping the exact approved path set. An archive
  // consisting only of a malicious link would stop at the path-delta guard
  // and would not tell us whether link targets get checked before extraction.
  const archive = resolve(fixture.tools, archivePath);
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  const original = gunzipSync(await readFile(archive));
  const member = 'artifacts/uc-companion/app.json';
  const chunks = [];
  let replaced = 0;
  assert.ok(['1', '2'].includes(type), 'ustar hard-link or symbolic-link type');
  assert.ok(['ustar', 'pax', 'gnu'].includes(encoding), 'supported link fixture encoding');
  if (encoding === 'ustar') assert.ok(Buffer.byteLength(target) <= 100, 'link target fits ustar header');
  else assert.ok(Buffer.byteLength(target) > 100, 'extended target cannot fit in literal linkname');
  const literalTarget = encoding === 'ustar' ? target : 'harmless-short-target';
  for (let offset = 0; offset < original.length;) {
    const header = original.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      chunks.push(original.subarray(offset));
      break;
    }
    const text = (start, end) => header.subarray(start, end).toString().split('\0')[0];
    const name = [text(345, 500), text(0, 100)].filter(Boolean).join('/');
    const size = parseInt(text(124, 136).trim(), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0, 'ordinary octal ustar size');
    const end = offset + 512 + Math.ceil(size / 512) * 512;
    assert.ok(end <= original.length, 'complete tar member');
    if (name === member) {
      assert.equal(text(156, 157), '0', 'replace a regular file, not an extension header');
      const link = Buffer.from(header);
      link.write('00000000000\0', 124, 12); // Links carry no file payload.
      link.write(type, 156, 1);
      link.fill(0, 157, 257);
      link.write(literalTarget, 157, 100);
      tarChecksum(link);
      assert.equal(link.subarray(157, 257).toString().split('\0')[0], literalTarget);
      // Only the extension contains the unsafe destination. A checker that
      // reads the literal ustar linkname alone would see a harmless relative name.
      if (encoding !== 'ustar') chunks.push(linkMetadata(header, encoding, target));
      chunks.push(link);
      replaced++;
    } else chunks.push(original.subarray(offset, end));
    offset = end;
  }
  assert.equal(replaced, 1, 'exactly one link member replaces an approved path');
  await writeFile(archive, gzipSync(Buffer.concat(chunks)));
  assert.equal(execFileSync('tar', ['-tzf', archive, '-P'], { encoding: 'utf8' }), names,
    'link fixture preserves every approved member name and order');
  // Listing only: GNU tar otherwise strips absolute/../ hard-link targets
  // from its display. Never give -P to an extraction command.
  const verbose = execFileSync('tar', ['-tzvf', archive, '-P'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).split('\n').find(line => line.includes(` ${member} `));
  assert.ok(verbose?.startsWith(type === '2' ? 'l' : 'h'), 'tar recognizes the link type');
  assert.ok(verbose.endsWith(target), 'tar resolves the effective external link target');
}

async function writeLongNameArchive(fixture, effectiveName, encoding) {
  // Keep the approved member's literal ustar name and payload, and let only a
  // PAX `path` or GNU `L` extension header supply the unsafe effective name.
  // A checker that reads the literal header name alone would see an approved path.
  assert.ok(['pax', 'gnu'].includes(encoding), 'supported long-name fixture encoding');
  assert.ok(Buffer.byteLength(effectiveName) > 100, 'extended name cannot fit in the literal ustar name');
  const archive = resolve(fixture.tools, archivePath);
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const original = gunzipSync(await readFile(archive));
  const member = 'artifacts/uc-companion/app.json';
  const chunks = [];
  let replaced = 0;
  for (let offset = 0; offset < original.length;) {
    const header = original.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      chunks.push(original.subarray(offset));
      break;
    }
    const text = (start, end) => header.subarray(start, end).toString().split('\0')[0];
    const name = [text(345, 500), text(0, 100)].filter(Boolean).join('/');
    const size = parseInt(text(124, 136).trim(), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0, 'ordinary octal ustar size');
    const end = offset + 512 + Math.ceil(size / 512) * 512;
    assert.ok(end <= original.length, 'complete tar member');
    if (name === member) {
      assert.equal(text(156, 157), '0', 'override a regular file, not an extension header');
      const payload = encoding === 'pax' ? paxLinkpath(effectiveName, 'path') : Buffer.from(effectiveName + '\0');
      const extension = Buffer.from(header);
      extension.fill(0, 0, 100);
      extension.write(encoding === 'pax' ? 'PaxHeaders/name' : '././@LongLink', 0, 100);
      extension.fill(0, 345, 500);
      extension.write(payload.length.toString(8).padStart(11, '0') + '\0', 124, 12);
      extension.write(encoding === 'pax' ? 'x' : 'L', 156, 1);
      extension.fill(0, 157, 257);
      tarChecksum(extension);
      const padded = Buffer.alloc(Math.ceil(payload.length / 512) * 512);
      payload.copy(padded);
      chunks.push(extension, padded, original.subarray(offset, end));
      replaced++;
    } else chunks.push(original.subarray(offset, end));
    offset = end;
  }
  assert.equal(replaced, 1, 'exactly one approved member receives the unsafe effective name');
  await writeFile(archive, gzipSync(Buffer.concat(chunks)));
  const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').filter(Boolean);
  assert.deepEqual(listed, names.map(name => name === member ? effectiveName : name),
    'tar lists the effective unsafe name in the approved member position');
  assert.ok(!listed.includes(member), 'the harmless literal name is no longer the effective name');
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
  const originals = new Map(await Promise.all([...retainedInputs, ...tools, 'wrangler.jsonc'].map(async name =>
    [name, digest(await readFile(resolve(here, name)))])));
  try {
    await t.test('approved regular-file archives pass both verifiers', () => withFixture(async fixture => {
      assertRegularFileArchive(fixture, archivePath);
      assertRegularFileArchive(fixture, 'security-consistency/release-sources.tar.gz');
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
    for (const alias of [
      './artifacts/uc-companion/app.json',
      'artifacts/./uc-companion/app.json',
      'artifacts//uc-companion/app.json',
      'artifacts/uc-companion//app.json',
    ]) {
      await t.test(`distinct member names resolve to one file: ${alias}`, () => withFixture(async fixture => {
        const canonical = 'artifacts/uc-companion/app.json';
        assert.notEqual(alias, canonical, 'not a literal duplicate-name fixture');
        assert.equal(resolve(fixture.root, alias), resolve(fixture.root, canonical),
          'both literal member names target the same extracted file');
        const rootEntries = await readdir(fixture.root);
        await writePathArchive(fixture, [alias], { preserveApprovedPaths: true });
        await rejectsBeforeBuild(fixture, mismatch, { noExtraction: true });
        await repinFixtureEnvelope(fixture);
        // The production verifier compares literal names to the approved path
        // set. It rejects these aliases as a path delta, not a raw-name duplicate.
        await rejectsBeforeBuild(fixture, /^Error: Unapproved archive path delta$/m,
          { noExtraction: true });
        assert.deepEqual(await readdir(fixture.root), rootEntries, 'no aliased extraction output');
      }));
    }
    for (const encoding of ['pax', 'gnu']) {
      for (const absolute of [true, false]) {
        await t.test(`${encoding} long member name with ${absolute ? 'absolute' : 'parent-traversal'} path is rejected before extraction`,
        () => withFixture(async fixture => {
          const filename = `${'extended-path-target-'.repeat(6)}.txt`;
          const sentinel = resolve(absolute ? fixture.root : fixture.temporary, filename);
          const effectiveName = absolute ? sentinel : `../../${filename}`;
          const extractionRoot = resolve(fixture.temporary, 'auth-upload-scope-fixture', 'after');
          assert.equal(resolve(extractionRoot, effectiveName), sentinel,
            'effective member destination is fixture-owned and outside the extraction root');
          assert.ok(!sentinel.startsWith(extractionRoot + '/'));
          await writeLongNameArchive(fixture, effectiveName, encoding);
          await rejectsBeforeBuild(fixture, mismatch, { noExtraction: true });
          await repinFixtureEnvelope(fixture);
          await writeFile(sentinel, 'external-member-target-must-not-change\n');
          const rootEntries = await readdir(fixture.root);
          // Require the path preflight error, not tar's extraction behavior. All
          // extraction is blocked by the probe if this gate regresses.
          await rejectsBeforeBuild(fixture, /^Error: Unsafe archive paths$/m, {
            noExtraction: true,
            temporaryEntries: absolute ? [] : [filename],
          });
          assert.equal(await readFile(sentinel, 'utf8'), 'external-member-target-must-not-change\n');
          assert.deepEqual(await readdir(fixture.root), rootEntries,
            'verifier rejects the name without creating extraction or build output');
          for (const dir of ['api-server', 'projecthub']) {
            const output = resolve(fixture.root, 'artifacts', dir, 'dist');
            assert.deepEqual(await readdir(output), ['retained.txt']);
            assert.equal(await readFile(resolve(output, 'retained.txt'), 'utf8'), 'retained-output');
          }
        }));
      }
    }
    for (const [kind, type, parentTraversal] of [
      ['symbolic', '2', '../../../../'],
      ['hard', '1', '../../'],
    ]) {
      for (const encoding of ['ustar', 'pax', 'gnu']) {
        for (const absolute of [true, false]) {
          await t.test(`${encoding} ${kind} link with ${absolute ? 'absolute' : 'relative'} external target is rejected before extraction`,
          () => withFixture(async fixture => {
            const filename = encoding === 'ustar' ? 'link-target.txt'
              : `${'extended-link-target-'.repeat(6)}.txt`;
            const sentinel = resolve(absolute ? fixture.root : fixture.temporary, filename);
            const target = absolute ? sentinel : parentTraversal + filename;
            const extractionRoot = resolve(fixture.temporary, 'auth-upload-scope-fixture', 'after');
            const targetBase = kind === 'symbolic'
              ? resolve(extractionRoot, 'artifacts/uc-companion') : extractionRoot;
            assert.equal(resolve(targetBase, target), sentinel,
              'effective link destination is fixture-owned and outside the extraction root');
            assert.ok(!sentinel.startsWith(extractionRoot + '/'));
            await writeLinkArchive(fixture, type, target, encoding);
            await rejectsBeforeBuild(fixture, mismatch, { noExtraction: true });
            await repinFixtureEnvelope(fixture);
            await writeFile(sentinel, 'external-link-target-must-not-change\n');
            const rootEntries = await readdir(fixture.root);
            // Require the hardened verifier's link-type error. A tar warning,
            // extraction refusal, path-delta error or byte mismatch is not
            // evidence of preflight protection. All extraction (including the
            // safe predecessor) is blocked by the probe if this gate regresses.
            await rejectsBeforeBuild(fixture,
              new RegExp(`Unsafe archive links: ${kind} links are prohibited regardless of target`), {
                noExtraction: true,
                temporaryEntries: absolute ? [] : [filename],
              });
            assert.equal(await readFile(sentinel, 'utf8'), 'external-link-target-must-not-change\n');
            assert.deepEqual(await readdir(fixture.root), rootEntries,
              'verifier rejects the link without creating extraction or build output');
            for (const dir of ['api-server', 'projecthub']) {
              const output = resolve(fixture.root, 'artifacts', dir, 'dist');
              assert.deepEqual(await readdir(output), ['retained.txt']);
              assert.equal(await readFile(resolve(output, 'retained.txt'), 'utf8'), 'retained-output');
            }
          }));
        }
      }
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
