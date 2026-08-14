/**
 * Adapter-level tests for ObjectStorageService.copyLibraryFileWithGenerationCheck.
 *
 * PURPOSE
 * ───────
 * The TOCTOU guard in the library upload flow relies on baking the staging
 * object's generation number into the GCS copy request.  The unit tests in
 * library-upload-grant.test.ts mock the entire copyToFinal dep, so they cannot
 * verify that the real GCS adapter actually passes the generation.
 *
 * These tests work one layer below the route, against the ObjectStorageService
 * method directly.  They intercept objectStorageClient.bucket().file() to
 * verify the generation is passed, and mock File.copy() to verify it is called
 * with the correct destination precondition (ifGenerationMatch: 0).
 *
 * No real GCS connection is required.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env["PRIVATE_OBJECT_DIR"] ??= "gs://test-bucket/private/";
process.env["PUBLIC_OBJECT_SEARCH_PATHS"] ??= "[]";
process.env["SESSION_SECRET"] ??= "test-secret-gen-check";

import { objectStorageClient, ObjectStorageService } from "../lib/objectStorage.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Records of calls intercepted from GCS client.bucket().file() */
type FileCallRecord = {
  bucketName: string;
  objectName: string;
  generation: number | undefined;
};

interface CopyCallRecord {
  copyCalledOn: string;   // objectName of the source File
  destObjectName: string; // objectName of the dest File passed to copy()
  destBucket: string;
  preconditionOpts: unknown;
  ifGenerationMatch: unknown;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("ObjectStorageService.copyLibraryFileWithGenerationCheck — adapter-level", () => {
  const svc = new ObjectStorageService();

  // We intercept bucket().file() on the live objectStorageClient to avoid
  // actual GCS network calls while still exercising the real code path.
  let fileCallRecords: FileCallRecord[] = [];
  let copyCallRecords: CopyCallRecord[] = [];
  let copyThrows = false;

  const originalBucket = objectStorageClient.bucket.bind(objectStorageClient);

  before(() => {
    // Replace objectStorageClient.bucket with an interceptor that records the
    // generation option passed to file() and provides a mock copy() method.
    (objectStorageClient as unknown as Record<string, unknown>).bucket = (
      bucketName: string,
    ) => {
      return {
        file: (objectName: string, opts?: { generation?: number }) => {
          fileCallRecords.push({ bucketName, objectName, generation: opts?.generation });
          // Return a mock File-like object.
          const mockFile = {
            _bucketName: bucketName,
            _objectName: objectName,
            _generation: opts?.generation,
            exists: async () => [true],
            copy: async (
              dest: { _objectName: string; _bucketName: string },
              options?: { preconditionOpts?: { ifGenerationMatch?: unknown } },
            ) => {
              copyCallRecords.push({
                copyCalledOn:   objectName,
                destObjectName: dest._objectName,
                destBucket:     dest._bucketName,
                preconditionOpts:  options?.preconditionOpts,
                ifGenerationMatch: options?.preconditionOpts?.ifGenerationMatch,
              });
              if (copyThrows) throw Object.assign(new Error("Precondition Failed"), { code: 412 });
              return [mockFile, {}];
            },
          };
          return mockFile;
        },
      };
    };
  });

  after(() => {
    // Restore the real bucket method.
    (objectStorageClient as unknown as Record<string, unknown>).bucket = originalBucket;
  });

  function reset() {
    fileCallRecords = [];
    copyCallRecords = [];
    copyThrows = false;
  }

  it("passes the correct generation to bucket.file() for the source object", async () => {
    reset();
    const result = await svc.copyLibraryFileWithGenerationCheck(
      "/objects/uploads/staging-abc",
      "/objects/library/final/dest-xyz",
      987654321,
    );
    assert.ok(result, "should return true on successful copy");

    // There should be at least one file() call for the source with the
    // expected generation number baked in.
    const sourceCall = fileCallRecords.find(r => r.generation === 987654321);
    assert.ok(
      sourceCall !== undefined,
      `bucket.file() must be called with generation=987654321; calls were: ${JSON.stringify(fileCallRecords)}`,
    );
    assert.equal(
      sourceCall.generation,
      987654321,
      "source File reference must carry the staging generation number",
    );
  });

  it("copy() is called with ifGenerationMatch: 0 on the destination", async () => {
    reset();
    await svc.copyLibraryFileWithGenerationCheck(
      "/objects/uploads/staging-abc",
      "/objects/library/final/dest-xyz",
      111222333,
    );
    assert.ok(copyCallRecords.length > 0, "copy() must be called");
    const rec = copyCallRecords[0]!;
    assert.equal(
      rec.ifGenerationMatch,
      0,
      "copy() must pass preconditionOpts.ifGenerationMatch=0 so the destination must not already exist",
    );
  });

  it("copy() is NOT called on the destination File — it is called on the source (generation-pinned) File", async () => {
    reset();
    await svc.copyLibraryFileWithGenerationCheck(
      "/objects/uploads/staging-abc",
      "/objects/library/final/dest-xyz",
      555666777,
    );
    assert.ok(copyCallRecords.length > 0, "copy() must be called");
    const rec = copyCallRecords[0]!;
    // The source objectName (the staging path fragment) must be the one copy()
    // was called on, not the destination.
    assert.ok(
      rec.copyCalledOn.includes("staging-abc"),
      `copy() must be called on the source (staging) File; called on: ${rec.copyCalledOn}`,
    );
  });

  it("returns false when the GCS copy throws (generation mismatch / precondition failure)", async () => {
    reset();
    copyThrows = true;
    const result = await svc.copyLibraryFileWithGenerationCheck(
      "/objects/uploads/staging-abc",
      "/objects/library/final/dest-xyz",
      999000111,
    );
    assert.equal(result, false, "must return false when copy() throws (simulated 412 / generation mismatch)");
  });

  it("returns false when the GCS copy throws a 404 (source generation no longer exists)", async () => {
    reset();
    (objectStorageClient as unknown as Record<string, unknown>).bucket = (
      bucketName: string,
    ) => ({
      file: (objectName: string, opts?: { generation?: number }) => {
        fileCallRecords.push({ bucketName, objectName, generation: opts?.generation });
        return {
          _bucketName: bucketName,
          _objectName: objectName,
          _generation: opts?.generation,
          exists: async () => [true],
          copy: async () => {
            throw Object.assign(
              new Error("No such object generation"),
              { code: 404 },
            );
          },
        };
      },
    });
    const result = await svc.copyLibraryFileWithGenerationCheck(
      "/objects/uploads/staging-new-gen",
      "/objects/library/final/dest-new-gen",
      42,
    );
    assert.equal(
      result,
      false,
      "must return false when copy throws 404 (staging overwritten, generation gone)",
    );
    // Restore for subsequent tests.
    before(() => {});
  });
});
