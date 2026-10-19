/** Preserve the entire retained graph; change only registry-verified releases. */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { pins as basePins, cachePins, cacheMetadata, packageMetadata as baseMetadata, verifyLock } from './verify-security-center-lock.mjs';
const require = createRequire(import.meta.url);
const yaml = require(resolve('node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'));
const [parentPath, outputPath] = process.argv.slice(2);
if (!parentPath || !outputPath) throw Error('Supply retained parent lock and draft output lock');
const beforeText = await readFile(parentPath, 'utf8');
const doc = yaml.parseDocument(beforeText);
const cacheReview = process.argv.includes('--cache-review');
const pins = cacheReview ? cachePins : basePins;
const packageMetadata = cacheReview ? { ...baseMetadata, 'http-cache-semantics': cacheMetadata } : baseMetadata;
const hash = doc.getIn(['patchedDependencies', 'http-cache-semantics@4.2.0', 'hash']);
const reference = name => name === 'http-cache-semantics' ? `4.3.0(patch_hash=${hash})` : pins[name];
if (cacheReview) {
  doc.deleteIn(['patchedDependencies', 'http-cache-semantics@4.2.0']);
  doc.setIn(['patchedDependencies', 'http-cache-semantics@4.3.0'], {
    hash, path: 'patches/http-cache-semantics@4.2.0.patch',
  });
}
const target = key => Object.keys(pins).find(name => key.startsWith(`${name}@`));
for (const [name, version] of Object.entries(pins)) doc.setIn(['overrides', name], version);
for (const section of ['packages', 'snapshots']) {
  const map = doc.get(section, true);
  const replaced = new Set();
  for (const entry of [...map.items]) {
    const key = entry.key.value, name = target(key);
    if (name) {
      assert.ok(!replaced.has(name), `Multiple retained variants: ${name}`);
      replaced.add(name);
      const value = section === 'packages' ? packageMetadata[name] : entry.value.clone();
      map.delete(key);
      map.set(`${name}@${section === 'snapshots' ? reference(name) : pins[name]}`, value);
    }
  }
  assert.equal(replaced.size, Object.keys(pins).length, 'Missing retained target');
}
for (const entry of doc.get('snapshots', true).items) {
  for (const section of ['dependencies', 'optionalDependencies']) {
    const dependencies = entry.value.get?.(section, true);
    if (!dependencies) continue;
    for (const [name, version] of Object.entries(pins)) if (dependencies.has(name)) {
      dependencies.set(name, reference(name));
    }
  }
}
const afterText = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
console.log(verifyLock(beforeText, afterText, { cacheReview }));
await writeFile(outputPath, afterText);
