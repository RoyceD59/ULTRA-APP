/**
 * Regression tests: a 'good' check-in result restores original message timing.
 *
 * When `recordPerformanceCheckIn` yields a 'good' recommendation, the app calls
 * `syncReminderToServer` without `adjustedReplaceOffsets` or
 * `effectiveLifespanDays`. The server must store NULL for both columns so the
 * daily dispatcher reverts to the rated-lifespan schedule — matching the
 * handset which also cancels adjusted notifications and reschedules on the
 * rated dates.
 *
 * Scenarios covered:
 *   1. Route: second sync (good check-in) stores effectiveLifespanDays = NULL.
 *   2. Route: second sync (good check-in) stores adjustedReplaceOffsets = NULL.
 *   3. Route: first sync stores the clean-check-in values (regression guard so
 *      the revert tests are meaningful — not just testing a no-op first write).
 *   4. dueStages: after good check-in (no adjustedOffsets) remaining replace
 *      stages use the rated-lifespan formula, not the previously shortened dates.
 *   5. dueStages: already-sent stages are not re-emitted after the revert.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { dueStages } from "../lib/reminder-dispatch.js";

// ─── DB stub ──────────────────────────────────────────────────────────────────
//
// select() is called twice per request:
//   call 1 → user-existence check → always returns a dummy user row
//   call 2 → existing-reminder check → returns `stubReminderRow` (or empty)

let capturedUpsertValues: Record<string, unknown> | null = null;
let selectCallCount = 0;

/**
 * What the second select() call (reminder lookup) returns.
 * null  → no existing row (first sync / guest)
 * object → an existing row (same-cycle continuation)
 */
let stubReminderRow: Record<string, unknown> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalSelect = (db as any).select.bind(db);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalInsert = (db as any).insert.bind(db);

function installDbStub() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).select = () => {
    const call = ++selectCallCount;
    return {
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              call === 1
                ? [{ id: 42 }]                              // user-existence check
                : stubReminderRow != null ? [stubReminderRow] : []  // reminder row
            ),
        }),
      }),
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = (_table: unknown) => ({
    values: (vals: Record<string, unknown>) => {
      capturedUpsertValues = vals;
      return {
        onConflictDoUpdate: (_opts: unknown) => ({
          returning: () =>
            Promise.resolve([{ userId: String(vals["userId"] ?? "42") }]),
        }),
      };
    },
  });
}

function restoreDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).select = originalSelect;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = originalInsert;
}

// ─── Test setup ───────────────────────────────────────────────────────────────

let baseUrl = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appServer: any = null;

before(async () => {
  installDbStub();
  process.env["SESSION_SECRET"] ??= "test-secret-good-checkin-revert";

  const { default: app } = await import("../app.js");
  appServer = createServer(app).listen(0);
  await new Promise<void>((resolve) => appServer.once("listening", resolve));
  const { port } = appServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  restoreDb();
  appServer?.close();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUserToken(userId = 42): string {
  // These mocked users must not collide with real rows from other test suites.
  return `Bearer ${issueToken({ id: userId + 1_000_000_000, type: "uc-user" })}`;
}

async function putSync(
  body: Record<string, unknown>,
  authHeader?: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/uc/reminders/sync`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// Shared activation for the two-sync sequence tests.
const ACTIVATED_AT = new Date(Date.now() - 30 * 86_400_000).toISOString();
const PRODUCT_ID = 7;
const LIFESPAN_DAYS = 90;

// The "clean check-in" sync body — shortened to effective 54 days.
const CLEAN_SYNC_BODY = {
  activation: {
    productId:              PRODUCT_ID,
    productName:            "Hydra Flux Pro",
    lifespanDays:           LIFESPAN_DAYS,
    activatedAt:            ACTIVATED_AT,
    effectiveLifespanDays:  54,
    adjustedReplaceOffsets: { replace30: 24, replace15: 44 },
    syncedAt:               new Date(Date.now() - 5000).toISOString(),
  },
};

// The "good check-in" sync body — no adjustment fields.
const GOOD_SYNC_BODY = {
  activation: {
    productId:    PRODUCT_ID,
    productName:  "Hydra Flux Pro",
    lifespanDays: LIFESPAN_DAYS,
    activatedAt:  ACTIVATED_AT,
    syncedAt:     new Date().toISOString(), // newer → accepted
  },
};

// Simulated existing row the DB returns for the second (same-cycle) sync.
const EXISTING_REMINDER_ROW: Record<string, unknown> = {
  userId:                 "42",
  productId:              PRODUCT_ID,
  activatedAt:            new Date(ACTIVATED_AT),
  lifespanDays:           LIFESPAN_DAYS,
  effectiveLifespanDays:  54,
  adjustedReplaceOffsets: { replace30: 24, replace15: 44 },
  sentStages:             [],
  active:                 true,
  syncedAt:               new Date(Date.now() - 5000),
};

// ─── Route tests ──────────────────────────────────────────────────────────────

describe("PUT /api/uc/reminders/sync — clean check-in (regression guard)", () => {
  it("stores effectiveLifespanDays on the clean-check-in sync (verifies the baseline)", async () => {
    capturedUpsertValues = null;
    selectCallCount = 0;
    stubReminderRow = null; // no existing row yet

    const { status } = await putSync(CLEAN_SYNC_BODY, makeUserToken(42));

    assert.equal(status, 200, "clean-check-in sync must return 200");
    assert.ok(capturedUpsertValues !== null, "insert must have been called");
    const stored = capturedUpsertValues!["effectiveLifespanDays"] as number | null;
    assert.ok(
      stored != null && stored > 0,
      `effectiveLifespanDays must be stored after clean check-in — got: ${stored}`,
    );
    assert.equal(stored, 54, "effectiveLifespanDays must equal the sent value (54)");
  });

  it("stores adjustedReplaceOffsets on the clean-check-in sync (verifies the baseline)", async () => {
    capturedUpsertValues = null;
    selectCallCount = 0;
    stubReminderRow = null;

    await putSync(CLEAN_SYNC_BODY, makeUserToken(43));

    assert.ok(capturedUpsertValues !== null, "insert must have been called");
    const stored = capturedUpsertValues!["adjustedReplaceOffsets"] as Record<string, number> | null;
    assert.ok(
      stored != null,
      "adjustedReplaceOffsets must be stored after clean check-in — got null",
    );
    assert.equal(stored["replace30"], 24, "replace30 must be 24 after clean check-in");
    assert.equal(stored["replace15"], 44, "replace15 must be 44 after clean check-in");
  });
});

describe("PUT /api/uc/reminders/sync — good check-in reverts server row", () => {
  // Both tests simulate the same-cycle continuation:
  //   stubReminderRow is set so select() call 2 returns an existing row with the
  //   same productId + activatedAt → isExistingCycle=true, isNewCycle=false.

  it("stores effectiveLifespanDays = NULL after a good check-in on the same cycle", async () => {
    capturedUpsertValues = null;
    selectCallCount = 0;
    stubReminderRow = EXISTING_REMINDER_ROW; // same-cycle existing row

    const { status } = await putSync(GOOD_SYNC_BODY, makeUserToken(44));

    stubReminderRow = null;

    assert.equal(status, 200, "good check-in sync must return 200");
    assert.ok(capturedUpsertValues !== null, "insert must have been called");
    const stored = capturedUpsertValues!["effectiveLifespanDays"];
    assert.equal(
      stored,
      null,
      `effectiveLifespanDays must be NULL after a good check-in — got: ${String(stored)}`,
    );
  });

  it("stores adjustedReplaceOffsets = NULL after a good check-in on the same cycle", async () => {
    capturedUpsertValues = null;
    selectCallCount = 0;
    stubReminderRow = EXISTING_REMINDER_ROW;

    const { status } = await putSync(GOOD_SYNC_BODY, makeUserToken(45));

    stubReminderRow = null;

    assert.equal(status, 200, "good check-in sync must return 200");
    assert.ok(capturedUpsertValues !== null, "insert must have been called");
    const stored = capturedUpsertValues!["adjustedReplaceOffsets"];
    assert.equal(
      stored,
      null,
      `adjustedReplaceOffsets must be NULL after a good check-in — got: ${JSON.stringify(stored)}`,
    );
  });
});

// ─── dueStages unit tests ─────────────────────────────────────────────────────
//
// After a good check-in the server row has effectiveLifespanDays=NULL and
// adjustedReplaceOffsets=NULL. The dispatcher then calls
//   dueStages(row.lifespanDays, …, row.adjustedReplaceOffsets)
// with lifespanDays=90 and adjustedOffsets=null.
// The remaining replace stages must use the rated-lifespan formula, not the
// previously shortened dates.

/** Utility: date N days in the past. */
function daysBack(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

describe("dueStages — good check-in reverts replace offsets to rated-lifespan formula", () => {
  // Rated lifespan 90 days.
  // Previous clean check-in had set: replace30=24, replace15=44.
  // After the good check-in (adjustedOffsets=null), the formula governs:
  //   replace30 = max(min(90−30, 89), 1) = max(60, 1) = 60
  //   replace15 = max(61, 90−15) = max(61, 75) = 75

  it("replace30 does NOT fire at the previously shortened date (day 24) after good check-in", () => {
    const decisions = dueStages(90, daysBack(24), [], new Date(), null);
    assert.ok(
      !decisions.find((d) => d.key === "replace30"),
      "replace30 must not fire at day 24 when adjustedOffsets are cleared (rated offset is 60)",
    );
  });

  it("replace30 fires at the rated-formula date (day 60) after good check-in", () => {
    const decisions = dueStages(90, daysBack(60), [], new Date(), null);
    const r30 = decisions.find((d) => d.key === "replace30");
    assert.ok(
      r30,
      "replace30 must be due at day 60 with rated lifespan 90 and no adjustedOffsets",
    );
    assert.equal(
      r30!.action,
      "send",
      "replace30 at day 60 (rated formula offset) must be 'send'",
    );
  });

  it("replace15 does NOT fire at the previously shortened date (day 44) after good check-in", () => {
    const decisions = dueStages(90, daysBack(44), ["activation", "day30", "replace30"], new Date(), null);
    assert.ok(
      !decisions.find((d) => d.key === "replace15"),
      "replace15 must not fire at day 44 when adjustedOffsets are cleared (rated offset is 75)",
    );
  });

  it("replace15 fires at the rated-formula date (day 75) after good check-in", () => {
    const decisions = dueStages(90, daysBack(75), ["activation", "day30", "replace30"], new Date(), null);
    const r15 = decisions.find((d) => d.key === "replace15");
    assert.ok(
      r15,
      "replace15 must be due at day 75 with rated lifespan 90 and no adjustedOffsets",
    );
    assert.equal(
      r15!.action,
      "send",
      "replace15 at day 75 (rated formula offset) must be 'send'",
    );
  });

  it("does not re-emit stages already sent before the good check-in", () => {
    // Suppose activation + day30 + replace30 were already sent during the
    // shortened schedule; after the revert only replace15 and day60 are pending.
    const alreadySent = ["activation", "day30", "replace30"];
    const decisions = dueStages(90, daysBack(75), alreadySent, new Date(), null);
    const emitted = decisions.map((d) => d.key as string);
    for (const sent of alreadySent) {
      assert.ok(
        !emitted.includes(sent),
        `${sent} must not re-fire after good check-in reverts the schedule`,
      );
    }
  });

  it("using undefined adjustedOffsets (omitted) also falls back to the rated formula", () => {
    // The dispatcher passes row.adjustedReplaceOffsets directly; undefined behaves
    // the same as null (both treated as absent).
    const decisions = dueStages(90, daysBack(60), [], new Date(), undefined);
    const r30 = decisions.find((d) => d.key === "replace30");
    assert.ok(
      r30,
      "replace30 must be due at day 60 when adjustedOffsets is undefined (rated formula)",
    );
  });
});
