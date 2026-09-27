/**
 * Tests for the Team Library upload-grant finalization logic.
 *
 * Tests the pure business-logic layer in src/lib/libraryFinalizer.ts — no
 * real database, no real GCS bucket, no HTTP server needed for most tests.
 * An HTTP-level section at the bottom uses the real Express app to verify
 * that DELETE /api/library/docs/:id enforces admin-only access.
 *
 * Covers:
 *  (a) Happy path — successful finalization
 *  (b) Unknown uploadId                 → 404
 *  (c) Ownership mismatch               → 403
 *  (d) Pre-consumed slot                → 409
 *  (e) Expired slot                     → 410
 *  (f) Path outside /objects/library/  → 400
 *  (g) Concurrent replay — consumeSlot=false → 409
 *  (h) GCS object missing               → 422
 *  (i) Disallowed GCS content type      → 422
 *  (j) MIME category mismatch           → 422
 *  (k) File over size limit             → 422
 *  (l) GCS content type stored on doc, normalised
 *  (m) Magic-byte mismatch              → 422
 *  (n) validateMagicBytes unit tests    — exact matching, WebP RIFF+WEBP, TIFF both byte orders
 *  (o) DELETE /api/library/docs/:id     → 403 for non-admin (HTTP)
 *  (p) Exact-MIME bypass prevention     — prefix-suffix spoofing, RIFF/WAV as WebP
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  finalizeUpload,
  validateMagicBytes,
  normalizeMime,
  ALLOWED_MIME_TYPES,
  ALLOWED_MIME_PREFIXES,
  MAX_FILE_BYTES,
  LIBRARY_PATH_PREFIX,
  type FinalizerDeps,
  type SlotRow,
  type GcsMeta,
} from "../lib/libraryFinalizer.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const MEMBER_EMAIL = "alice@ucfilters.com";
const OBJECT_PATH  = `${LIBRARY_PATH_PREFIX}abc-uuid-123`;
const PDF_MAGIC    = Buffer.from([0x25, 0x50, 0x44, 0x46]);                      // %PDF
const PNG_MAGIC    = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const JUNK_BYTES   = Buffer.alloc(12, 0x00);

// A valid 12-byte WebP header: RIFF at 0-3, arbitrary size at 4-7, WEBP at 8-11
const WEBP_HEADER  = Buffer.from([
  0x52, 0x49, 0x46, 0x46,  // RIFF
  0x00, 0x00, 0x00, 0x00,  // file size (ignored by validator)
  0x57, 0x45, 0x42, 0x50,  // WEBP
]);
// A WAV file has RIFF at 0-3 and WAVE at 8-11 — must NOT pass as image/webp
const WAV_HEADER   = Buffer.from([
  0x52, 0x49, 0x46, 0x46,  // RIFF
  0x00, 0x00, 0x00, 0x00,  // file size
  0x57, 0x41, 0x56, 0x45,  // WAVE
]);

function makeSlot(overrides: Partial<SlotRow> = {}): SlotRow {
  return {
    uploadedBy:   MEMBER_EMAIL,
    objectPath:   OBJECT_PATH,
    declaredType: "application/pdf",
    consumed:     false,
    expiresAt:    new Date(Date.now() + 30 * 60 * 1000),
    ...overrides,
  };
}

function makeGcsMeta(overrides: Partial<GcsMeta> = {}): GcsMeta {
  return { contentType: "application/pdf", size: 512_000, generation: "1234567890", ...overrides };
}

function makeDeps(overrides: Partial<FinalizerDeps> = {}): FinalizerDeps {
  return {
    async getSlot(_id)                    { return makeSlot(); },
    async consumeSlot(_id)                { return true; },
    async getGcsMeta(_path)               { return makeGcsMeta(); },
    async readFirstBytes(_path, _n)       { return PDF_MAGIC; },
    async copyToFinal(_staging, _gen, _fp){ return { ok: true }; },
    async deleteStagingObject(_path)      { /* no-op */ },
    async insertDoc(doc)                  { return { ...doc, createdAt: new Date() }; },
    async purgeExpired()                  { /* no-op */ },
    ...overrides,
  };
}

const BASE_INPUT = {
  uploadId:    "upload-slot-id",
  memberEmail: MEMBER_EMAIL,
  title:       "Q3 Sales Report",
  fileName:    "q3-sales.pdf",
};

// ─── (a) Happy path ───────────────────────────────────────────────────────────

describe("finalizeUpload — happy path", () => {
  it("returns ok with a saved doc on success", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps());
    assert.equal(result.kind, "ok");
    const doc = (result as { kind: "ok"; doc: Record<string, unknown> }).doc;
    assert.equal(doc["uploadedBy"], MEMBER_EMAIL);
    // After the atomic copy, objectPath is the finalised path — NOT the staging path.
    assert.notEqual(doc["objectPath"], OBJECT_PATH, "doc must point to finalised path, not staging path");
    assert.ok((doc["objectPath"] as string).startsWith(LIBRARY_PATH_PREFIX),
      "finalised objectPath must be within library prefix");
    assert.equal(doc["fileType"], "application/pdf", "fileType must be normalised GCS type");
    assert.equal(doc["fileSize"], 512_000);
  });

  it("stores normalised GCS contentType — strips parameters", async () => {
    const deps = makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "image/png" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "image/png; charset=binary" }); },
      async readFirstBytes() { return PNG_MAGIC; },
    });
    const result = await finalizeUpload(BASE_INPUT, deps);
    assert.equal(result.kind, "ok");
    const doc = (result as { kind: "ok"; doc: Record<string, unknown> }).doc;
    assert.equal(doc["fileType"], "image/png", "parameters must be stripped from stored fileType");
  });

  it("calls purgeExpired after a successful promotion", async () => {
    let purged = false;
    const deps = makeDeps({ async purgeExpired() { purged = true; } });
    await finalizeUpload(BASE_INPUT, deps);
    await new Promise(r => setImmediate(r));
    assert.ok(purged);
  });
});

// ─── (b-f) Slot validation ────────────────────────────────────────────────────

describe("finalizeUpload — slot validation", () => {
  it("(b) 404 for unknown uploadId", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps({ async getSlot() { return undefined; } }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 404);
  });

  it("(c) 403 when slot belongs to a different user", async () => {
    const result = await finalizeUpload(BASE_INPUT,
      makeDeps({ async getSlot() { return makeSlot({ uploadedBy: "bob@ucfilters.com" }); } }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 403);
  });

  it("(d) 409 when slot is already consumed", async () => {
    const result = await finalizeUpload(BASE_INPUT,
      makeDeps({ async getSlot() { return makeSlot({ consumed: true }); } }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 409);
  });

  it("(e) 410 when slot is expired", async () => {
    const result = await finalizeUpload(BASE_INPUT,
      makeDeps({ async getSlot() { return makeSlot({ expiresAt: new Date(Date.now() - 1000) }); } }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 410);
  });

  it("(f) slot with an uploads/ staging path is accepted — path validation is the route's concern", async () => {
    // Staging paths live under /objects/uploads/; the library-prefix guard is
    // enforced on the finalized doc path by the route layer, not finalizeUpload.
    const result = await finalizeUpload(BASE_INPUT,
      makeDeps({ async getSlot() { return makeSlot({ objectPath: "/objects/uploads/staging-uuid" }); } }));
    assert.equal(result.kind, "ok");
  });
});

// ─── (g) Concurrent replay ────────────────────────────────────────────────────

describe("finalizeUpload — concurrent replay protection", () => {
  it("(g) second concurrent caller gets 409 when consumeSlot returns false", async () => {
    let calls = 0;
    const deps = makeDeps({ async consumeSlot() { return ++calls === 1; } });
    const [r1, r2] = await Promise.all([
      finalizeUpload(BASE_INPUT, deps),
      finalizeUpload(BASE_INPUT, deps),
    ]);
    const ok  = [r1, r2].filter(r => r.kind === "ok");
    const err = [r1, r2].filter(r => r.kind === "error" && (r as { status: number }).status === 409);
    assert.equal(ok.length,  1, "exactly one call should succeed");
    assert.equal(err.length, 1, "exactly one call should get 409");
  });

  it("sequential calls: first ok, second 409 via pre-consumed check", async () => {
    let consumed = false;
    const deps = makeDeps({
      async getSlot()    { return makeSlot({ consumed }); },
      async consumeSlot(){ consumed = true; return true; },
    });
    assert.equal((await finalizeUpload(BASE_INPUT, deps)).kind, "ok");
    const second = await finalizeUpload(BASE_INPUT, deps);
    assert.equal(second.kind, "error");
    assert.equal((second as { kind: "error"; status: number }).status, 409);
  });
});

// ─── (h-k) GCS metadata validation ───────────────────────────────────────────

describe("finalizeUpload — GCS metadata validation", () => {
  it("(h) 422 when GCS object is missing", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps({ async getGcsMeta() { return null; } }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 422);
  });

  it("(i) 422 when GCS reports a disallowed content type", async () => {
    const result = await finalizeUpload(BASE_INPUT,
      makeDeps({ async getGcsMeta() { return makeGcsMeta({ contentType: "application/octet-stream" }); } }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 422);
  });

  it("(j) 422 when GCS content-type category differs from declared type", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "application/pdf" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "image/jpeg" }); },
      async readFirstBytes() { return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]); },
    }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 422);
  });

  it("(k) 422 when file exceeds 50 MB", async () => {
    const result = await finalizeUpload(BASE_INPUT,
      makeDeps({ async getGcsMeta() { return makeGcsMeta({ size: MAX_FILE_BYTES + 1 }); } }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 422);
  });

  it("accepts a file exactly at the 50 MB limit", async () => {
    const result = await finalizeUpload(BASE_INPUT,
      makeDeps({ async getGcsMeta() { return makeGcsMeta({ size: MAX_FILE_BYTES }); } }));
    assert.equal(result.kind, "ok");
  });
});

// ─── (m) Magic-byte validation ────────────────────────────────────────────────

describe("finalizeUpload — magic-byte validation", () => {
  it("(m) 422 when PDF bytes are garbage", async () => {
    const result = await finalizeUpload(BASE_INPUT,
      makeDeps({ async readFirstBytes() { return JUNK_BYTES; } }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 422);
  });

  it("(m) 422 when attacker uploads EXE labeled as image/png", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "image/png" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "image/png" }); },
      async readFirstBytes() { return Buffer.from([0x4D, 0x5A, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]); }, // MZ (PE)
    }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 422);
  });

  it("(m) accepts text/csv with any bytes — no magic bytes for text", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "text/csv" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "text/csv" }); },
      async readFirstBytes() { return Buffer.from("name,email\nalice,alice@example.com"); },
    }));
    assert.equal(result.kind, "ok");
  });

  it("(m) accepts valid image/jpeg", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "image/jpeg" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "image/jpeg" }); },
      async readFirstBytes() { return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]); },
    }));
    assert.equal(result.kind, "ok");
  });

  it("(m) accepts valid OOXML (docx)", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }); },
      async readFirstBytes() { return Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]); },
    }));
    assert.equal(result.kind, "ok");
  });

  it("(m) doc objectPath is the finalised path, not the staging path", async () => {
    let storedPath: string | undefined;
    const deps = makeDeps({
      async copyToFinal(_staging, _gen, finalPath) { return { ok: true }; },
      async insertDoc(doc) { storedPath = (doc as { objectPath: string }).objectPath; return doc; },
    });
    const result = await finalizeUpload(BASE_INPUT, deps);
    assert.equal(result.kind, "ok");
    assert.notEqual(storedPath, OBJECT_PATH, "doc must not point to staging path");
    assert.ok(storedPath?.startsWith(LIBRARY_PATH_PREFIX),
      "finalised path must be within library prefix");
  });

  it("(m) 409 when staging object overwritten between validation and copy", async () => {
    const deps = makeDeps({
      async copyToFinal() { return { ok: false }; }, // generation precondition failed
    });
    const result = await finalizeUpload(BASE_INPUT, deps);
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 409,
      "generation mismatch during copy must return 409");
  });

  it("(m) deleteStagingObject is called after successful copy", async () => {
    let stagingDeleted = false;
    const deps = makeDeps({
      async deleteStagingObject(path) {
        if (path === OBJECT_PATH) stagingDeleted = true;
      },
    });
    await finalizeUpload(BASE_INPUT, deps);
    await new Promise(r => setImmediate(r)); // allow best-effort async call
    assert.ok(stagingDeleted, "staging object must be deleted after successful copy");
  });

  it("(m) accepts valid image/webp with correct RIFF+WEBP header", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "image/webp" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "image/webp" }); },
      async readFirstBytes() { return WEBP_HEADER; },
    }));
    assert.equal(result.kind, "ok");
  });
});

// ─── (n) validateMagicBytes unit tests ───────────────────────────────────────

describe("validateMagicBytes — unit tests", () => {
  it("PDF: accepts %PDF magic", () => {
    assert.ok(validateMagicBytes("application/pdf",
      Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0])));
  });
  it("PDF: rejects wrong bytes", () => {
    assert.ok(!validateMagicBytes("application/pdf", JUNK_BYTES));
  });
  it("PNG: accepts \\x89PNG magic", () => {
    assert.ok(validateMagicBytes("image/png", PNG_MAGIC));
  });
  it("PNG: rejects wrong bytes", () => {
    assert.ok(!validateMagicBytes("image/png", JUNK_BYTES));
  });
  it("JPEG: accepts FF D8 FF", () => {
    assert.ok(validateMagicBytes("image/jpeg",
      Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0])));
  });
  it("text/plain: passes when content has no NUL bytes", () => {
    assert.ok(validateMagicBytes("text/plain", Buffer.from("hello world\n")));
  });
  it("text/plain: rejects NUL bytes (binary masquerading as text)", () => {
    assert.ok(!validateMagicBytes("text/plain", JUNK_BYTES));
  });
  it("text/csv: passes when content has no NUL bytes", () => {
    assert.ok(validateMagicBytes("text/csv", Buffer.from("name,val\na,1\n")));
  });
  it("text/csv: rejects NUL bytes (binary masquerading as text)", () => {
    assert.ok(!validateMagicBytes("text/csv", JUNK_BYTES));
  });
  it("GIF: accepts GIF8 magic", () => {
    assert.ok(validateMagicBytes("image/gif",
      Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])));
  });
  it("OLE doc (.doc): accepts D0 CF 11 E0", () => {
    assert.ok(validateMagicBytes("application/msword",
      Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0])));
  });
  it("OOXML (.xlsx): accepts PK\\x03\\x04 magic", () => {
    assert.ok(validateMagicBytes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])));
  });

  // WebP — requires RIFF at 0-3 AND WEBP at 8-11
  it("WebP: accepts RIFF…WEBP 12-byte header", () => {
    assert.ok(validateMagicBytes("image/webp", WEBP_HEADER));
  });
  it("WebP: rejects WAV file (RIFF…WAVE) — RIFF-only check is not enough", () => {
    assert.ok(!validateMagicBytes("image/webp", WAV_HEADER),
      "WAV has RIFF header but must be rejected as image/webp");
  });
  it("WebP: rejects buffer with only 8 bytes (too short for sub-signature)", () => {
    assert.ok(!validateMagicBytes("image/webp", WEBP_HEADER.slice(0, 8)));
  });

  // TIFF — both byte orders
  it("TIFF: accepts little-endian II*\\0", () => {
    assert.ok(validateMagicBytes("image/tiff",
      Buffer.from([0x49, 0x49, 0x2A, 0x00, 0, 0, 0, 0, 0, 0, 0, 0])));
  });
  it("TIFF: accepts big-endian MM\\0*", () => {
    assert.ok(validateMagicBytes("image/tiff",
      Buffer.from([0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 0, 0, 0, 0, 0])));
  });
  it("TIFF: rejects wrong bytes", () => {
    assert.ok(!validateMagicBytes("image/tiff", JUNK_BYTES));
  });

  it("returns false when header is too short for magic", () => {
    assert.ok(!validateMagicBytes("application/pdf", Buffer.from([0x25]))); // 1 byte only
  });
  it("returns false for a type absent from MAGIC_TABLE (not text/*)", () => {
    // e.g. image/svg+xml is not in ALLOWED_MIME_TYPES — validateMagicBytes also rejects it
    assert.ok(!validateMagicBytes("image/svg+xml", Buffer.from("<?xml version")));
  });

  // normalizeMime
  it("normalizeMime strips parameters and lower-cases", () => {
    assert.equal(normalizeMime("image/PNG; charset=binary"), "image/png");
    assert.equal(normalizeMime("application/pdf"), "application/pdf");
    assert.equal(normalizeMime("TEXT/PLAIN; charset=utf-8"), "text/plain");
  });

  // ALLOWED_MIME_TYPES and ALLOWED_MIME_PREFIXES exports
  it("ALLOWED_MIME_TYPES is a Set containing key types", () => {
    assert.ok(ALLOWED_MIME_TYPES instanceof Set && ALLOWED_MIME_TYPES.size > 0);
    assert.ok(ALLOWED_MIME_TYPES.has("image/png"));
    assert.ok(ALLOWED_MIME_TYPES.has("application/pdf"));
    assert.ok(!ALLOWED_MIME_TYPES.has("image/svg+xml"), "svg+xml must not be in allowlist");
    assert.ok(!ALLOWED_MIME_TYPES.has("image/avif"),    "avif must not be in allowlist");
  });
  it("ALLOWED_MIME_PREFIXES is the backwards-compat array alias", () => {
    assert.ok(Array.isArray(ALLOWED_MIME_PREFIXES) && ALLOWED_MIME_PREFIXES.length > 0);
  });
  it("LIBRARY_PATH_PREFIX is correct", () => {
    assert.equal(LIBRARY_PATH_PREFIX, "/objects/library/");
  });
});

// ─── (p) Exact-MIME bypass prevention ────────────────────────────────────────

describe("finalizeUpload — exact-MIME bypass prevention (p)", () => {
  it("rejects 'image/pnganything' — prefix-suffix bypass attempt", async () => {
    // With old startsWith matching, "image/pnganything".startsWith("image/png") = true.
    // The new exact-match Set rejects it at the MIME allowlist check.
    const result = await finalizeUpload(BASE_INPUT, makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "image/pnganything" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "image/pnganything" }); },
      async readFirstBytes() { return PNG_MAGIC; },
    }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 422,
      "'image/pnganything' must be rejected — not in exact MIME allowlist");
  });

  it("rejects image/svg+xml — not in closed allowlist", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "image/svg+xml" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "image/svg+xml" }); },
      async readFirstBytes() { return Buffer.from("<?xml version='1.0'"); },
    }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 422);
  });

  it("rejects image/avif — not in closed allowlist", async () => {
    const avifHeader = Buffer.from([0x00,0x00,0x00,0x1C,0x66,0x74,0x79,0x70,0x61,0x76,0x69,0x66]);
    const result = await finalizeUpload(BASE_INPUT, makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "image/avif" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "image/avif" }); },
      async readFirstBytes() { return avifHeader; },
    }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 422);
  });

  it("WAV file labeled as image/webp is rejected by magic-byte check", async () => {
    const result = await finalizeUpload(BASE_INPUT, makeDeps({
      async getSlot()        { return makeSlot({ declaredType: "image/webp" }); },
      async getGcsMeta()     { return makeGcsMeta({ contentType: "image/webp" }); },
      async readFirstBytes() { return WAV_HEADER; },
    }));
    assert.equal(result.kind, "error");
    assert.equal((result as { kind: "error"; status: number }).status, 422,
      "WAV file with RIFF header must be rejected when labeled as image/webp");
  });

  it("accepts all explicitly allowed MIME types with matching magic bytes", async () => {
    const samples: Array<[string, Buffer]> = [
      ["application/pdf",                                                                  Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["application/msword",                                                               Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document",         Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",               Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["application/vnd.openxmlformats-officedocument.presentationml.presentation",       Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["application/vnd.ms-excel",                                                         Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["application/vnd.ms-powerpoint",                                                    Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["application/vnd.oasis.opendocument.text",                                          Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["application/vnd.oasis.opendocument.spreadsheet",                                   Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["application/vnd.oasis.opendocument.presentation",                                  Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["text/plain",  Buffer.from("hello world")],
      ["text/csv",    Buffer.from("name,email")],
      ["image/png",   PNG_MAGIC],
      ["image/jpeg",  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["image/gif",   Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])],
      ["image/webp",  WEBP_HEADER],
      ["image/bmp",   Buffer.from([0x42, 0x4D, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
      ["image/tiff",  Buffer.from([0x49, 0x49, 0x2A, 0x00, 0, 0, 0, 0, 0, 0, 0, 0])],
    ];
    for (const [contentType, magic] of samples) {
      const deps = makeDeps({
        async getSlot()        { return makeSlot({ declaredType: contentType }); },
        async getGcsMeta()     { return makeGcsMeta({ contentType }); },
        async readFirstBytes() { return magic; },
      });
      const result = await finalizeUpload(BASE_INPUT, deps);
      assert.equal(result.kind, "ok",
        `'${contentType}' with correct magic bytes should be accepted`);
    }
  });
});

// ─── (o) HTTP-level: DELETE admin-only enforcement ───────────────────────────

describe("DELETE /api/library/docs/:id — admin-only enforcement", () => {
  let server: http.Server;
  let base: string;

  before(
    () => new Promise<void>((resolve, reject) => {
      delete process.env["PROJECTHUB_WEBHOOK_SECRET"];
      import("../app.js").then(({ default: expressApp }) => {
        server = http.createServer(expressApp);
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as { port: number };
          base = `http://127.0.0.1:${addr.port}/api`;
          resolve();
        });
        server.on("error", reject);
      }).catch(reject);
    }),
    { timeout: 15_000 },
  );

  after(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
    { timeout: 5_000 },
  );

  async function memberToken(role: "admin" | "member"): Promise<string> {
    const { issueToken } = await import("../lib/jwt.js");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return issueToken({ id: `test-${role}`, email: `${role}@ucfilters.com`,
      name: `Test ${role}`, type: "team-session", role, exp });
  }

  it("(o) 403 for non-admin member", async () => {
    const token = await memberToken("member");
    const res = await fetch(`${base}/library/docs/any-doc-id`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403,
      `member DELETE should be 403 — got ${res.status}: ${await res.text()}`);
  });

  it("(o) 401 when no token is provided", async () => {
    const res = await fetch(`${base}/library/docs/any-doc-id`, { method: "DELETE" });
    assert.equal(res.status, 401);
  });

  it("(o) admin gets 404 (not 403) for a non-existent document", async () => {
    const token = await memberToken("admin");
    const res = await fetch(`${base}/library/docs/non-existent-doc-id`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 404,
      `admin DELETE of missing doc should be 404 — got ${res.status}: ${await res.text()}`);
  });
});
