import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { verifyLock } from './verify-security-center-lock.mjs';
const require = createRequire(import.meta.url);
const yaml = require('../../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml');
const lock = archive => execFileSync('tar', ['-xOf', archive, 'pnpm-lock.yaml'], { encoding: 'utf8' });
const before = lock('infra/cloudflare/forest/security-dependency-review/release-sources.tar.gz');
const after = lock('infra/cloudflare/forest/security-center-review/release-sources.tar.gz');
test('sealed lock changes only two targeted versions and preserves every importer', () => {
  assert.equal(verifyLock(before, after).unchangedImporters, 11);
});
for (const [name, mutate] of [
  ['unrelated package metadata', value => { value.packages['typescript@5.9.3'].engines.node = '>=999'; }],
  ['an extra package', value => { value.packages['unreviewed@1.0.0'] = {}; }],
  ['a changed workspace importer', value => { value.importers['.'].devDependencies.typescript.specifier = '*'; }],
  ['a removed cache security patch', value => { delete value.patchedDependencies['http-cache-semantics@4.2.0']; }],
  ['unverified target integrity', value => { value.packages['fast-copy@4.1.0'].resolution.integrity = 'sha512-fake'; }],
  ['an old vulnerable logging reference', value => { value.snapshots['pino-pretty@13.1.3'].dependencies['fast-copy'] = '4.0.4'; }],
]) {
  test(`rejects ${name}`, () => {
    const value = yaml.parse(after);
    mutate(value);
    assert.throws(() => verifyLock(before, yaml.stringify(value)));
  });
}
