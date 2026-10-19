import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { BACKPORTS, declaredPatches, verifyInstalledBackports } from './security-patch-installation.mjs';

const HASH = Object.fromEntries(Object.keys(BACKPORTS).map((name, index) => [name, String(index + 1).repeat(64)]));
const VERSION = { braces: '3.0.3', 'http-cache-semantics': '4.2.0', 'node-forge': '1.4.0' };
const MAIN = { braces: 'index.js', 'http-cache-semantics': 'index.js', 'node-forge': 'lib/index.js' };
const GUARD = {
  'lib/parse.js': '// nesting depth\n', 'lib/compile.js': '// nesting depth\n',
  'lib/expand.js': '// nesting depth\n', 'lib/stringify.js': '// nesting depth\n',
  'index.js': '// max-stale must not revive\n',
  'lib/rsa.js': "x(obj.value[0].value.length > 2 || capture.parameters !== '')\n",
};

function lockText(omit) {
  const entries = Object.keys(VERSION).filter(name => name !== omit).map(name =>
    `  ${name}@${VERSION[name]}:\n    hash: ${HASH[name]}\n    path: patches/${name}.patch\n`).join('');
  return `lockfileVersion: '9.0'\n\npatchedDependencies:\n${entries}\nimporters:\n  .: {}\n`;
}

function write(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function link(from, to) { mkdirSync(dirname(from), { recursive: true }); symlinkSync(relative(dirname(from), to), from); }

/** Minimal pnpm-shaped stage whose consumer chains mirror the real fixtures. */
function stage({ unguarded = [], renamed = [], extraCopy = null, omitLock = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'patch-stage-'));
  write(join(root, 'pnpm-lock.yaml'), lockText(omitLock));
  const store = join(root, 'node_modules/.pnpm');
  const pkg = (directory, name, main, files = {}) => {
    const base = join(store, directory, 'node_modules', name);
    write(join(base, 'package.json'), JSON.stringify({ name, version: '1.0.0', main }));
    write(join(base, main), '');
    for (const [file, text] of Object.entries(files)) write(join(base, file), text);
    return base;
  };
  const target = name => {
    const guarded = !unguarded.includes(name);
    const directory = renamed.includes(name) ? `${name}@${VERSION[name]}` : `${name}@${VERSION[name]}_patch_hash=${HASH[name]}`;
    const files = Object.fromEntries(Object.entries(BACKPORTS[name].files).map(([file]) => [file, guarded ? GUARD[file] : '// original\n']));
    return { directory, base: pkg(directory, name, MAIN[name], files) };
  };
  const hop = (parentDirectory, name, finalPath) => {
    link(join(store, parentDirectory, 'node_modules', name), finalPath);
  };
  write(join(root, 'artifacts/api-server/package.json'), '{}');
  write(join(root, 'artifacts/uc-companion/package.json'), '{}');
  const braces = target('braces');
  const micromatch = pkg('micromatch@1', 'micromatch', 'index.js');
  const proxy = pkg('http-proxy-middleware@1', 'http-proxy-middleware', 'index.js');
  link(join(root, 'artifacts/api-server/node_modules/http-proxy-middleware'), proxy);
  hop('http-proxy-middleware@1', 'micromatch', micromatch);
  hop('micromatch@1', 'braces', braces.base);
  const cache = target('http-cache-semantics');
  const ngrok = pkg('@expo+ngrok@1', '@expo/ngrok', 'index.js');
  const got = pkg('got@1', 'got', 'index.js');
  const cacheable = pkg('cacheable-request@1', 'cacheable-request', 'index.js');
  link(join(root, 'artifacts/uc-companion/node_modules/@expo/ngrok'), ngrok);
  hop('@expo+ngrok@1', 'got', got);
  hop('got@1', 'cacheable-request', cacheable);
  hop('cacheable-request@1', 'http-cache-semantics', cache.base);
  const forge = target('node-forge');
  const expo = pkg('expo@1', 'expo', 'index.js');
  const cli = pkg('@expo+cli@1', '@expo/cli', 'index.js');
  link(join(root, 'artifacts/uc-companion/node_modules/expo'), expo);
  hop('expo@1', '@expo/cli', cli);
  hop('@expo+cli@1', 'node-forge', forge.base);
  if (extraCopy) pkg(extraCopy, 'http-cache-semantics', 'index.js', { 'index.js': '// original\n' });
  return root;
}

function rejects(options, pattern) {
  const root = stage(options);
  try { assert.throws(() => verifyInstalledBackports(root, { runFixtures: false }), pattern); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('declared patches come from the frozen lock, not from directory names', () => {
  const found = declaredPatches(lockText());
  assert.deepEqual(Object.keys(found).sort(), Object.keys(VERSION).sort());
  assert.equal(found['http-cache-semantics'].hash, HASH['http-cache-semantics']);
});

test('active, consumer-resolved backports in the expected hash-qualified copies pass', () => {
  const root = stage();
  try {
    const evidence = verifyInstalledBackports(root, { runFixtures: false });
    assert.match(evidence.packages['http-cache-semantics'].resolved, /_patch_hash=/);
    assert.ok(Object.values(evidence.packages).every(item => item.copies.every(copy => copy.guarded)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const name of Object.keys(VERSION)) {
  test(`rejects an inactive ${name} guard even under the expected hash-qualified directory`, () => {
    rejects({ unguarded: [name] }, new RegExp(`${name.replace('-', '\\-')}.*declared guard is absent|declared guard is absent`));
  });
}

test('rejects a patched-looking name that is not the lock-declared hash directory', () => {
  rejects({ renamed: ['http-cache-semantics'] }, /expected http-cache-semantics@4\.2\.0_patch_hash=/);
});

test('rejects a stray unpatched virtual-store copy beside the guarded one', () => {
  rejects({ extraCopy: 'http-cache-semantics@4.3.0' }, /unexpected installed copy/);
});

test('rejects a lock that stops declaring a patch', () => {
  rejects({ omitLock: 'node-forge' }, /node-forge: no declared patch in lock/);
});

test('release builder verifies installed backports before the marker and again on cache reuse', () => {
  const source = readFileSync(new URL('./build-approved-consistency.mjs', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/verifyInstalledBackports\(stage[,)]/g)].map(match => match.index);
  const verify = calls[0];
  assert.ok(verify > 0, 'builder must call the installed-backport gate');
  assert.ok(verify < source.indexOf('await writeFile(marker'), 'gate must run before the prepared marker is written');
  assert.equal(calls.length, 2, 'gate must also run when a prepared stage is reused');
  assert.ok(calls[1] < source.indexOf("packages[mode], 'run', 'typecheck'"));
});
