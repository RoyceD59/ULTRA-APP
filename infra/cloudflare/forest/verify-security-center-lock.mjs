/** Fail closed on any dependency change beyond the two reviewed upgrades. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const yaml = require(resolve(root, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'));
export const pins = { 'fast-copy': '4.1.0', 'postcss-selector-parser': '7.1.6' };
export const packageMetadata = {
  'fast-copy': { resolution: { integrity: 'sha512-f5oNUvGAmBPLP85im9czQ7fVWh3RfcIIIzyXrcXKmCiWoDn+CRmfsoQN3jmE5J+UEquj4Ugc1woTaxD0oa37Gg==' } },
  'postcss-selector-parser': { resolution: { integrity: 'sha512-7qASPzhKF2l2KLboRZux8CCTRMdGiV08vWmyKzPz22qZ7ZjQBOeY7rNzNoCLSUiftJ7HUq0GERHmxw/t0dCdMw==' }, engines: { node: '>=4' } },
};

export function verifyLock(beforeText, afterText) {
  const before = yaml.parse(beforeText), after = yaml.parse(afterText);
  const targets = Object.keys(pins);
  const targetKey = key => targets.find(name => key.startsWith(`${name}@`));
  const renamed = key => {
    const name = targetKey(key);
    return name ? `${name}@${pins[name]}` : key;
  };
  const expected = structuredClone(before);
  Object.assign(expected.overrides, pins);
  // Package metadata is allowed to differ only for the two genuine releases.
  expected.packages = Object.fromEntries(Object.entries(before.packages)
    .filter(([key]) => !targetKey(key)));
  const actualOtherPackages = Object.fromEntries(Object.entries(after.packages)
    .filter(([key]) => !targetKey(key)));
  const packageKeys = new Set([...Object.keys(actualOtherPackages), ...Object.keys(expected.packages)]);
  const unrelated = [...packageKeys].filter(key => !isDeepStrictEqual(actualOtherPackages[key], expected.packages[key]));
  assert.equal(unrelated.length, 0, `Unrelated package resolutions changed: ${unrelated.slice(0, 8).join(', ')}`);
  for (const name of targets) {
    assert.deepEqual(Object.keys(after.packages).filter(key => targetKey(key) === name), [`${name}@${pins[name]}`]);
    assert.deepEqual(after.packages[`${name}@${pins[name]}`], packageMetadata[name], `Unverified registry metadata: ${name}`);
  }
  // Only references to the upgraded packages may change. Parent versions,
  // peer contexts, importers and complete non-target dependency graphs stay fixed.
  expected.snapshots = Object.fromEntries(Object.entries(before.snapshots).map(([key, entry]) => {
    const value = structuredClone(entry);
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const name of targets) if (value[section]?.[name]) {
        value[section][name] = pins[name];
      }
    }
    return [renamed(key), value];
  }));
  const rest = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'packages'));
  for (const key of new Set([...Object.keys(rest(after)), ...Object.keys(rest(expected))])) {
    assert.ok(isDeepStrictEqual(after[key], expected[key]), `Unrelated lock section changed: ${key}`);
  }
  return { unchangedImporters: Object.keys(before.importers).length, upgrades: pins };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { before, after } = JSON.parse(input);
  console.log(JSON.stringify(verifyLock(before, after)));
}
