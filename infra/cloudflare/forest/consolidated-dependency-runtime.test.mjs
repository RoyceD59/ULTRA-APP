import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(await readFile(resolve(here, 'consolidated-review/candidate.json')));
const stage = resolve(here, '../../../.consistency-build', meta.candidateSha256);
const api = createRequire(resolve(stage, 'artifacts/api-server/package.json'));
const require = createRequire(resolve(stage, 'package.json'));
const installed = name => require(resolve(stage, 'node_modules/.pnpm', name, 'node_modules', name.split('@')[0]));

test('candidate image renderer uses fixed sharp/librsvg binaries and keeps PNG rendering', async () => {
  const sharp = api('sharp');
  assert.equal(sharp.versions.sharp, '0.35.5');
  assert.equal(sharp.versions.rsvg, '2.63.2');
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#005588' } }).png().toBuffer();
  const info = await sharp(png).metadata();
  assert.equal(info.format, 'png');
  assert.equal(info.width, 2);
});

test('candidate shell quoting rejects line terminators after comments without executing a shell', () => {
  const quote = installed('shell-quote@1.11.0');
  assert.equal(quote.quote(['echo', 'hello world']), "echo 'hello world'");
  assert.throws(() => quote.quote(['echo', 'ok', { comment: 'x' }, 'a\nid;#']), TypeError);
});

test('candidate copying keeps ordinary data but bounds adversarial nesting', () => {
  const { copy } = installed('fast-copy@4.1.0');
  assert.deepEqual(copy({ text: 'ordinary', value: [1, 2] }), { text: 'ordinary', value: [1, 2] });
  let deep = {};
  for (let n = 0; n < 2000; n++) deep = { next: deep };
  assert.throws(() => copy(deep), error => error instanceof RangeError && error.name === 'MaxDepthExceededError');
});
