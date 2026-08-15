/**
 * Unit tests for purgeAbandonedSlots (libraryFinalizer.ts).
 *
 * Verifies that:
 *  1. Staging objects for expired, unconsumed (abandoned) slots are deleted
 *     from GCS before the DB rows are purged.
 *  2. Consumed slots (finalized uploads) do NOT trigger a second GCS delete —
 *     their staging objects were already removed during finalization.
 *  3. All expired DB rows are purged regardless of consumed state.
 *  4. A GCS error on one slot doesn't block the DB purge or other deletions.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { purgeAbandonedSlots, type PurgeDeps } from "../lib/libraryFinalizer.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface SlotStub {
  objectPath: string;
  consumed: boolean;
}

function makeDeps(
  slots: SlotStub[],
  overrides: Partial<PurgeDeps> = {},
): PurgeDeps & { deletedPaths: string[]; dbPurged: boolean } {
  const deletedPaths: string[] = [];
  let dbPurged = false;
  const deps: PurgeDeps & { deletedPaths: string[]; dbPurged: boolean } = {
    deletedPaths,
    get dbPurged() { return dbPurged; },
    async listExpiredSlots() { return slots; },
    async deleteObject(path) { deletedPaths.push(path); },
    async deleteExpiredSlots() { dbPurged = true; },
    ...overrides,
  };
  return deps;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("purgeAbandonedSlots", () => {
  it("deletes the staging object for an expired, unconsumed slot", async () => {
    const slot: SlotStub = { objectPath: "/objects/library/staging-abandoned-1", consumed: false };
    const deps = makeDeps([slot]);

    await purgeAbandonedSlots(deps);

    assert.deepEqual(deps.deletedPaths, [slot.objectPath],
      "staging object must be deleted for an abandoned slot");
    assert.equal(deps.dbPurged, true, "DB rows must be purged");
  });

  it("does NOT delete the GCS object for an expired but already-consumed slot", async () => {
    const slot: SlotStub = { objectPath: "/objects/library/staging-consumed-1", consumed: true };
    const deps = makeDeps([slot]);

    await purgeAbandonedSlots(deps);

    assert.deepEqual(deps.deletedPaths, [],
      "consumed slot's staging object must not be deleted again — finalizeUpload already removed it");
    assert.equal(deps.dbPurged, true, "DB rows must still be purged");
  });

  it("deletes only the abandoned staging objects when the batch is mixed", async () => {
    const abandoned1: SlotStub = { objectPath: "/objects/library/staging-ab-1", consumed: false };
    const consumed:   SlotStub = { objectPath: "/objects/library/staging-co-1", consumed: true  };
    const abandoned2: SlotStub = { objectPath: "/objects/library/staging-ab-2", consumed: false };
    const deps = makeDeps([abandoned1, consumed, abandoned2]);

    await purgeAbandonedSlots(deps);

    assert.equal(deps.deletedPaths.length, 2, "only the two abandoned slots must trigger a GCS delete");
    assert.ok(deps.deletedPaths.includes(abandoned1.objectPath), "abandoned-1 must be deleted");
    assert.ok(deps.deletedPaths.includes(abandoned2.objectPath), "abandoned-2 must be deleted");
    assert.ok(!deps.deletedPaths.includes(consumed.objectPath),  "consumed slot must not be deleted");
    assert.equal(deps.dbPurged, true);
  });

  it("purges DB rows even when there are no expired slots", async () => {
    const deps = makeDeps([]);

    await purgeAbandonedSlots(deps);

    assert.deepEqual(deps.deletedPaths, [], "no GCS deletes when there is nothing to clean up");
    assert.equal(deps.dbPurged, true, "DB purge must always run, even on an empty set");
  });

  it("a GCS error on one slot does not block the DB purge or other object deletions", async () => {
    const faulty:  SlotStub = { objectPath: "/objects/library/staging-faulty", consumed: false };
    const healthy: SlotStub = { objectPath: "/objects/library/staging-ok",     consumed: false };

    const deps = makeDeps([faulty, healthy], {
      async deleteObject(path) {
        if (path === faulty.objectPath) throw new Error("GCS transient error");
        deps.deletedPaths.push(path);
      },
    });

    // Must not throw even though one GCS call errors.
    await assert.doesNotReject(purgeAbandonedSlots(deps));

    assert.deepEqual(deps.deletedPaths, [healthy.objectPath],
      "healthy slot must still be deleted despite the sibling error");
    assert.equal(deps.dbPurged, true,
      "DB purge must proceed even after a per-object GCS failure");
  });
});
