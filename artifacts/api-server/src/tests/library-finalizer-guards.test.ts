/**
 * Security-guard tests for the repaired library upload finalizer.
 *
 * Confirms the finalization core cannot be replayed or hijacked:
 *  – a consumed uploadId is rejected with 409 (both pre-check and atomic race)
 *  – an expired slot is rejected with 410
 *  – a slot owned by user A cannot be finalised by user B (403)
 *  – the actual MIME-type category must match what was declared at
 *    request-upload time (422 otherwise)
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  finalizeUpload,
  type FinalizerDeps,
  type SlotRow,
} from "../lib/libraryFinalizer.js";

const OWNER = "alice@ucfilters.com";

const PDF_HEADER = Buffer.from("%PDF-1.7\n%x");
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

function makeSlot(overrides: Partial<SlotRow> = {}): SlotRow {
  return {
    uploadedBy: OWNER,
    objectPath: "/objects/uploads/staging-1",
    declaredType: "application/pdf",
    consumed: false,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    ...overrides,
  };
}

interface DepOverrides extends Partial<FinalizerDeps> {
  slot?: SlotRow | undefined;
  gcsContentType?: string;
  headerBytes?: Buffer;
}

function makeDeps(o: DepOverrides = {}): FinalizerDeps & { inserted: unknown[]; consumeCalls: number } {
  const inserted: unknown[] = [];
  const state = { consumeCalls: 0 };
  const deps: FinalizerDeps & { inserted: unknown[]; consumeCalls: number } = {
    inserted,
    get consumeCalls() { return state.consumeCalls; },
    async getSlot() { return "slot" in o ? o.slot : makeSlot(); },
    async consumeSlot() { state.consumeCalls += 1; return true; },
    async getGcsMeta() {
      return { contentType: o.gcsContentType ?? "application/pdf", size: 1234, generation: "1" };
    },
    async readFirstBytes() { return o.headerBytes ?? PDF_HEADER; },
    async copyToFinal() { return { ok: true }; },
    async deleteStagingObject() { /* noop */ },
    async insertDoc(doc) { inserted.push(doc); return doc; },
    async purgeExpired() { /* noop */ },
    ...o,
  };
  return deps;
}

const input = { uploadId: "u-1", memberEmail: OWNER, title: "Doc", fileName: "doc.pdf" };

describe("library finalizer security guards", () => {
  it("baseline: a valid, unconsumed, owned slot finalises successfully", async () => {
    const deps = makeDeps();
    const result = await finalizeUpload(input, deps);
    assert.equal(result.kind, "ok");
    assert.equal(deps.inserted.length, 1);
  });

  it("rejects a consumed uploadId with 409 (replay)", async () => {
    const deps = makeDeps({ slot: makeSlot({ consumed: true }) });
    const result = await finalizeUpload(input, deps);
    assert.equal(result.kind, "error");
    assert.equal((result as { status: number }).status, 409);
    assert.equal(deps.inserted.length, 0, "replay must not insert a document");
  });

  it("rejects with 409 when the atomic consume loses the race, even if the pre-check passed", async () => {
    // Slot looks unconsumed at read time, but the conditional UPDATE loses.
    const deps = makeDeps({ consumeSlot: async () => false });
    const result = await finalizeUpload(input, deps);
    assert.equal(result.kind, "error");
    assert.equal((result as { status: number }).status, 409);
    assert.equal(deps.inserted.length, 0);
  });

  it("rejects an expired slot with 410", async () => {
    const deps = makeDeps({ slot: makeSlot({ expiresAt: new Date(Date.now() - 1000) }) });
    const result = await finalizeUpload(input, deps);
    assert.equal(result.kind, "error");
    assert.equal((result as { status: number }).status, 410);
    assert.equal(deps.consumeCalls, 0, "expired slot must never be consumed");
    assert.equal(deps.inserted.length, 0);
  });

  it("rejects finalisation by a different user with 403 (hijack)", async () => {
    const deps = makeDeps();
    const result = await finalizeUpload({ ...input, memberEmail: "mallory@ucfilters.com" }, deps);
    assert.equal(result.kind, "error");
    assert.equal((result as { status: number }).status, 403);
    assert.equal(deps.consumeCalls, 0, "foreign slot must never be consumed");
    assert.equal(deps.inserted.length, 0);
  });

  it("rejects with 422 when the actual MIME category differs from the declared one", async () => {
    // Declared a PDF at request-upload time, but the stored object is a PNG.
    const deps = makeDeps({
      slot: makeSlot({ declaredType: "application/pdf" }),
      gcsContentType: "image/png",
      headerBytes: PNG_HEADER,
    });
    const result = await finalizeUpload(input, deps);
    assert.equal(result.kind, "error");
    assert.equal((result as { status: number }).status, 422);
    assert.match((result as { message: string }).message, /does not match declared type/);
    assert.equal(deps.inserted.length, 0);
  });

  it("accepts when actual and declared types are in the same category", async () => {
    // Declared image/jpeg, actual image/png — same "image" category; magic bytes decide.
    const deps = makeDeps({
      slot: makeSlot({ declaredType: "image/jpeg" }),
      gcsContentType: "image/png",
      headerBytes: PNG_HEADER,
    });
    const result = await finalizeUpload(input, deps);
    assert.equal(result.kind, "ok");
  });

  it("rejects a nonexistent slot with 404", async () => {
    const deps = makeDeps({ slot: undefined });
    const result = await finalizeUpload(input, deps);
    assert.equal(result.kind, "error");
    assert.equal((result as { status: number }).status, 404);
  });
});
