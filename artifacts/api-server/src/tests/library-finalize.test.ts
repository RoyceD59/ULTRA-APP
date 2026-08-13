/**
 * Integration tests for the library upload flow:
 *   POST /api/library/request-upload → (stubbed GCS PUT) → POST /api/library/docs
 *
 * Covers:
 *   1. Two sequential uploads both succeed with distinct server-generated IDs.
 *   2. Replaying the same uploadId is rejected (slot single-use).
 *   3. Mislabelled content (contentType metadata not matching real bytes) is rejected.
 *
 * GCS is stubbed at the ObjectStorageService prototype level so no real
 * storage access happens.
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env["SESSION_SECRET"] ??= "test-secret-library-finalize";

import { issueToken } from "../lib/jwt.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { db, teamLibraryDocsTable, teamLibraryPendingUploadsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

// ── GCS stub ──────────────────────────────────────────────────────────────────

const PDF_BYTES = Buffer.from("%PDF-1.7\nfake pdf body");
let stubContentType = "application/pdf";
let stubSize = PDF_BYTES.length;
let stubBytes: Buffer = PDF_BYTES;

const origGetUploadURL  = ObjectStorageService.prototype.getObjectEntityUploadURL;
const origNormalize     = ObjectStorageService.prototype.normalizeObjectEntityPath;
const origGetEntityFile = ObjectStorageService.prototype.getObjectEntityFile;
const origPromote       = ObjectStorageService.prototype.promoteObjectEntity;

let objectCounter = 0;
// Simulated immutable store: bytes frozen at promotion time, keyed by final path.
const promotedStore = new Map<string, Buffer>();
// Simulated GCS generation semantics for the staging object.
let liveGeneration = 1;
// Optional hook fired right after a successful pinned download (i.e. between
// validation and promotion) — used to simulate a TOCTOU overwrite.
let afterValidationHook: (() => void) | null = null;

/** Simulate the uploader overwriting the staging object via the presigned PUT. */
function overwriteStagingObject(bytes: Buffer) {
  stubBytes = bytes;
  stubSize = bytes.length;
  liveGeneration += 1; // the validated generation no longer exists (no versioning)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
function makeStagingHandle(pinnedGen?: number): any {
  return {
    name: "uploads/staging-object",
    bucket: { file: (_name: string, opts?: { generation?: number }) => makeStagingHandle(opts?.generation) },
    exists:      async () => [true],
    getMetadata: async () => [{ contentType: stubContentType, size: stubSize, generation: liveGeneration }],
    download:    async () => {
      if (pinnedGen !== undefined && pinnedGen !== liveGeneration) {
        throw new Error("No such object generation");
      }
      const bytes = Buffer.from(stubBytes);
      afterValidationHook?.();
      return [bytes];
    },
    delete: async () => undefined,
  };
}

before(() => {
  ObjectStorageService.prototype.getObjectEntityUploadURL = async function () {
    objectCounter += 1;
    return `https://storage.test/bucket/uploads/test-object-${objectCounter}?sig=x`;
  };
  ObjectStorageService.prototype.normalizeObjectEntityPath = function (raw: string) {
    return `/objects/uploads/test-object-${new URL(raw).pathname.split("-").pop()}`;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
  ObjectStorageService.prototype.getObjectEntityFile = async function (): Promise<any> {
    return makeStagingHandle();
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
  ObjectStorageService.prototype.promoteObjectEntity = async function (_file: any, generation: number): Promise<string> {
    // Mirror real generation-pinned copy semantics: if the staging object was
    // overwritten after validation, the validated generation no longer exists
    // and the copy fails instead of promoting unvalidated bytes.
    if (generation !== liveGeneration) {
      throw new Error("No such object generation — staging object was modified");
    }
    objectCounter += 1;
    const finalPath = `/objects/library/promoted-${objectCounter}`;
    promotedStore.set(finalPath, Buffer.from(stubBytes));
    return finalPath;
  };
});

after(() => {
  ObjectStorageService.prototype.getObjectEntityUploadURL  = origGetUploadURL;
  ObjectStorageService.prototype.normalizeObjectEntityPath = origNormalize;
  ObjectStorageService.prototype.getObjectEntityFile       = origGetEntityFile;
  ObjectStorageService.prototype.promoteObjectEntity       = origPromote;
});

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;
const createdDocIds: string[] = [];
const createdSlotIds: string[] = [];

before(async () => {
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  if (createdDocIds.length) {
    await db.delete(teamLibraryDocsTable).where(inArray(teamLibraryDocsTable.id, createdDocIds));
  }
  for (const id of createdSlotIds) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk
    await db.delete(teamLibraryPendingUploadsTable).where(eq(teamLibraryPendingUploadsTable.id as any, id));
  }
  await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
});

function teamAuth(): string {
  return `Bearer ${issueToken({
    id: "team",
    email: "team@projecthub.internal",
    type: "team-session",
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
}

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: teamAuth() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

async function requestSlot(fileType = "application/pdf", fileSize = PDF_BYTES.length) {
  const { status, data } = await api("POST", "/library/request-upload", {
    fileName: "report.pdf", fileSize, fileType,
  });
  assert.equal(status, 200, `request-upload failed: ${JSON.stringify(data)}`);
  createdSlotIds.push(String(data["uploadId"]));
  return String(data["uploadId"]);
}

async function finalize(uploadId: string) {
  return api("POST", "/library/docs", {
    title: "Test Doc", fileName: "report.pdf",
    fileSize: PDF_BYTES.length, fileType: "application/pdf", uploadId,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("library upload finalization", () => {
  it("two sequential uploads both succeed with distinct IDs", async () => {
    stubContentType = "application/pdf"; stubSize = PDF_BYTES.length; stubBytes = PDF_BYTES;

    const first = await finalize(await requestSlot());
    assert.equal(first.status, 201, `first upload failed: ${JSON.stringify(first.data)}`);
    const firstId = String(first.data["id"]);
    createdDocIds.push(firstId);

    const second = await finalize(await requestSlot());
    assert.equal(second.status, 201, `second upload failed: ${JSON.stringify(second.data)}`);
    const secondId = String(second.data["id"]);
    createdDocIds.push(secondId);

    assert.ok(firstId && firstId !== "undefined", "document ID must be server-generated");
    assert.notEqual(firstId, secondId, "each upload must get its own document ID");
  });

  it("replaying the same uploadId is rejected", async () => {
    stubContentType = "application/pdf"; stubSize = PDF_BYTES.length; stubBytes = PDF_BYTES;
    const uploadId = await requestSlot();

    const first = await finalize(uploadId);
    assert.equal(first.status, 201);
    createdDocIds.push(String(first.data["id"]));

    const replay = await finalize(uploadId);
    assert.equal(replay.status, 409, "slot must be single-use");
  });

  it("stores the document under a promoted immutable key, unaffected by later staging overwrites", async () => {
    stubContentType = "application/pdf"; stubSize = PDF_BYTES.length; stubBytes = PDF_BYTES;

    const { status, data } = await finalize(await requestSlot());
    assert.equal(status, 201, `upload failed: ${JSON.stringify(data)}`);
    createdDocIds.push(String(data["id"]));

    const objectPath = String(data["objectPath"]);
    assert.ok(objectPath.startsWith("/objects/library/"), "document must live under a promoted server-controlled key");
    assert.ok(!objectPath.includes("/uploads/"), "document must not point at the client-writable staging path");

    // Simulate the attacker reusing the still-valid presigned PUT URL to
    // overwrite the staging object AFTER finalisation.
    stubBytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46]); // ELF payload

    const stored = promotedStore.get(objectPath);
    assert.ok(stored, "promoted copy must exist");
    assert.ok(stored.equals(PDF_BYTES), "stored document must remain the validated bytes despite staging overwrite");
  });

  it("TOCTOU: an overwrite between validation and promotion is rejected, never promoted", async () => {
    stubContentType = "application/pdf"; stubSize = PDF_BYTES.length; stubBytes = PDF_BYTES;
    const uploadId = await requestSlot();

    // Overwrite the staging object immediately AFTER the validation read but
    // BEFORE promotion — the classic TOCTOU window.
    afterValidationHook = () => {
      overwriteStagingObject(Buffer.from([0x7f, 0x45, 0x4c, 0x46])); // ELF payload
      afterValidationHook = null;
    };
    try {
      const { status, data } = await finalize(uploadId);
      assert.equal(status, 502, `overwritten staging object must not be promoted: ${JSON.stringify(data)}`);
      // No document row may exist for this failed finalisation.
      if (data["id"]) createdDocIds.push(String(data["id"]));
      assert.equal(data["id"], undefined);
      // And nothing with the attacker's bytes was promoted.
      for (const bytes of promotedStore.values()) {
        assert.ok(bytes.equals(PDF_BYTES) || !bytes.includes(0x7f), "unvalidated bytes must never reach the immutable store");
      }
    } finally {
      afterValidationHook = null;
    }
  });

  it("rejects content whose real bytes don't match the claimed type", async () => {
    stubContentType = "application/pdf";
    stubBytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]); // ELF executable
    stubSize = stubBytes.length;

    const uploadId = await requestSlot("application/pdf", stubBytes.length);
    const { status } = await finalize(uploadId);
    assert.equal(status, 422, "mislabelled binary must be rejected by signature validation");
  });
});
