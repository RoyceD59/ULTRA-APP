import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../uploadMedia.ts', import.meta.url);

test('native review uploads use raw bytes while web keeps Blob uploads', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /body = await nativeFile\.bytes\(\)/);
  assert.match(source, /await expoFetch\(uploadURL/);
  assert.match(source, /headers: \{ 'Content-Type': contentType \}/);
  assert.match(source, /body: body as Uint8Array<ArrayBuffer>/);
  assert.match(source, /body: body as Blob/);
});

test('native review uploads reject invalid sizes before reading bytes', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const sizeGuard = source.indexOf('if (size <= 0 || size > maxBytes)');
  const byteRead = source.indexOf('body = await nativeFile.bytes()');

  assert.ok(sizeGuard >= 0, 'expected a native media size guard');
  assert.ok(byteRead > sizeGuard, 'expected size validation before loading native bytes');
});

test('saved review attachments bypass upload and preserve their server reference', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /if \(item\.storedUrl\)/);
  assert.match(source, /out\.push\(\{ url: item\.storedUrl, type: item\.type \}\)/);
});