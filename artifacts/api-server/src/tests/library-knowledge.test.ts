import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { extractLibraryReference, readReferenceStream, ReferenceExtractionError } from "../lib/library-knowledge.js";
import { ALLOWED_MIME_TYPES } from "../lib/libraryFinalizer.js";

test("Markdown is an allowed upload; extraction is inert and removes links, metadata and markup", () => {
  assert.ok(ALLOWED_MIME_TYPES.has("text/markdown"));
  const { text, hash } = extractLibraryReference(Buffer.from(`---
internal: private metadata
---
# Cleaning
<!-- private comment -->
<script>alert('hidden')</script>
<b>Rinse cartridge.</b>
[Reference](https://storage.googleapis.com/private/file?token=secret)
![private image](/objects/library/private)
/api/storage/objects/library/private
[secret]: https://private.test
`), "text/markdown; charset=utf-8");
  assert.match(text, /Rinse cartridge/);
  assert.doesNotMatch(text, /private|secret|storage|objects|script|metadata|https|alert/);
  assert.equal(hash.length, 64);
});

test("unsupported, oversized, empty, invalid UTF-8 and binary documents fail explicitly", () => {
  for (const [bytes, mime] of [
    [Buffer.from("%PDF-1.7"), "application/pdf"],
    [Buffer.alloc(32769, "x"), "text/plain"],
    [Buffer.from(" "), "text/plain"],
    [Buffer.from([255, 254]), "text/plain"],
    [Buffer.from("abc\0binary"), "text/plain"],
    [Buffer.from("x".repeat(16001)), "text/plain"],
  ] as const) {
    assert.throws(() => extractLibraryReference(bytes, mime), ReferenceExtractionError);
  }
});

test("stream read enforces byte budget even if storage metadata lies", async () => {
  assert.equal((await readReferenceStream(Readable.from([Buffer.from("safe text")]))).toString(), "safe text");
  const stream = Readable.from([Buffer.alloc(16000), Buffer.alloc(20000)]);
  await assert.rejects(readReferenceStream(stream), ReferenceExtractionError);
  assert.ok(stream.destroyed);
});