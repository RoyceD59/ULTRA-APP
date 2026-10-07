import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const AUTH_UPLOAD_CANDIDATE = '88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82';
export const DEPENDENCY_CANDIDATE = 'b3a298f2e19090a5da3b98a0c0b320cde8afe733f80430af48bfc9a24183921c';
export const SCOPE_SHA256 = '77d02aaad9d235d01a87c3eeb4ba50f72f1d26c13ba145ac86717c4d7c443c0d';
const here = dirname(fileURLToPath(import.meta.url));
export const authUploadArchive = resolve(here, 'auth-upload-security/release-sources.tar.gz');
export const dependencyArchive = resolve(here, 'security-consistency/release-sources.tar.gz');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const SECURITY_FIXTURE_GLOB = 'src/tests/{jwt-session-expiry,customer-count-auth,review-media-signature,storage-public-media-security,storage-upload-allowlist}.test.ts';

function paths(archive) {
  const list = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean);
  if (list.some(path => path.startsWith('/') || path.split('/').includes('..'))
      || new Set(list).size !== list.length) throw new Error('Unsafe archive paths');
  return list.filter(path => !path.endsWith('/')).sort();
}

/** Pin both the complete archive and its byte-by-byte scope, not an allowlist alone. */
export async function verifyAuthUploadRevision() {
  const scopeBytes = await readFile(resolve(here, 'auth-upload-security/scope.json'));
  const scope = JSON.parse(scopeBytes);
  const info = JSON.parse(await readFile(resolve(here, 'auth-upload-security/candidate.json')));
  if (digest(scopeBytes) !== SCOPE_SHA256
      || scope.parentSha256 !== DEPENDENCY_CANDIDATE || scope.candidateSha256 !== AUTH_UPLOAD_CANDIDATE
      || digest(await readFile(dependencyArchive)) !== DEPENDENCY_CANDIDATE
      || digest(await readFile(authUploadArchive)) !== AUTH_UPLOAD_CANDIDATE
      || info.candidateSha256 !== AUTH_UPLOAD_CANDIDATE || info.parentSecuritySha256 !== DEPENDENCY_CANDIDATE
      || JSON.stringify(info.securityChangedPaths) !== JSON.stringify(scope.files.map(file => file.path))) {
    throw new Error('Auth/upload archive or reviewed byte scope mismatch');
  }
  const beforePaths = paths(dependencyArchive), afterPaths = paths(authUploadArchive);
  const changes = new Map(scope.files.map(file => [file.path, file]));
  const expectedPaths = [...new Set([...beforePaths, ...scope.files.map(file => file.path)])].sort();
  if (JSON.stringify(expectedPaths) !== JSON.stringify(afterPaths)) throw new Error('Unapproved archive path delta');
  const temporary = await mkdtemp(resolve(tmpdir(), 'auth-upload-scope-'));
  let unchanged = 0;
  try {
    for (const [archive, name] of [[dependencyArchive, 'before'], [authUploadArchive, 'after']]) {
      await mkdir(resolve(temporary, name));
      execFileSync('tar', ['-xzf', archive, '-C', resolve(temporary, name)]);
    }
    for (const path of afterPaths) {
      const after = await readFile(resolve(temporary, 'after', path));
      const before = beforePaths.includes(path) ? await readFile(resolve(temporary, 'before', path)) : null;
      const change = changes.get(path);
      if (change) {
        if (change.beforeSha256 !== (before ? digest(before) : null)
            || change.afterSha256 !== digest(after) || change.beforeBytes !== (before?.length ?? 0)
            || change.afterBytes !== after.length || before?.equals(after)) {
          throw new Error(`Unapproved security bytes: ${path}`);
        }
      } else {
        if (!before?.equals(after)) throw new Error(`Unrelated frozen byte change: ${path}`);
        unchanged++;
      }
    }
    if (unchanged !== scope.unchangedParentFiles) throw new Error('Unchanged parent file count mismatch');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return info;
}
