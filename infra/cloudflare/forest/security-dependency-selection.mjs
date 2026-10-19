import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AUTH_UPLOAD_CANDIDATE, authUploadArchive, paths, preflightArchiveMembers } from './auth-upload-security.mjs';

export const SECURITY_DEPENDENCY_CANDIDATE = '1e4c4a6ab52703298db9b4b460cc7faed8ccd796a672f46a9b8baa6c905e9af0';
export const SECURITY_DEPENDENCY_SCOPE = '4ee4d0f8c6741da1fd5e7b5c840286ec79214d6f561662ed3a85f332fc546cb6';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
export const securityDependencyArchive = resolve(here, 'security-dependency-review/release-sources.tar.gz');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const changedPaths = ['artifacts/api-server/package.json', 'package.json', 'pnpm-lock.yaml'];

/** Separate selection approval from unchanged preparation and prior approvals. */
export async function verifySecurityDependencySelection() {
  const before = await readFile(authUploadArchive);
  const after = await readFile(securityDependencyArchive);
  const scopeBytes = await readFile(resolve(here, 'security-dependency-review/scope.json'));
  const scope = JSON.parse(scopeBytes);
  const meta = JSON.parse(await readFile(resolve(here, 'security-dependency-review/candidate.json')));
  const approval = JSON.parse(await readFile(resolve(here, 'security-dependency-review/owner-approval.json')));
  if (digest(before) !== AUTH_UPLOAD_CANDIDATE || digest(after) !== SECURITY_DEPENDENCY_CANDIDATE
      || digest(scopeBytes) !== SECURITY_DEPENDENCY_SCOPE
      || scope.parentSha256 !== AUTH_UPLOAD_CANDIDATE || scope.candidateSha256 !== SECURITY_DEPENDENCY_CANDIDATE
      || meta.parentSha256 !== AUTH_UPLOAD_CANDIDATE || meta.candidateSha256 !== SECURITY_DEPENDENCY_CANDIDATE
      || meta.scopeSha256 !== SECURITY_DEPENDENCY_SCOPE
      || approval.candidateSha256 !== SECURITY_DEPENDENCY_CANDIDATE || approval.scopeSha256 !== SECURITY_DEPENDENCY_SCOPE
      || approval.selectionApproved !== true || approval.publicationApproved !== false
      || approval.clientAdvancementApproved !== false || approval.testedBackportMitigationsAccepted !== true) {
    throw new Error('Security dependency selection checksum or owner approval mismatch');
  }
  assert.deepEqual(scope.changedPaths, changedPaths);
  assert.deepEqual(meta.changedPaths, changedPaths);
  assert.deepEqual(scope.files.map(file => file.path), changedPaths);
  for (const bytes of [before, after]) preflightArchiveMembers(bytes);
  assert.deepEqual(paths(before), paths(after), 'Unrelated archive path delta');
  const temporary = await mkdtemp(resolve(tmpdir(), 'security-dependency-selection-'));
  let unchanged = 0;
  try {
    for (const [name, bytes] of [['before', before], ['after', after]]) {
      await mkdir(resolve(temporary, name));
      execFileSync('tar', ['-xzf', '-', '--same-permissions', '-C', resolve(temporary, name)], { input: bytes });
    }
    const changed = new Map(scope.files.map(file => [file.path, file]));
    for (const path of paths(after)) {
      const oldPath = resolve(temporary, 'before', path), newPath = resolve(temporary, 'after', path);
      const a = await readFile(oldPath), b = await readFile(newPath), entry = changed.get(path);
      assert.equal((await stat(oldPath)).mode & 0o7777, (await stat(newPath)).mode & 0o7777, `Mode changed: ${path}`);
      if (entry) {
        assert.equal(entry.beforeSha256, digest(a));
        assert.equal(entry.afterSha256, digest(b));
        assert.equal(entry.beforeBytes, a.length);
        assert.equal(entry.afterBytes, b.length);
        assert.ok(!a.equals(b));
      } else {
        assert.ok(a.equals(b), `Unrelated frozen byte change: ${path}`);
        unchanged++;
      }
    }
    assert.equal(unchanged, 1261);
    assert.equal(scope.unchangedParentFiles, unchanged);
    assert.equal(meta.unchangedParentFiles, unchanged);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { ...meta, selectionApproved: true, publicationApproved: false };
}

/** Sharp is external: pinned frozen source must also have a fixed main runtime. */
export async function verifyMainSecurityRuntimePins() {
  const require = createRequire(resolve(root, 'artifacts/api-server/package.json'));
  assert.equal(require('sharp').versions.sharp, '0.35.5');
  assert.equal(require('sharp').versions.rsvg, '2.63.2');
  const qr = createRequire(require.resolve('react-native-qrcode-svg'));
  const native = createRequire(qr.resolve('react-native'));
  const devtools = createRequire(native.resolve('react-devtools-core'));
  assert.match(devtools.resolve('shell-quote'), /shell-quote@1\.11\.0/);
  const baileys = createRequire(require.resolve('@whiskeysockets/baileys'));
  const entry = baileys.resolve('music-metadata');
  assert.equal(JSON.parse(await readFile(resolve(dirname(entry), '../package.json'))).version, '11.16.0');
  const main = JSON.parse(await readFile(resolve(root, 'package.json')));
  const api = JSON.parse(await readFile(resolve(root, 'artifacts/api-server/package.json')));
  assert.equal(api.dependencies.sharp, '0.35.5');
  assert.equal(main.pnpm.overrides['shell-quote'], '1.11.0');
  assert.equal(main.pnpm.overrides['music-metadata'], '11.16.0');
  return { sharp: '0.35.5', librsvg: '2.63.2', 'shell-quote': '1.11.0', 'music-metadata': '11.16.0' };
}
