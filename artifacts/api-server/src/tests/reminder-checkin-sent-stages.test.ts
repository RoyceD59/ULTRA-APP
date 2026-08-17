/**
 * Regression tests: a performance check-in that updates effectiveLifespanDays
 * must NOT cause already-sent stages to be re-emitted.
 *
 * Scenarios:
 *   Unit (dueStages):
 *     A. sentStages pre-populated under rated schedule — after check-in adjusts
 *        the effective lifespan, no key already in sentStages is re-emitted,
 *        regardless of how much the effective lifespan changed.
 *     B. Only unsent stages appear in the output when sentStages is partial.
 *     C. Empty output when every stage has been sent.
 *
 *   Integration (PUT /api/uc/reminders/sync):
 *     D. A same-cycle sync carrying effectiveLifespanDays preserves the existing
 *        row's sentStages in the INSERT values and does NOT trigger isNewCycle
 *        (response.newCycle === false).
 *     E. The ON CONFLICT SET clause does not include sentStages when the cycle
 *        is unchanged — the column retains its current DB value after the upsert.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { dueStages, GRACE_DAYS } from "../lib/reminder-dispatch.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a Date that is `n` whole days in the past (truncated to the day). */
function daysBack(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// A. sentStages pre-populated — no key re-emitted after effective-lifespan cut
// ─────────────────────────────────────────────────────────────────────────────
//
// Scenario: rated lifespan 90 days; at day 40 a borehole check-in shortens the
// effective lifespan to 55 days.  The app sends back:
//   effectiveLifespanDays: 55
//   adjustedReplaceOffsets: { replace30: 42, replace15: 50 }
//
// The customer already received "activation" and "day30" before the check-in.
// After the check-in the server calls dueStages with:
//   - rated lifespanDays = 90 (for day30/day60 guards)
//   - adjustedOffsets = { replace30: 42, replace15: 50 }
//   - sentStages = ["activation", "day30"]
//   - elapsed = 40 days
//
// Expected: neither "activation" nor "day30" re-appear in the output.

describe("dueStages — check-in with shorter effective lifespan never re-emits sent stages", () => {
  const RATED = 90;
  const sentBefore = ["activation", "day30"];
  const adjustedOffsets = { replace30: 42, replace15: 50 };

  it("does not re-emit 'activation' when it is already in sentStages", () => {
    // Day 40 — activation was sent on day 0, should not appear again.
    const decisions = dueStages(RATED, daysBack(40), sentBefore, new Date(), adjustedOffsets);
    const keys = decisions.map((d) => d.key);
    assert.ok(
      !keys.includes("activation"),
      `'activation' must not re-appear after check-in shortened effective lifespan; got [${keys.join(", ")}]`,
    );
  });

  it("does not re-emit 'day30' when it is already in sentStages", () => {
    const decisions = dueStages(RATED, daysBack(40), sentBefore, new Date(), adjustedOffsets);
    const keys = decisions.map((d) => d.key);
    assert.ok(
      !keys.includes("day30"),
      `'day30' must not re-appear after check-in; got [${keys.join(", ")}]`,
    );
  });

  it("does not re-emit any key present in sentStages (all-at-once check)", () => {
    const decisions = dueStages(RATED, daysBack(40), sentBefore, new Date(), adjustedOffsets);
    const emittedKeys = decisions.map((d) => d.key as string);
    for (const sent of sentBefore) {
      assert.ok(
        !emittedKeys.includes(sent),
        `already-sent stage '${sent}' must never be re-emitted; got [${emittedKeys.join(", ")}]`,
      );
    }
  });

  it("replace30 is newly due at the adjusted offset (day 42) — check-in moved it earlier", () => {
    // Day 42 is >= adjusted replace30 offset of 42 and within grace.
    const decisions = dueStages(RATED, daysBack(42), sentBefore, new Date(), adjustedOffsets);
    const r30 = decisions.find((d) => d.key === "replace30");
    assert.ok(r30, `replace30 must be due at day 42 with stored offset 42; got [${decisions.map((d) => d.key).join(", ")}]`);
    assert.equal(r30.action, "send", "replace30 within grace window must be 'send', not 'skip_stale'");
    // Confirm sent-stage filter is still applied (activation/day30 absent).
    assert.ok(!decisions.find((d) => d.key === "activation"), "activation must not re-appear alongside replace30");
    assert.ok(!decisions.find((d) => d.key === "day30"), "day30 must not re-appear alongside replace30");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Only unsent stages appear — partial sentStages list
// ─────────────────────────────────────────────────────────────────────────────

describe("dueStages — partial sentStages: only outstanding stages emitted", () => {
  // Rated 90 days, effective 60 days (replace offsets cut by ~30 days).
  // sentStages has 'activation' only; 'day30' and replace stages still outstanding.
  const RATED = 90;
  const adjustedOffsets = { replace30: 55, replace15: 65 };

  it("emits day30 when elapsed >= 30 and only activation is already sent", () => {
    const decisions = dueStages(RATED, daysBack(31), ["activation"], new Date(), adjustedOffsets);
    const keys = decisions.map((d) => d.key);
    assert.ok(keys.includes("day30"), `day30 must be due at day 31; got [${keys.join(", ")}]`);
    assert.ok(!keys.includes("activation"), "activation must not re-appear");
  });

  it("does not emit replace30 before its adjusted offset even with partial sentStages", () => {
    // Day 31 is well before replace30 offset of 55.
    const decisions = dueStages(RATED, daysBack(31), ["activation"], new Date(), adjustedOffsets);
    const keys = decisions.map((d) => d.key);
    assert.ok(!keys.includes("replace30"), `replace30 must not fire before its adjusted offset 55 at day 31`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. All stages sent → empty output regardless of effective lifespan
// ─────────────────────────────────────────────────────────────────────────────

describe("dueStages — all stages sent after check-in: nothing re-emitted", () => {
  it("returns empty array when every stage key is in sentStages", () => {
    const allSent = ["activation", "day30", "day60", "replace30", "replace15"];
    const adjustedOffsets = { replace30: 42, replace15: 50 };
    // Rated 90, effective 55 — well past all stages.
    const decisions = dueStages(90, daysBack(100), allSent, new Date(), adjustedOffsets);
    assert.equal(
      decisions.length,
      0,
      `dueStages must return [] when all keys are in sentStages; got [${decisions.map((d) => d.key).join(", ")}]`,
    );
  });

  it("returns empty array without adjustedOffsets when every stage is already sent", () => {
    const allSent = ["activation", "day30", "day60", "replace30", "replace15"];
    const decisions = dueStages(90, daysBack(100), allSent);
    assert.equal(decisions.length, 0, "no stages emitted when all are already in sentStages");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D + E. Integration — PUT /api/uc/reminders/sync preserves sentStages and
//         returns newCycle:false when effectiveLifespanDays changes
// ─────────────────────────────────────────────────────────────────────────────

/** Values captured by the DB insert stub across calls. */
let capturedInsertValues: Record<string, unknown> | null = null;
let capturedOnConflictSet: Record<string, unknown> | null = null;

let selectCallCount = 0;
let existingRow: Record<string, unknown> | null = null;

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
                ? [{ id: 42 }]          // user-existence check
                : existingRow
                  ? [existingRow]        // existing reminder row
                  : [],
            ),
        }),
      }),
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = (_table: unknown) => ({
    values: (vals: Record<string, unknown>) => {
      capturedInsertValues = vals;
      return {
        onConflictDoUpdate: (opts: { set?: Record<string, unknown> }) => {
          capturedOnConflictSet = opts?.set ?? null;
          return {
            returning: () =>
              Promise.resolve([{ userId: String(vals["userId"] ?? "42") }]),
          };
        },
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

let baseUrl = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appServer: any = null;

before(async () => {
  installDbStub();
  process.env["SESSION_SECRET"] ??= "test-secret-checkin-sent-stages";

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

function makeUserToken(userId = 42): string {
  return `Bearer ${issueToken({ id: userId, type: "uc-user" })}`;
}

async function putSync(body: Record<string, unknown>, userId = 42): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/uc/reminders/sync`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: makeUserToken(userId),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

describe("PUT /api/uc/reminders/sync — check-in effectiveLifespanDays preserves sentStages", () => {
  // Base activation timestamp shared across tests in this block.
  const activatedAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const PRODUCT_ID = 7;
  const SENT_STAGES = ["activation", "day30"];

  // D. The INSERT values passed to Postgres must carry the EXISTING sentStages
  //    array, not a fresh [].  The upsert ON CONFLICT SET must NOT include
  //    sentStages at all (column retains its current DB value).

  it("D: INSERT values include existing sentStages when effectiveLifespanDays changes on same cycle", async () => {
    capturedInsertValues = null;
    capturedOnConflictSet = null;
    selectCallCount = 0;

    // Simulate an existing row for the same product + activation date.
    existingRow = {
      userId: "42",
      productId: PRODUCT_ID,
      productName: "AquaMax 500",
      lifespanDays: 90,
      effectiveLifespanDays: null,
      adjustedReplaceOffsets: null,
      activatedAt: new Date(activatedAt),
      sourceOrderId: null,
      active: true,
      sentStages: SENT_STAGES,
      syncedAt: null,
      updatedAt: new Date(),
    };

    const { status, json } = await putSync({
      activation: {
        productId: PRODUCT_ID,
        productName: "AquaMax 500",
        lifespanDays: 90,
        activatedAt,
        effectiveLifespanDays: 55,
        adjustedReplaceOffsets: { replace30: 42, replace15: 50 },
      },
    });

    assert.equal(status, 200, "sync must succeed (HTTP 200)");
    assert.equal(json["newCycle"], false, "same product + activatedAt must NOT be a new cycle");
    assert.ok(capturedInsertValues !== null, "db.insert must have been called");

    const storedSentStages = capturedInsertValues!["sentStages"];
    assert.deepEqual(
      storedSentStages,
      SENT_STAGES,
      `INSERT values.sentStages must be the existing ["activation","day30"], not reset to []; got: ${JSON.stringify(storedSentStages)}`,
    );
  });

  it("E: ON CONFLICT SET object does NOT include sentStages for a same-cycle check-in update", async () => {
    capturedInsertValues = null;
    capturedOnConflictSet = null;
    selectCallCount = 0;

    existingRow = {
      userId: "43",
      productId: PRODUCT_ID,
      productName: "AquaMax 500",
      lifespanDays: 90,
      effectiveLifespanDays: null,
      adjustedReplaceOffsets: null,
      activatedAt: new Date(activatedAt),
      sourceOrderId: null,
      active: true,
      sentStages: SENT_STAGES,
      syncedAt: null,
      updatedAt: new Date(),
    };

    await putSync(
      {
        activation: {
          productId: PRODUCT_ID,
          productName: "AquaMax 500",
          lifespanDays: 90,
          activatedAt,
          effectiveLifespanDays: 60,
          adjustedReplaceOffsets: { replace30: 44, replace15: 52 },
        },
      },
      43,
    );

    assert.ok(capturedOnConflictSet !== null, "onConflictDoUpdate must have been called");
    assert.ok(
      !("sentStages" in capturedOnConflictSet!),
      `ON CONFLICT SET must NOT contain 'sentStages' for a same-cycle update — got keys: [${Object.keys(capturedOnConflictSet!).join(", ")}]`,
    );
  });

  it("F: effectiveLifespanDays and adjustedReplaceOffsets are stored on same-cycle check-in update", async () => {
    capturedInsertValues = null;
    capturedOnConflictSet = null;
    selectCallCount = 0;

    existingRow = {
      userId: "44",
      productId: PRODUCT_ID,
      productName: "AquaMax 500",
      lifespanDays: 90,
      effectiveLifespanDays: null,
      adjustedReplaceOffsets: null,
      activatedAt: new Date(activatedAt),
      sourceOrderId: null,
      active: true,
      sentStages: SENT_STAGES,
      syncedAt: null,
      updatedAt: new Date(),
    };

    const { status } = await putSync(
      {
        activation: {
          productId: PRODUCT_ID,
          productName: "AquaMax 500",
          lifespanDays: 90,
          activatedAt,
          effectiveLifespanDays: 55,
          adjustedReplaceOffsets: { replace30: 42, replace15: 50 },
        },
      },
      44,
    );

    assert.equal(status, 200, "sync must succeed");
    assert.ok(capturedOnConflictSet !== null, "onConflictDoUpdate must be called");

    const effDays = capturedOnConflictSet!["effectiveLifespanDays"] as number | null;
    assert.equal(effDays, 55, `effectiveLifespanDays must be stored as 55 in ON CONFLICT SET; got ${effDays}`);

    const offsets = capturedOnConflictSet!["adjustedReplaceOffsets"] as Record<string, number> | null;
    assert.ok(offsets != null, "adjustedReplaceOffsets must be stored in ON CONFLICT SET");
    assert.equal(offsets["replace30"], 42, "replace30 offset must be 42");
    assert.equal(offsets["replace15"], 50, "replace15 offset must be 50");
  });

  it("G: a new cycle (different product) resets sentStages to [] and sets newCycle:true", async () => {
    capturedInsertValues = null;
    capturedOnConflictSet = null;
    selectCallCount = 0;

    existingRow = {
      userId: "45",
      productId: 999,                    // different product → new cycle
      productName: "OldFilter",
      lifespanDays: 60,
      effectiveLifespanDays: null,
      adjustedReplaceOffsets: null,
      activatedAt: new Date(activatedAt),
      sourceOrderId: null,
      active: true,
      sentStages: ["activation", "day30", "replace30"],
      syncedAt: null,
      updatedAt: new Date(),
    };

    const { status, json } = await putSync(
      {
        activation: {
          productId: PRODUCT_ID,          // new product
          productName: "AquaMax 500",
          lifespanDays: 90,
          activatedAt,
          effectiveLifespanDays: 55,
          adjustedReplaceOffsets: { replace30: 42, replace15: 50 },
        },
      },
      45,
    );

    assert.equal(status, 200, "new-cycle sync must succeed");
    assert.equal(json["newCycle"], true, "different productId must result in newCycle:true");
    assert.ok(capturedInsertValues !== null, "db.insert must be called");

    const storedSentStages = capturedInsertValues!["sentStages"];
    assert.deepEqual(
      storedSentStages,
      [],
      `new cycle must reset sentStages to []; got: ${JSON.stringify(storedSentStages)}`,
    );
  });
});
