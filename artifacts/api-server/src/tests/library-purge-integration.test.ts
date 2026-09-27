/**
 * Finalization integration: an expired upload is purged after a different
 * upload succeeds. Everything stays in memory so this test cannot race other
 * API files that share the test database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  finalizeUpload,
  purgeAbandonedSlots,
  type FinalizerDeps,
  type SlotRow,
} from "../lib/libraryFinalizer.js";

const PDF_BYTES = Buffer.from("%PDF-1.7\nin-memory purge integration");

describe("library purge-expired integration", () => {
  it("purges an expired unconsumed staging object after successful finalization", async () => {
    const liveId = randomUUID();
    const expiredId = randomUUID();
    const livePath = `/objects/uploads/live-${liveId}`;
    const expiredPath = `/objects/uploads/expired-${expiredId}`;
    const slots = new Map<string, SlotRow>([
      [liveId, {
        uploadedBy: "team@projecthub.internal",
        objectPath: livePath,
        declaredType: "application/pdf",
        consumed: false,
        expiresAt: new Date(Date.now() + 60_000),
      }],
      [expiredId, {
        uploadedBy: "team@projecthub.internal",
        objectPath: expiredPath,
        declaredType: "application/pdf",
        consumed: false,
        expiresAt: new Date(Date.now() - 60_000),
      }],
    ]);
    const deletedPaths: string[] = [];
    let purgeResolved!: () => void;
    const purgeFinished = new Promise<void>((resolve) => { purgeResolved = resolve; });

    const deps: FinalizerDeps = {
      async getSlot(id) { return slots.get(id); },
      async consumeSlot(id) {
        const slot = slots.get(id);
        if (!slot || slot.consumed || slot.expiresAt <= new Date()) return false;
        slot.consumed = true;
        return true;
      },
      async getGcsMeta() {
        return { contentType: "application/pdf", size: PDF_BYTES.length, generation: "1" };
      },
      async readFirstBytes() { return PDF_BYTES.subarray(0, 12); },
      async copyToFinal() { return { ok: true }; },
      async deleteStagingObject(path) { deletedPaths.push(path); },
      async insertDoc(doc) { return doc; },
      async purgeExpired() {
        await purgeAbandonedSlots({
          async listExpiredSlots() {
            return [...slots.values()]
              .filter(slot => slot.expiresAt < new Date())
              .map(slot => ({ objectPath: slot.objectPath, consumed: slot.consumed }));
          },
          async deleteObject(path) { deletedPaths.push(path); },
          async deleteExpiredSlots() {
            for (const [id, slot] of slots) {
              if (slot.expiresAt < new Date()) slots.delete(id);
            }
          },
        });
        purgeResolved();
      },
    };

    const result = await finalizeUpload({
      uploadId: liveId,
      memberEmail: "team@projecthub.internal",
      title: "Live document",
      fileName: "live.pdf",
    }, deps);

    assert.equal(result.kind, "ok");
    await Promise.race([
      purgeFinished,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("purge did not complete")), 1_000)),
    ]);
    assert.ok(deletedPaths.includes(expiredPath), "expired staging object should be deleted");
    assert.equal(slots.has(expiredId), false, "expired upload slot should be removed");
  });
});