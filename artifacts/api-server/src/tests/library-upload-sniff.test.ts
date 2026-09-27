/**
 * Adversarial tests for the library upload content-signature validator.
 *
 * The presigned PUT lets the uploader set any contentType metadata, so the
 * finalizer must reject files whose real bytes don't match the claimed type.
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateMagicBytes } from "../lib/libraryFinalizer.js";

// Alias so the describe/it labels remain unchanged.
const sniffMatchesMime = (head: Buffer, mime: string) => validateMagicBytes(mime, head);

const PDF   = Buffer.from("%PDF-1.7\n%rest");
const PNG   = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG  = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const ZIP   = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const OLE   = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const ELF   = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // executable
const EXE   = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // Windows PE
const TEXT  = Buffer.from("name,email\nalice,a@b.c\n");
const BINTX = Buffer.concat([Buffer.from("looks like text"), Buffer.from([0x00, 0x01])]);

describe("sniffMatchesMime — accepts genuine files", () => {
  it("PDF bytes as application/pdf", () => assert.ok(sniffMatchesMime(PDF, "application/pdf")));
  it("PNG bytes as image/png",       () => assert.ok(sniffMatchesMime(PNG, "image/png")));
  it("JPEG bytes as image/jpeg",     () => assert.ok(sniffMatchesMime(JPEG, "image/jpeg")));
  it("ZIP bytes as OOXML docx", () =>
    assert.ok(sniffMatchesMime(ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")));
  it("OLE bytes as legacy application/msword", () => assert.ok(sniffMatchesMime(OLE, "application/msword")));
  it("plain text as text/csv",       () => assert.ok(sniffMatchesMime(TEXT, "text/csv")));
});

describe("sniffMatchesMime — rejects mislabeled content", () => {
  it("ELF executable labeled application/pdf",  () => assert.ok(!sniffMatchesMime(ELF, "application/pdf")));
  it("Windows PE labeled image/png",            () => assert.ok(!sniffMatchesMime(EXE, "image/png")));
  it("ZIP labeled image/jpeg",                  () => assert.ok(!sniffMatchesMime(ZIP, "image/jpeg")));
  it("PDF labeled OOXML docx", () =>
    assert.ok(!sniffMatchesMime(PDF, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")));
  it("binary payload labeled text/plain",       () => assert.ok(!sniffMatchesMime(BINTX, "text/plain")));
  it("empty file labeled text/plain",           () => assert.ok(!sniffMatchesMime(Buffer.alloc(0), "text/plain")));
  it("unknown category application/octet-stream", () => assert.ok(!sniffMatchesMime(ZIP, "application/octet-stream")));
  it("unknown category application/x-sh",      () => assert.ok(!sniffMatchesMime(TEXT, "application/x-sh")));
});
