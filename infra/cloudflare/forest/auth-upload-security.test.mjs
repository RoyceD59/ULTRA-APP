import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { authUploadArchive, dependencyArchive, verifyAuthUploadRevision } from './auth-upload-security.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const contents = (archive, path) => execFileSync('tar', ['-xOf', archive, path], { encoding: 'utf8' });
test('only six frozen files change and four merged security fixtures are added', async () => {
  const info = await verifyAuthUploadRevision();
  assert.equal(info.securityChangedPaths.length, 10);
  assert.equal(info.unchangedFrozenFiles, 1221);
  for (const path of ['pnpm-lock.yaml', 'lib/api-spec/openapi.yaml', 'artifacts/uc-companion/app.json']) {
    assert.equal(contents(authUploadArchive, path), contents(dependencyArchive, path));
  }
});
test('merged implementations and regression fixtures are exact, not reimplemented', () => {
  for (const [revision, relative] of [
    ['a619d3808dfbab526b225bad7cada8395b7a00e9', 'src/lib/jwt.ts'],
    ['0aaa29c9e12ee43d65202964ba62f5b2097d800f', 'src/lib/objectStorage.ts'],
    ['0aaa29c9e12ee43d65202964ba62f5b2097d800f', 'src/lib/review-media-signature.ts'],
    ['0aaa29c9e12ee43d65202964ba62f5b2097d800f', 'src/routes/storage.ts'],
    ['a619d3808dfbab526b225bad7cada8395b7a00e9', 'src/tests/customer-count-auth.test.ts'],
    ['a619d3808dfbab526b225bad7cada8395b7a00e9', 'src/tests/jwt-session-expiry.test.ts'],
    ['0aaa29c9e12ee43d65202964ba62f5b2097d800f', 'src/tests/review-media-signature.test.ts'],
    ['0aaa29c9e12ee43d65202964ba62f5b2097d800f', 'src/tests/storage-public-media-security.test.ts'],
    ['6c8aac72da5eecec5ea934c71f62dac06873fb9c', 'src/tests/storage-upload-allowlist.test.ts'],
  ]) {
    const path = `artifacts/api-server/${relative}`;
    assert.equal(contents(authUploadArchive, path),
      execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8' }), path);
  }
});
test('large customer route retains frozen receipts, reporting and unrelated features', () => {
  const path = 'artifacts/api-server/src/routes/uc.ts';
  const parent = contents(dependencyArchive, path), next = contents(authUploadArchive, path);
  const merged = execFileSync('git', ['show', `0aaa29c9e12ee43d65202964ba62f5b2097d800f:${path}`], { cwd: root, encoding: 'utf8' });
  const attachment = text => text.slice(text.indexOf('async function verifyUploadedMediaItems'), text.indexOf('\n}\n', text.indexOf('async function verifyUploadedMediaItems')) + 3);
  assert.equal(attachment(next), attachment(merged));
  const gate = /    \/\/ Identity claims alone[\s\S]*?(?=    const \{ rows \} = await pool.query)/;
  const restored = next.replace(gate, '')
    .replace(attachment(next), attachment(parent))
    .replace('import { verifyReviewMediaContent, mediaMimeFamily }', 'import { detectReviewMediaMime, mediaMimeFamily }');
  assert.equal(restored, parent);
  assert.ok(!next.includes('A lagging local COD collection ledger'));
});

test('deployment builds execute non-database frozen security fixtures before compilation only', async () => {
  const builder = await readFile(resolve(here, 'build-approved-consistency.mjs'), 'utf8');
  const guard = builder.indexOf('src/tests/{jwt-session-expiry,review-media-signature,storage-public-media-security}.test.ts');
  const compile = builder.indexOf("await run('pnpm', ['--filter', packages[mode], 'run', 'build']");
  assert.ok(guard > builder.indexOf('} else {') && guard < compile);
  assert.doesNotMatch(builder, /run\('pnpm',.*'test'/);
  assert.doesNotMatch(builder, /src\/tests\/run\.ts|customer-count-auth|storage-upload-allowlist/);
  const apiConfig = await readFile(resolve(root, 'artifacts/api-server/.replit-artifact/artifact.toml'), 'utf8');
  assert.match(apiConfig, /"build-approved-consistency\.mjs"|forest\/build-approved-consistency\.mjs/);
  for (const artifact of ['projecthub', 'uc-companion']) {
    const config = await readFile(resolve(root, `artifacts/${artifact}/.replit-artifact/artifact.toml`), 'utf8');
    assert.match(config, /forest\/release-build\.mjs/);
    assert.doesNotMatch(config, /build-approved-consistency/);
  }
});
