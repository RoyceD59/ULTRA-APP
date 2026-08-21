/**
 * Tests for the notification log pruning job (runNotificationLogPruning).
 *
 * Covers:
 *   (a) Exactly two DELETE statements are issued — one for sent rows, one for failed rows
 *   (b) Default success cutoff is ~30 days ago (status='sent')
 *   (c) Default failure cutoff is ~90 days ago (status='failed')
 *   (d) UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS is honoured over the default
 *   (e) UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS is honoured over the default
 *   (f) Invalid env value falls back to default; zero is clamped to minimum 1 day
 *   (g) A DB error causes the promise to reject (not silently swallowed)
 *
 * Strategy: monkey-patch db.delete on the shared @workspace/db instance so the
 * function can be exercised without a live database.  The WHERE condition objects
 * are Drizzle SQL AST nodes containing circular PgTable references, so we walk
 * them with a visited-Set-guarded recursion to extract embedded Date values
 * instead of using JSON.stringify.
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { db } from "@workspace/db";

// ─── DB interceptors ─────────────────────────────────────────────────────────

interface DeleteCall {
  /** The first WHERE condition argument (Drizzle SQL AST node). */
  whereArg: unknown;
}

let deleteCalls: DeleteCall[] = [];
let dbDeleteShouldThrow = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalDelete = (db as any).delete.bind(db);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalSelect = (db as any).select.bind(db);

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

/**
 * Stub db.select so that the team_settings retention-override query inside
 * runNotificationLogPruning always returns [] (no DB override), keeping the
 * tests isolated to env-var / hard-default behaviour.
 */
function installSelectStub(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).select = (_fields: unknown) => ({
    from: (_table: unknown) => ({
      where: (_cond: unknown) => ({
        limit: (_n: unknown) => Promise.resolve([]),
      }),
    }),
  });
}

function restoreSelect(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).select = originalSelect;
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

describe("runNotificationLogPruning — notification log retention", () => {
  before(() => {
    installDeleteStub();
    installSelectStub();
  });

  after(() => {
    restoreDelete();
    restoreSelect();
  });

  beforeEach(() => {
    deleteCalls = [];
    dbDeleteShouldThrow = false;
    delete process.env["UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS"];
    delete process.env["UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS"];
  });

  afterEach(() => {
    delete process.env["UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS"];
    delete process.env["UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS"];
  });

  it("(a) issues exactly two DELETE statements — one for sent, one for failed", async () => {
    const { runNotificationLogPruning } = await import("../lib/scheduler.js");
    await runNotificationLogPruning();

    assert.equal(deleteCalls.length, 2, "should issue 2 DELETE calls (sent + failed)");
  });

  it("(b) default success cutoff is within ±5 s of 30 days ago", async () => {
    const { runNotificationLogPruning } = await import("../lib/scheduler.js");
    const before = Date.now();
    await runNotificationLogPruning();
    const after = Date.now();

    assert.equal(deleteCalls.length, 2);

    const sentDates = extractDates(deleteCalls[0]!.whereArg);
    assert.ok(sentDates.length > 0, "sent WHERE condition should contain at least one Date");

    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    const expectedLow  = before - expectedMs;
    const expectedHigh = after  - expectedMs;
    const best = closestTs(sentDates, (expectedLow + expectedHigh) / 2);

    assert.ok(
      best >= expectedLow - 5000 && best <= expectedHigh + 5000,
      `Success cutoff ${new Date(best).toISOString()} should be ~30 days ago`,
    );
  });

  it("(c) default failure cutoff is within ±5 s of 90 days ago", async () => {
    const { runNotificationLogPruning } = await import("../lib/scheduler.js");
    const before = Date.now();
    await runNotificationLogPruning();
    const after = Date.now();

    assert.equal(deleteCalls.length, 2);

    const failedDates = extractDates(deleteCalls[1]!.whereArg);
    assert.ok(failedDates.length > 0, "failed WHERE condition should contain at least one Date");

    const expectedMs = 90 * 24 * 60 * 60 * 1000;
    const expectedLow  = before - expectedMs;
    const expectedHigh = after  - expectedMs;
    const best = closestTs(failedDates, (expectedLow + expectedHigh) / 2);

    assert.ok(
      best >= expectedLow - 5000 && best <= expectedHigh + 5000,
      `Failure cutoff ${new Date(best).toISOString()} should be ~90 days ago`,
    );
  });

  it("(d) UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS=7 shortens the sent cutoff", async () => {
    process.env["UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS"] = "7";

    const { runNotificationLogPruning } = await import("../lib/scheduler.js");
    const before = Date.now();
    await runNotificationLogPruning();
    const after = Date.now();

    assert.equal(deleteCalls.length, 2);

    const sentDates = extractDates(deleteCalls[0]!.whereArg);
    assert.ok(sentDates.length > 0, "sent WHERE condition should contain at least one Date");

    const expectedMs = 7 * 24 * 60 * 60 * 1000;
    const expectedLow  = before - expectedMs;
    const expectedHigh = after  - expectedMs;
    const best = closestTs(sentDates, (expectedLow + expectedHigh) / 2);

    assert.ok(
      best >= expectedLow - 5000 && best <= expectedHigh + 5000,
      `Custom success cutoff ${new Date(best).toISOString()} should be ~7 days ago`,
    );
  });

  it("(e) UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS=14 shortens the failed cutoff", async () => {
    process.env["UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS"] = "14";

    const { runNotificationLogPruning } = await import("../lib/scheduler.js");
    const before = Date.now();
    await runNotificationLogPruning();
    const after = Date.now();

    assert.equal(deleteCalls.length, 2);

    const failedDates = extractDates(deleteCalls[1]!.whereArg);
    assert.ok(failedDates.length > 0, "failed WHERE condition should contain at least one Date");

    const expectedMs = 14 * 24 * 60 * 60 * 1000;
    const expectedLow  = before - expectedMs;
    const expectedHigh = after  - expectedMs;
    const best = closestTs(failedDates, (expectedLow + expectedHigh) / 2);

    assert.ok(
      best >= expectedLow - 5000 && best <= expectedHigh + 5000,
      `Custom failure cutoff ${new Date(best).toISOString()} should be ~14 days ago`,
    );
  });

  it("(f) malformed env values all fall back to their defaults — suffix, exponent, zero, negative", async () => {
    // Strict parser rejects all of: suffix ("7days"), scientific notation ("1e3"),
    // zero ("0"), negative ("-5"), and non-numeric ("banana").
    // Each must fall back to the configured default rather than using a partial parse.

    // Test suffix case: "7days" must NOT be treated as 7 (parseInt would accept it)
    process.env["UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS"] = "7days"; // → fallback 30
    process.env["UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS"] = "1e3";   // → fallback 90

    const { runNotificationLogPruning } = await import("../lib/scheduler.js");
    const before = Date.now();
    await runNotificationLogPruning();
    const after = Date.now();

    assert.equal(deleteCalls.length, 2);

    // Sent: "7days" must fall back to default 30 days (not 7)
    const sentDates = extractDates(deleteCalls[0]!.whereArg);
    assert.ok(sentDates.length > 0, "sent WHERE should contain a Date");
    const sentMs = 30 * 24 * 60 * 60 * 1000;
    const sentBest = closestTs(sentDates, before - sentMs);
    assert.ok(
      sentBest >= before - sentMs - 5000 && sentBest <= after - sentMs + 5000,
      `"7days" should fall back to 30-day default, cutoff was ${new Date(sentBest).toISOString()}`,
    );

    // Failed: "1e3" must fall back to default 90 days (not 1000)
    const failedDates = extractDates(deleteCalls[1]!.whereArg);
    assert.ok(failedDates.length > 0, "failed WHERE should contain a Date");
    const failMs = 90 * 24 * 60 * 60 * 1000;
    const failBest = closestTs(failedDates, before - failMs);
    assert.ok(
      failBest >= before - failMs - 5000 && failBest <= after - failMs + 5000,
      `"1e3" should fall back to 90-day default, cutoff was ${new Date(failBest).toISOString()}`,
    );
  });

  it("(f2) zero and negative env values also fall back to defaults", async () => {
    process.env["UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS"] = "0";  // → fallback 30
    process.env["UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS"] = "-5"; // → fallback 90

    const { runNotificationLogPruning } = await import("../lib/scheduler.js");
    const before = Date.now();
    await runNotificationLogPruning();
    const after = Date.now();

    assert.equal(deleteCalls.length, 2);

    // Sent: "0" is not a positive integer → fallback to 30 days
    const sentDates = extractDates(deleteCalls[0]!.whereArg);
    assert.ok(sentDates.length > 0);
    const sentMs = 30 * 24 * 60 * 60 * 1000;
    const sentBest = closestTs(sentDates, before - sentMs);
    assert.ok(
      sentBest >= before - sentMs - 5000 && sentBest <= after - sentMs + 5000,
      `"0" should fall back to 30-day default, cutoff was ${new Date(sentBest).toISOString()}`,
    );

    // Failed: "-5" rejected by /^\d+$/ → fallback to 90 days
    const failedDates = extractDates(deleteCalls[1]!.whereArg);
    assert.ok(failedDates.length > 0);
    const failMs = 90 * 24 * 60 * 60 * 1000;
    const failBest = closestTs(failedDates, before - failMs);
    assert.ok(
      failBest >= before - failMs - 5000 && failBest <= after - failMs + 5000,
      `"-5" should fall back to 90-day default, cutoff was ${new Date(failBest).toISOString()}`,
    );
  });

  it("(g) a DB error causes the promise to reject (not silently swallowed)", async () => {
    dbDeleteShouldThrow = true;
    const { runNotificationLogPruning } = await import("../lib/scheduler.js");
    await assert.rejects(
      () => runNotificationLogPruning(),
      (err: unknown) => {
        assert.ok(err instanceof Error, "should reject with an Error");
        assert.match(err.message, /DB unavailable/);
        return true;
      },
    );
  });
});
