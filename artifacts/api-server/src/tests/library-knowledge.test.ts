import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { extractLibraryReference, readReferenceStream, ReferenceExtractionError } from "../lib/library-knowledge.js";
import { ALLOWED_MIME_TYPES } from "../lib/libraryFinalizer.js";
import { makeManualPdf } from "./fixtures/library-manual-pdf.js";
import { MAX_PDF_BYTES } from "../lib/library-reference-limits.js";

test("Markdown is an allowed upload; extraction is inert and removes links, metadata and markup", async () => {
  assert.ok(ALLOWED_MIME_TYPES.has("text/markdown"));
  const { text, hash } = await extractLibraryReference(Buffer.from(`---
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

test("unsupported, oversized, empty, invalid UTF-8 and binary documents fail explicitly", async () => {
  for (const [bytes, mime] of [
    [Buffer.from("%PDF-1.7"), "application/pdf"],
    [Buffer.from("Word document"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    [Buffer.alloc(32769, "x"), "text/plain"],
    [Buffer.from(" "), "text/plain"],
    [Buffer.from([255, 254]), "text/plain"],
    [Buffer.from("abc\0binary"), "text/plain"],
    [Buffer.from("x".repeat(16001)), "text/plain"],
  ] as const) {
    await assert.rejects(extractLibraryReference(bytes, mime), ReferenceExtractionError);
  }
});

test("stream read enforces byte budget even if storage metadata lies", async () => {
  assert.equal((await readReferenceStream(Readable.from([Buffer.from("safe text")]))).toString(), "safe text");
  const stream = Readable.from([Buffer.alloc(16000), Buffer.alloc(20000)]);
  await assert.rejects(readReferenceStream(stream), ReferenceExtractionError);
  assert.ok(stream.destroyed);
});

test("PDF extraction reads every page as inert text, strips URLs and binds exact previews", async () => {
  const bytes = makeManualPdf(["Rinse cartridge.", "Dry before use. https://storage.googleapis.com/private?secret=1 /objects/library/private"]);
  const reference = await extractLibraryReference(bytes, "application/pdf; charset=binary");
  assert.match(reference.text, /Rinse cartridge\.[\s\S]*Dry before use/);
  assert.doesNotMatch(reference.text, /https|storage|objects|secret|PRIVATE_METADATA|embedded action/);
  assert.deepEqual(reference, await extractLibraryReference(bytes, "application/pdf"));
  assert.notEqual(reference.hash, (await extractLibraryReference(makeManualPdf(["Changed manual"]), "application/pdf")).hash);
  // Same text, changed original must still require a new preview.
  assert.notEqual(reference.hash, (await extractLibraryReference(Buffer.concat([bytes, Buffer.from("\n% changed")]), "application/pdf")).hash);
});

test("PDF review rejects page, input, and output excess and any image-only page instead of truncating", async () => {
  for (const [bytes, pattern] of [
    [makeManualPdf(["", "Readable later page"]), /page 1 has no extractable text/],
    [makeManualPdf(Array.from({ length: 41 }, () => "Manual")), /1–40 pages/],
    [makeManualPdf(Array.from({ length: 3 }, () => "x".repeat(6000))), /exceeds 16,000/],
    [Buffer.concat([makeManualPdf(["Manual"]), Buffer.alloc(MAX_PDF_BYTES)]), /at most 5 MB/],
    [Buffer.from("not a PDF"), /not a valid PDF/],
    [makeManualPdf(["Locked manual"], true), /Encrypted or password-protected/],
  ] as const) await assert.rejects(extractLibraryReference(bytes, "application/pdf"), pattern);
});

test("PDF stream limit is enforced independently from metadata and text retains its lower limit", async () => {
  const bytes = makeManualPdf(["A manual"]);
  const padded = Buffer.concat([bytes, Buffer.alloc(40_000, 32)]);
  assert.equal((await readReferenceStream(Readable.from([padded]), MAX_PDF_BYTES)).length, padded.length);
  await assert.rejects(readReferenceStream(Readable.from([padded])), ReferenceExtractionError);
  const stream = Readable.from([Buffer.alloc(MAX_PDF_BYTES), Buffer.from("x")]);
  await assert.rejects(readReferenceStream(stream, MAX_PDF_BYTES), ReferenceExtractionError);
  assert.ok(stream.destroyed);
});

test("a stalled object read times out and destroys the stream", async () => {
  const stream = new Readable({ read() {} });
  await assert.rejects(readReferenceStream(stream), /timed out/);
  assert.ok(stream.destroyed);
});