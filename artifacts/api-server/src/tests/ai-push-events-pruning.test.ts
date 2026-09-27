/**
 * Tests for the AI push-events pruning job (runAiPushEventsPruning).
 *
 * Covers:
 *   (a) Exactly one DELETE statement is issued against ai_push_events
 *   (b) Default cutoff is within ±5 s of 90 days ago
 *   (c) UC_PUSH_EVENTS_RETENTION_DAYS=7 shortens the cutoff to ~7 days ago
 *   (d) Malformed / invalid env values fall back to the 90-day default
 *   (e) A DB error causes the promise to reject (not silently swallowed)
 *
 * Strategy: monkey-patch db.delete on the shared @workspace/db instance so the
 * function can be exercised without a live database. WHERE condition objects are
 * Drizzle SQL AST nodes with circular PgTable references, so we walk them with a
 * visited-Set-guarded recursion to extract embedded Date values.
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { db } from "@workspace/db";

// ─── DB delete interceptor ────────────────────────────────────────────────────

interface DeleteCall {
  /** The first WHERE condition argument (Drizzle SQL AST node). */
  whereArg: unknown;
}

let deleteCalls: DeleteCall[] = [];
let dbDeleteShouldThrow = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalDelete = (db as any).delete.bind(db);

function installDeleteStub(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).delete = (_table: unknown) => ({
    where: (cond: unknown) => {
      if (dbDeleteShouldThrow) {
        return Promise.reject(new Error("DB unavailable (test)"));
      }
      deleteCalls.push({ whereArg: cond });
      return Promise.resolve({ rowCount: 0 });
    },
  });
}

function restoreDelete(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).delete = originalDelete;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively walk an arbitrary object (guarded against circular refs) and
 * collect all Date instances found anywhere in the tree.
 */
function extractDates(node: unknown, visited = new Set<object>()): Date[] {
  if (node instanceof Date) return [node];
  if (node === null || typeof node !== "object") return [];
  if (visited.has(node)) return [];
  visited.add(node);
  const dates: Date[] = [];
  for (const val of Object.values(node as Record<string, unknown>)) {
    dates.push(...extractDates(val, visited));
  }
  return dates;
}

/** Return the timestamp closest to `target` among `dates`. */
function closestTs(dates: Date[], target: number): number {
  return dates.reduce((best, d) => {
    return Math.abs(d.getTime() - target) < Math.abs(best - target) ? d.getTime() : best;
  }, Infinity);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runAiPushEventsPruning — push-event history retention", () => {
  before(() => {
    installDeleteStub();
  });

  after(() => {
    restoreDelete();
  });

  beforeEach(() => {
    deleteCalls = [];
    dbDeleteShouldThrow = false;
    delete process.env["UC_PUSH_EVENTS_RETENTION_DAYS"];
  });

  afterEach(() => {
    delete process.env["UC_PUSH_EVENTS_RETENTION_DAYS"];
  });

  it("(a) issues exactly one DELETE statement against ai_push_events", async () => {
    const { runAiPushEventsPruning } = await import("../lib/scheduler.js");
    await runAiPushEventsPruning();

    assert.equal(deleteCalls.length, 1, "should issue exactly 1 DELETE call");
  });

  it("(b) default cutoff is within ±5 s of 90 days ago", async () => {
    const { runAiPushEventsPruning } = await import("../lib/scheduler.js");
    const before = Date.now();
    await runAiPushEventsPruning();
    const after = Date.now();

    assert.equal(deleteCalls.length, 1);

    const dates = extractDates(deleteCalls[0]!.whereArg);
    assert.ok(dates.length > 0, "WHERE condition should contain at least one Date");

    const expectedMs = 90 * 24 * 60 * 60 * 1000;
    const expectedLow  = before - expectedMs;
    const expectedHigh = after  - expectedMs;
    const best = closestTs(dates, (expectedLow + expectedHigh) / 2);

    assert.ok(
      best >= expectedLow - 5000 && best <= expectedHigh + 5000,
      `Default cutoff ${new Date(best).toISOString()} should be ~90 days ago`,
    );
  });

  it("(c) UC_PUSH_EVENTS_RETENTION_DAYS=7 shortens the cutoff to ~7 days ago", async () => {
    process.env["UC_PUSH_EVENTS_RETENTION_DAYS"] = "7";

    const { runAiPushEventsPruning } = await import("../lib/scheduler.js");
    const before = Date.now();
    await runAiPushEventsPruning();
    const after = Date.now();

    assert.equal(deleteCalls.length, 1);

    const dates = extractDates(deleteCalls[0]!.whereArg);
    assert.ok(dates.length > 0, "WHERE condition should contain at least one Date");

    const expectedMs = 7 * 24 * 60 * 60 * 1000;
    const expectedLow  = before - expectedMs;
    const expectedHigh = after  - expectedMs;
    const best = closestTs(dates, (expectedLow + expectedHigh) / 2);

    assert.ok(
      best >= expectedLow - 5000 && best <= expectedHigh + 5000,
      `Custom cutoff ${new Date(best).toISOString()} should be ~7 days ago`,
    );
  });

  it("(d) malformed env values all fall back to the 90-day default", async () => {
    // Test a selection of invalid values — each must fall back to 90 days
    const invalidValues = ["7days", "1e3", "0", "-5", "banana"];

    for (const val of invalidValues) {
      deleteCalls = [];
      process.env["UC_PUSH_EVENTS_RETENTION_DAYS"] = val;

      const { runAiPushEventsPruning } = await import("../lib/scheduler.js");
      const before = Date.now();
      await runAiPushEventsPruning();
      const after = Date.now();

      assert.equal(deleteCalls.length, 1, `Should issue 1 DELETE for value "${val}"`);

      const dates = extractDates(deleteCalls[0]!.whereArg);
      assert.ok(dates.length > 0, `WHERE condition should contain a Date for value "${val}"`);

      const expectedMs = 90 * 24 * 60 * 60 * 1000;
      const expectedLow  = before - expectedMs;
      const expectedHigh = after  - expectedMs;
      const best = closestTs(dates, (expectedLow + expectedHigh) / 2);

      assert.ok(
        best >= expectedLow - 5000 && best <= expectedHigh + 5000,
        `"${val}" should fall back to 90-day default, cutoff was ${new Date(best).toISOString()}`,
      );
    }
  });

  it("(e) a DB error causes the promise to reject (not silently swallowed)", async () => {
    dbDeleteShouldThrow = true;
    const { runAiPushEventsPruning } = await import("../lib/scheduler.js");
    await assert.rejects(
      () => runAiPushEventsPruning(),
      (err: unknown) => {
        assert.ok(err instanceof Error, "should reject with an Error");
        assert.match(err.message, /DB unavailable/);
        return true;
      },
    );
  });
});
