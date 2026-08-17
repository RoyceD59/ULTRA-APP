/**
 * Integration test: purgeExpired fires during finalisation and deletes
 * abandoned GCS staging objects.
 *
 * Scenario
 * ────────
 *   1. An expired, unconsumed pending-upload row is inserted directly into the
 *      DB (simulating an upload that was requested but never finalised).
 *   2. A team member successfully finalises a *different* live upload via
 *      POST /api/library/docs.
 *   3. finalizeUpload fires deps.purgeExpired() as a fire-and-forget side-effect.
 *   4. The test waits for the side-effect and asserts:
 *        (a) GCS deleteObject was called with the expired slot's objectPath.
 *        (b) The expired DB row has been removed.
 *
 * GCS is stubbed at the ObjectStorageService prototype level — no real storage.
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { randomUUID } from "crypto";

process.env["SESSION_SECRET"] ??= "test-secret-purge-integration";

import { issueToken } from "../lib/jwt.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { db, teamLibraryDocsTable, teamLibraryPendingUploadsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── GCS stub ──────────────────────────────────────────────────────────────────

const PDF_BYTES = Buffer.from("%PDF-1.7\nstub pdf body for purge integration");

/** Paths whose GCS file.delete() was called during this test run. */
const deletedPaths: string[] = [];

/**
 * One-shot latch: set before triggering finalization so the test can await
 * the fire-and-forget purge side-effect.
 */
let purgeLatch: { path: string; resolve: () => void } | null = null;

// Save originals so the after() hook can restore them.
const origGetLibraryURL = ObjectStorageService.prototype.getLibraryUploadURL;
const origNormalize     = ObjectStorageService.prototype.normalizeObjectEntityPath;
const origGetEntityFile = ObjectStorageService.prototype.getObjectEntityFile;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const origCopyFinal = (ObjectStorageService.prototype as any).copyLibraryFileWithGenerationCheck;

before(() => {
  let urlCounter = 0;

  ObjectStorageService.prototype.getLibraryUploadURL = async function () {
    urlCounter += 1;
    return `https://storage.test/bucket/uploads/purge-integ-${urlCounter}?sig=x`;
  };

  ObjectStorageService.prototype.normalizeObjectEntityPath = function (raw: string) {
    const n = new URL(raw).pathname.split("-").pop();
    return `/objects/uploads/purge-integ-${n}`;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ObjectStorageService.prototype.getObjectEntityFile = async function (objectPath: string): Promise<any> {
    return {
      name:   objectPath,
      exists: async () => [true],
      getMetadata: async () => [{
        contentType: "application/pdf",
        size:        PDF_BYTES.length,
        generation:  1,
      }],
      createReadStream(opts?: { start?: number; end?: number }) {
        const start = opts?.start ?? 0;
        const end   = opts?.end !== undefined ? opts.end + 1 : PDF_BYTES.length;
        return Readable.from([Buffer.from(PDF_BYTES).slice(start, end)]);
      },
      delete: async () => {
        deletedPaths.push(objectPath);
        // Resolve the latch if it is waiting for this specific path.
        if (purgeLatch && purgeLatch.path === objectPath) {
          purgeLatch.resolve();
          purgeLatch = null;
        }
      },
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ObjectStorageService.prototype as any).copyLibraryFileWithGenerationCheck =
    async function (_src: string, _dest: string, _gen: number): Promise<boolean> {
      return true; // always succeeds — we are testing purge, not copy semantics
    };
});

after(() => {
  ObjectStorageService.prototype.getLibraryUploadURL              = origGetLibraryURL;
  ObjectStorageService.prototype.normalizeObjectEntityPath        = origNormalize;
  ObjectStorageService.prototype.getObjectEntityFile              = origGetEntityFile;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ObjectStorageService.prototype as any).copyLibraryFileWithGenerationCheck = origCopyFinal;
});

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;
const createdDocIds:  string[] = [];
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.delete(teamLibraryPendingUploadsTable).where(eq(teamLibraryPendingUploadsTable.id as any, id));
  }
  await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function teamAuth(): string {
  return `Bearer ${issueToken({
    id:    "team",
    email: "team@projecthub.internal",
    type:  "team-session",
    role:  "admin",
    exp:   Math.floor(Date.now() / 1000) + 3600,
  })}`;
}

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: teamAuth() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

async function requestSlot(): Promise<string> {
  const { status, data } = await api("POST", "/library/request-upload", {
    fileName: "report.pdf",
    fileSize: PDF_BYTES.length,
    fileType: "application/pdf",
  });
  assert.equal(status, 200, `request-upload failed: ${JSON.stringify(data)}`);
  const uploadId = String(data["uploadId"]);
  createdSlotIds.push(uploadId);
  return uploadId;
}

async function finalize(uploadId: string) {
  return api("POST", "/library/docs", {
    title:    "Purge Integration Test Doc",
    fileName: "report.pdf",
    fileSize: PDF_BYTES.length,
    fileType: "application/pdf",
    uploadId,
  });
}

// ── Test ──────────────────────────────────────────────────────────────────────

describe("library purge-expired integration", () => {
  it(
    "purgeExpired deletes the GCS staging object for an expired unconsumed slot " +
    "when triggered as a side-effect of successful finalisation",
    async () => {
      // ── 1. Insert an expired, unconsumed slot directly into the DB ────────
      //   Simulates an upload that was requested but the client never finalised.
      const expiredSlotId  = randomUUID();
      const expiredObjPath = `/objects/uploads/expired-abandoned-${expiredSlotId}`;

      await db.insert(teamLibraryPendingUploadsTable).values({
        id:           expiredSlotId,
        objectPath:   expiredObjPath,
        uploadedBy:   "team@projecthub.internal",
        consumed:     false,
        expiresAt:    new Date(Date.now() - 60_000), // 1 minute in the past
        declaredSize: PDF_BYTES.length,
        declaredType: "application/pdf",
      });
      // Register for cleanup in case the purge doesn't remove it (test failure path).
      createdSlotIds.push(expiredSlotId);

      // ── 2. Arm the latch before triggering the side-effect ────────────────
      //   We set it up now so we can't miss a very fast resolution.
      const purgeSettled = new Promise<void>((resolve) => {
        purgeLatch = { path: expiredObjPath, resolve };
      });

      // ── 3. Finalise a *different* live slot ───────────────────────────────
      //   finalizeUpload fires deps.purgeExpired() fire-and-forget at the end.
      const liveSlotId = await requestSlot();
      const { status, data } = await finalize(liveSlotId);
      assert.equal(status, 201, `finalization must succeed: ${JSON.stringify(data)}`);
      createdDocIds.push(String(data["id"]));

      // ── 4. Wait for the side-effect (max 5 s) ────────────────────────────
      const timeoutGuard = new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(
            "purgeExpired did not delete the expired staging object within 5 s — " +
            `deleted so far: [${deletedPaths.join(", ")}]`,
          )),
          5_000,
        ),
      );
      await Promise.race([purgeSettled, timeoutGuard]);

      // ── 5. GCS delete must have been called for the expired slot ──────────
      assert.ok(
        deletedPaths.includes(expiredObjPath),
        `GCS deleteObject must have been called for the expired slot's objectPath ` +
        `(got: [${deletedPaths.join(", ")}])`,
      );

      // ── 6. Expired DB row must have been removed ──────────────────────────
      // deleteExpiredSlots() runs sequentially *after* Promise.allSettled of the
      // GCS deletes inside purgeAbandonedSlots, so we may need to wait a tick or
      // two for the DB row to disappear.  Poll for up to 2 s before failing.
      let remaining: { id: unknown }[] = [];
      const dbDeadline = Date.now() + 2_000;
      do {
        remaining = await db
          .select({ id: teamLibraryPendingUploadsTable.id })
          .from(teamLibraryPendingUploadsTable)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .where(eq(teamLibraryPendingUploadsTable.id as any, expiredSlotId));
        if (remaining.length === 0) break;
        await new Promise<void>(r => setTimeout(r, 50));
      } while (Date.now() < dbDeadline);

      assert.equal(
        remaining.length, 0,
        "expired DB row must be deleted after purgeExpired runs",
      );
    },
  );
});
