import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(await readFile(resolve(here, 'security-dependency-review/candidate.json')));
const stage = resolve(here, '../../../.consistency-build', meta.candidateSha256);
const api = createRequire(resolve(stage, 'artifacts/api-server/package.json'));
const qr = createRequire(api.resolve('react-native-qrcode-svg'));
const native = createRequire(qr.resolve('react-native'));
const devtools = createRequire(native.resolve('react-devtools-core'));
const baileys = createRequire(api.resolve('@whiskeysockets/baileys'));
const metadataEntry = baileys.resolve('music-metadata');

test('actual API image renderer uses fixed sharp/librsvg and renders PNG', async () => {
  const sharp = api('sharp');
  assert.equal(sharp.versions.sharp, '0.35.5');
  assert.equal(sharp.versions.rsvg, '2.63.2');
  const png = await sharp({ create: {
    width: 2, height: 2, channels: 4, background: '#005588',
  } }).png().toBuffer();
  const result = await sharp(png).metadata();
  assert.equal(result.format, 'png');
  assert.equal(result.width, 2);
});

test('actual QR/native devtools consumer resolves fixed shell quoting', () => {
  const quote = devtools('shell-quote');
  assert.match(devtools.resolve('shell-quote'), /shell-quote@1\.11\.0/);
  assert.equal(quote.quote(['echo', 'hello world']), "echo 'hello world'");
  assert.throws(() => quote.quote(['echo', 'ok', { comment: 'x' }, 'a\nid;#']), TypeError);
});

test('actual WhatsApp metadata consumer keeps ordinary WAV parsing', async () => {
  const pkg = JSON.parse(await readFile(resolve(dirname(metadataEntry), '../package.json')));
  assert.equal(pkg.version, '11.16.0');
  const { parseBuffer } = await import(metadataEntry);
  const wav = Buffer.alloc(60);
  wav.write('RIFF', 0); wav.writeUInt32LE(52, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16, 40);
  const result = await parseBuffer(wav, { mimeType: 'audio/wav' });
  assert.equal(result.format.sampleRate, 8000);
  assert.equal(result.format.numberOfChannels, 1);
});

function box(type, content) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(content.length + 8); header.write(type, 4);
  return Buffer.concat([header, content]);
}
const zeroEntry = Buffer.alloc(8);
zeroEntry.write('mp4a', 4);
const count = Buffer.alloc(4); count.writeUInt32BE(1);
let mp4 = box('stsd', Buffer.concat([Buffer.alloc(4), count, zeroEntry]));
for (const kind of ['stbl', 'minf', 'mdia', 'trak', 'moov']) mp4 = box(kind, mp4);
mp4 = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isommp42')), mp4]);
const dsf = Buffer.alloc(28);
dsf.write('DSD '); dsf.writeBigUInt64LE(28n, 4); dsf.writeBigUInt64LE(28n, 12);
dsf.writeBigUInt64LE(0xffffffffffffffffn, 20);

for (const [name, data, mime] of [
  ['zero-sized MP4 sample entry', mp4, 'audio/mp4'],
  ['oversized EBML element', Buffer.from('1a45dfa3017fffffffffffff', 'hex'), 'video/x-matroska'],
  ['invalid DSF metadata offset', dsf, 'audio/dsf'],
]) {
  test(`metadata parser handles ${name} without hanging or process abort`, () => {
    // A separate bounded process protects the runner from synchronous parser
    // loops. No shell is invoked and no production files are parsed.
    const source = `const {parseBuffer}=await import(${JSON.stringify(metadataEntry)});
      try {await parseBuffer(Buffer.from(${JSON.stringify(data.toString('hex'))},'hex'),
        {mimeType:${JSON.stringify(mime)}});} catch {}
      process.stdout.write('bounded');`;
    const child = spawnSync(process.execPath,
      ['--max-old-space-size=128', '--input-type=module', '-e', source],
      { timeout: 5000, encoding: 'utf8', maxBuffer: 2048 });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, 'bounded');
  });
}
