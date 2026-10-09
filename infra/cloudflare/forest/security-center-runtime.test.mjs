import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const stage = resolve(process.env.SECURITY_CENTER_STAGE || '.consistency-build/security-center-draft');
const api = createRequire(resolve(stage, 'artifacts/api-server/package.json'));
const companion = createRequire(resolve(stage, 'artifacts/uc-companion/package.json'));
const hub = createRequire(resolve(stage, 'artifacts/projecthub/package.json'));
const pretty = createRequire(api.resolve('pino-pretty'));
const fastCopyPath = pretty.resolve('fast-copy');
const typography = createRequire(hub.resolve('@tailwindcss/typography'));
const parserPath = typography.resolve('postcss-selector-parser');
const ngrok = createRequire(companion.resolve('@expo/ngrok'));
const got = createRequire(ngrok.resolve('got'));
const cache = createRequire(got.resolve('cacheable-request'));
const policyPath = cache.resolve('http-cache-semantics');
const version = entry => JSON.parse(readFileSync(resolve(dirname(entry), '../package.json'))).version;

test('logging/typography use fixed releases; Expo cache retains the verified backport', () => {
  assert.match(fastCopyPath, /fast-copy@4\.1\.0/);
  assert.match(parserPath, /postcss-selector-parser@7\.1\.6/);
  assert.match(policyPath, process.env.SECURITY_CENTER_CACHE_REVIEW === '1'
    ? /http-cache-semantics@4\.3\.0.*patch_hash/ : /http-cache-semantics@4\.2\.0.*patch_hash/);
  assert.match(readFileSync(policyPath, 'utf8'), /max-stale must not revive/);
});

test('fast-copy preserves ordinary and cyclic objects', () => {
  const { copy } = pretty('fast-copy');
  const input = { a: [1, { b: 2 }], date: new Date(0) };
  input.self = input;
  const output = copy(input);
  assert.deepEqual(output.a, input.a);
  assert.notEqual(output.a, input.a);
  assert.equal(output.date.getTime(), 0);
  assert.equal(output.self, output);
});

test('deep copying fails with a controlled depth error, not native stack exhaustion', () => {
  const code = `const {copy}=require(${JSON.stringify(fastCopyPath)});let value={};for(let i=0;i<20000;i++)value={child:value};try{copy(value);process.exit(2)}catch(error){if(!/Maximum copy depth/.test(error.message)||/call stack/.test(error.message))process.exit(3)}`;
  const child = spawnSync(process.execPath, ['-e', code], { timeout: 5000, encoding: 'utf8' });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test('the real pino-pretty consumer retains ordinary structured logging', () => {
  const format = api('pino-pretty').prettyFactory({ colorize: false, ignore: 'pid,hostname,time' });
  const text = format({ level: 30, msg: 'security review fixture', details: { count: 2 } });
  assert.match(text, /security review fixture/);
  assert.match(text, /count.*2/);
});

test('typography selector parsing retains round-trip syntax', () => {
  const parser = typography('postcss-selector-parser');
  const selector = ':where(h1, h2):not([class~="not-prose"], [class~="not-prose"] *)';
  assert.equal(parser().processSync(selector), selector);
});

test('large flat selectors finish within a bounded child process', () => {
  const code = `const parser=require(${JSON.stringify(parserPath)});const ast=parser().astSync(Array(12000).fill('.fixture').join(','));if(ast.nodes.length!==12000)process.exit(2)`;
  const child = spawnSync(process.execPath, ['-e', code], { timeout: 5000, encoding: 'utf8' });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test('all original sharp, shell and media security pins remain intact', async () => {
  assert.equal(api('sharp').versions.sharp, '0.35.5');
  assert.equal(api('sharp').versions.rsvg, '2.63.2');
  const native = createRequire(createRequire(api.resolve('react-native-qrcode-svg')).resolve('react-native'));
  const devtools = createRequire(native.resolve('react-devtools-core'));
  assert.match(devtools.resolve('shell-quote'), /shell-quote@1\.11\.0/);
  const baileys = createRequire(api.resolve('@whiskeysockets/baileys'));
  assert.equal(version(baileys.resolve('music-metadata')), '11.16.0');
});
