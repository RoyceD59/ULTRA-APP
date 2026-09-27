/**
 * Regression: PUT /api/uc/reminders/sync — first authenticated sync after a
 * check-in must preserve adjustedReplaceOffsets even when no server row exists.
 *
 * Before the fix, `!existing` was treated the same as a new cycle, which
 * unconditionally set adjustedReplaceOffsets = null.  A customer who did a
 * check-in while offline (or before their first login) would lose the adjusted
 * offsets on the first authenticated sync, leaving email/SMS/WhatsApp reminders
 * on the rated schedule — the core bug this task must fix.
 *
 * Strategy: stub db.select to return an empty set (no existing row) and stub
 * db.insert to capture the upserted values, then assert adjustedReplaceOffsets
 * was preserved rather than cleared.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";

// ─── DB stub ──────────────────────────────────────────────────────────────────

let capturedUpsertValues: Record<string, unknown> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalSelect = (db as any).select.bind(db);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalInsert = (db as any).insert.bind(db);

/** How many select() calls have been made within one test. */
let selectCallCount = 0;
/**
 * Controls what the insert stub returns from `.returning()`.
 * true (default) = `[{ userId }]` — the upsert WHERE clause passed.
 * false          = `[]`           — WHERE clause blocked the update (stale write).
 */
let insertReturnsRows = true;

function installDbStub() {
  // select() has two callers in sequence:
  //   1. User-existence check (ucUsersTable) → return a fake user row
  //   2. Existing-reminder check (ucFilterRemindersTable) → return empty (no row)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).select = () => {
    const call = ++selectCallCount;
    return {
      from: () => ({
        where: () => ({
          // User lookup returns a dummy user; reminder lookup returns nothing.
          limit: () =>
            Promise.resolve(call === 1 ? [{ id: 42 }] : []),
        }),
      }),
    };
  };

  // insert() → capture values; onConflictDoUpdate().returning() returns
  // [{ userId }] to simulate a successful upsert (WHERE clause passed).
  // Tests that need to simulate a stale write (WHERE clause blocked) should
  // override `insertReturnsRows` to false before calling putSync.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert = (_table: unknown) => ({
    values: (vals: Record<string, unknown>) => {
      capturedUpsertValues = vals;
      return {
        onConflictDoUpdate: (_opts: unknown) => ({
          returning: () =>
            Promise.resolve(insertReturnsRows ? [{ userId: String(vals["userId"] ?? "42") }] : []),
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
  process.env["SESSION_SECRET"] ??= "test-secret-reminder-sync-first-insert";

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
  // Route reads claims.id (numeric) and rejects non-digit strings.
  // Keep synthetic IDs outside the DB-anchored range used by other suites.
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PUT /api/uc/reminders/sync — atomic stale-write rejection via ON CONFLICT WHERE", () => {
  // Scenario: two fire-and-forget syncs race. The earlier one (baseline/catalogue
  // registration, syncedAt=T1) arrives AFTER the later check-in (syncedAt=T2).
  //
  // The stale-write check is ATOMIC at the DB level:
  //   ON CONFLICT DO UPDATE SET … WHERE synced_at IS NULL OR EXCLUDED.synced_at >= synced_at
  //
  // This prevents the classic read-then-write TOCTOU race: both requests may
  // read the row before either writes; the newer one commits first (syncedAt=T2),
  // then the older one arrives and its WHERE clause (T1 >= T2 = FALSE) is
  // evaluated inside the same Postgres transaction — so it cannot win.
  //
  // The stub simulates the WHERE clause outcome via `insertReturnsRows`:
  //   true  → [{ userId }]  (clause passed; row updated)
  //   false → []            (clause blocked; stale)

  it("returns stale:true and 200 when the DB WHERE clause blocks a stale write (older syncedAt)", async () => {
    capturedUpsertValues = null;
    selectCallCount = 0;
    insertReturnsRows = false; // simulate: T1 >= T2 is false → WHERE blocked

    const activatedAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const t1 = new Date(Date.now() - 5000).toISOString(); // older than what the DB has stored

    const { status, json } = await putSync(
      {
        activation: {
          productId:    1,
          productName:  "Hydra Flux",
          lifespanDays: 90,
          activatedAt,
          syncedAt:     t1,
        },
      },
      makeUserToken(45),
    );

    insertReturnsRows = true; // restore default

    assert.equal(status, 200, "stale write must still return HTTP 200 (not an error — app must not retry)");
    assert.equal(
      (json as Record<string, unknown>)["stale"],
      true,
      "response must include stale:true to signal no write occurred",
    );
    assert.ok(
      capturedUpsertValues !== null,
      "insert MUST be called — the stale check lives in the DB WHERE clause, not in application code",
    );
  });

  it("returns ok:true (no stale) when the DB WHERE clause passes a newer syncedAt", async () => {
    capturedUpsertValues = null;
    selectCallCount = 0;
    insertReturnsRows = true; // simulate: T2 >= T1 → WHERE passes

    const activatedAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const t2 = new Date().toISOString(); // newer → clause passes

    const { status, json } = await putSync(
      {
        activation: {
          productId:              1,
          productName:            "Hydra Flux",
          lifespanDays:           90,
          activatedAt,
          syncedAt:               t2,
          effectiveLifespanDays:  50,
          adjustedReplaceOffsets: { replace30: 37, replace15: 48 },
        },
      },
      makeUserToken(46),
    );

    assert.equal(status, 200, "newer syncedAt must succeed");
    assert.notEqual(
      (json as Record<string, unknown>)["stale"],
      true,
      "response must NOT include stale:true for a valid newer write",
    );
    assert.ok(capturedUpsertValues !== null, "insert must have been called");
    const stored = (capturedUpsertValues as Record<string, unknown>)["adjustedReplaceOffsets"] as Record<string, number> | null;
    assert.equal(stored?.["replace30"], 37, "adjustedReplaceOffsets must be stored on a valid newer write");
  });

  it("rejects an invalid (non-ISO) syncedAt with 400", async () => {
    capturedUpsertValues = null;
    selectCallCount = 0;

    const activatedAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { status } = await putSync(
      {
        activation: {
          productId:    1,
          productName:  "Hydra Flux",
          lifespanDays: 90,
          activatedAt,
          syncedAt:     "not-a-date",
        },
      },
      makeUserToken(47),
    );

    assert.equal(status, 400, "invalid syncedAt must be rejected with 400");
  });
});

describe("PUT /api/uc/reminders/sync — first-insert preserves adjusted offsets", () => {
  const activatedAt = new Date(Date.now() - 30 * 86_400_000).toISOString();

  it("stores adjustedReplaceOffsets on first sync when no server row exists", async () => {
    capturedUpsertValues = null;
    selectCallCount = 0;

    const { status } = await putSync(
      {
        activation: {
          productId:              1,
          productName:            "Hydra Flux",
          lifespanDays:           90,
          activatedAt,
          effectiveLifespanDays:  50,
          adjustedReplaceOffsets: { replace30: 37, replace15: 48 },
        },
      },
      makeUserToken(),
    );

    assert.equal(status, 200, "sync endpoint must return 200");
    assert.ok(capturedUpsertValues !== null, "insert must have been called");

    const stored = capturedUpsertValues!["adjustedReplaceOffsets"] as Record<string, number> | null;
    assert.ok(
      stored != null,
      "adjustedReplaceOffsets must NOT be null when no existing row — got null (first-sync regression)",
    );
    assert.equal(stored["replace30"], 37, "replace30 must be preserved on first insert");
    assert.equal(stored["replace15"], 48, "replace15 must be preserved on first insert");
  });

  it("stores effectiveLifespanDays on first sync when no server row exists", async () => {
    capturedUpsertValues = null;
    selectCallCount = 0;

    await putSync(
      {
        activation: {
          productId:              1,
          productName:            "Hydra Flux",
          lifespanDays:           90,
          activatedAt,
          effectiveLifespanDays:  50,
          adjustedReplaceOffsets: { replace30: 37, replace15: 48 },
        },
      },
      makeUserToken(43),
    );

    assert.ok(capturedUpsertValues !== null, "insert must have been called");
    const stored = capturedUpsertValues!["effectiveLifespanDays"] as number | null;
    assert.ok(
      stored != null && stored > 0,
      `effectiveLifespanDays must be preserved on first insert — got: ${stored}`,
    );
    assert.equal(stored, 50, "effectiveLifespanDays must equal the sent value (50)");
  });

  it("does NOT store adjustedReplaceOffsets when the request sends none (good check-in)", async () => {
    capturedUpsertValues = null;
    selectCallCount = 0;

    await putSync(
      {
        activation: {
          productId:    1,
          productName:  "Hydra Flux",
          lifespanDays: 90,
          activatedAt,
          // no adjustedReplaceOffsets / effectiveLifespanDays
        },
      },
      makeUserToken(44),
    );

    assert.ok(capturedUpsertValues !== null, "insert must have been called");
    const stored = capturedUpsertValues!["adjustedReplaceOffsets"];
    assert.equal(
      stored,
      null,
      "adjustedReplaceOffsets must be null when not supplied (good check-in path)",
    );
  });
});
