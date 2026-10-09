import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { verifyLock } from './verify-security-center-lock.mjs';
const require = createRequire(import.meta.url);
const yaml = require('../../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml');
const lock = archive => execFileSync('tar', ['-xOf', archive, 'pnpm-lock.yaml'], { encoding: 'utf8' });
const before = lock('infra/cloudflare/forest/security-dependency-review/release-sources.tar.gz');
const after = lock('infra/cloudflare/forest/security-center-cache-review/release-sources.tar.gz');
test('new cache version preserves the full graph, importers and exact guard hash', () => {
  assert.equal(verifyLock(before, after, { cacheReview: true }).unchangedImporters, 11);
});
for (const [name, mutate] of [
  ['removed cache guard', v => { delete v.patchedDependencies['http-cache-semantics@4.3.0']; }],
  ['changed guard hash', v => { v.patchedDependencies['http-cache-semantics@4.3.0'].hash = 'fake'; }],
  ['unverified cache integrity', v => { v.packages['http-cache-semantics@4.3.0'].resolution.integrity = 'sha512-fake'; }],
  ['bare unpatched reference', v => { v.snapshots['cacheable-request@7.0.4'].dependencies['http-cache-semantics'] = '4.3.0'; }],
  ['unrelated workspace change', v => { v.importers['.'].devDependencies.typescript.specifier = '*'; }],
  ['additional undeclared package', v => { v.packages['unreviewed@1.0.0'] = {}; }],
]) {
  test(`rejects ${name}`, () => {
    const v = yaml.parse(after);
    mutate(v);
    assert.throws(() => verifyLock(before, yaml.stringify(v), { cacheReview: true }));
  });
}
test('release builder forces a frozen build-dependency import and retains consumer gates', () => {
  const source = readFileSync(new URL('./build-approved-consistency.mjs', import.meta.url), 'utf8');
  assert.match(source, /'install', '--frozen-lockfile', '--ignore-scripts', '--force', '--prod=false'/);
  assert.match(source, /scripts\/tests\/dependency-security.test.mjs/);
  assert.ok(source.indexOf('dependency-security.test.mjs') < source.indexOf("packages[mode], 'run', 'typecheck'"));
});
