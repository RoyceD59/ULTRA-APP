/**
 * Tests for the auto-credit rewards path in dispatchFilterReminders().
 *
 * Covers:
 *   1. When a replace30 stage is dispatched for a user with an active
 *      filter-replacement rule, a ledger row is inserted with the correct
 *      userId, points value, and refId.
 *   2. A second dispatch of the same stage does NOT insert a duplicate row
 *      (idempotency: the stage is already claimed, so creditReplacementPoints
 *      is never called a second time; even if it were, the pre-check and
 *      partial unique index block double-crediting).
 *   3. replace15 stage independently inserts its own ledger row with a
 *      correctly scoped refId.
 *   4. No ledger row is inserted when the rewards rule is inactive.
 *
 * Strategy:
 *   - Insert real uc_users / uc_notif_prefs / uc_rewards_rules rows.
 *   - Set activated_at far enough in the past so replace30 / replace15 are due.
 *   - Stub Resend (same pattern as reminder-concurrency.test.ts) so no real
 *     email I/O happens.
 *   - SMS is a silent no-op when AT credentials are absent (default in test env).
 *   - WhatsApp is skipped when the session is disconnected (default).
 *   - All seeded rows are deleted in after().
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import bcryptjs from "bcryptjs";
import { and, eq } from "drizzle-orm";

import {
  db,
  ucUsersTable,
  ucFilterRemindersTable,
  ucNotifPrefsTable,
  ucRewardsRulesTable,
  ucRewardsLedgerTable,
} from "@workspace/db";
import { dispatchFilterReminders } from "../lib/reminder-dispatch.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Rated lifespan for the test filter.  replace30 offset = max(min(90−30,89),1) = 60.
 * replace15 offset = max(61, 90−15) = 75.
 * We'll use different activatedAt values per scenario to put the right stage in the
 * grace window.
 */
const TEST_LIFESPAN = 90;

/** Product id used across all scenarios. */
const TEST_PRODUCT_ID = 99801;

// ── Shared state ──────────────────────────────────────────────────────────────

const TEST_EMAIL = `reminder-rewards-${Date.now()}@uctest.internal`;
let testUserId: number;

let realFetch: typeof globalThis.fetch;
const RESEND_STUB = "http://resend-rewards-stub.test";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  realFetch = globalThis.fetch;

  // Route sendViaResend through the direct-fetch path.
  process.env["RESEND_BASE_URL"] = RESEND_STUB;

  // Intercept fetch: absorb Resend calls without network I/O.
  globalThis.fetch = async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url).startsWith(RESEND_STUB)) {
      return new Response(JSON.stringify({ id: "re_rewards_stub" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return realFetch(url, init);
  };

  // Create the test user.
  const hash = await bcryptjs.hash("TestPass1!", 4);
  const [user] = await db
    .insert(ucUsersTable)
    .values({
      email: TEST_EMAIL,
      passwordHash: hash,
      firstName: "Rewards",
      lastName: "Tester",
      phone: "+254700099901",
    })
    .returning({ id: ucUsersTable.id });
  testUserId = user!.id;

  // Opt in to email reminders only so exactly one channel fires.
  await db.insert(ucNotifPrefsTable).values({
    userId: String(testUserId),
    reminderEmail: true,
    reminderSms: false,
    reminderWhatsapp: false,
  });

  // Seed an active filter-replacement rewards rule.
  await db
    .insert(ucRewardsRulesTable)
    .values({
      eventType: "filter-replacement",
      label: "Filter Replacement Reward (test)",
      pointsValue: 50,
      active: true,
    })
    .onConflictDoUpdate({
      target: ucRewardsRulesTable.eventType,
      set: { pointsValue: 50, active: true },
    });
});

after(async () => {
  // Restore environment and globals.
  delete process.env["RESEND_BASE_URL"];
  globalThis.fetch = realFetch;

  // Remove ledger rows created by this test run.
  await db
    .delete(ucRewardsLedgerTable)
    .where(eq(ucRewardsLedgerTable.userId, testUserId));

  // Remove filter reminder and notif prefs rows.
  await db
    .delete(ucFilterRemindersTable)
    .where(eq(ucFilterRemindersTable.userId, String(testUserId)));
  await db
    .delete(ucNotifPrefsTable)
    .where(eq(ucNotifPrefsTable.userId, String(testUserId)));

  // Remove the test user.
  await db.delete(ucUsersTable).where(eq(ucUsersTable.id, testUserId));

  // Restore the rewards rule to active=true / pointsValue=50 so other tests
  // that depend on it are unaffected.  Leave the row in place; it may have
  // existed before this test ran.
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Days before now as a Date. */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

/**
 * Seed (or replace) the filter-reminder row so the chosen stage is in the
 * grace window today.
 *
 * replace30 offset = 60  → activate 61 days ago (within GRACE_DAYS=3 of 60)
 * replace15 offset = 75  → activate 76 days ago
 */
async function seedReminderForStage(
  stage: "replace30" | "replace15",
  sentStages: string[] = [],
): Promise<Date> {
  const daysBack = stage === "replace30" ? 61 : 76;
  const activatedAt = daysAgo(daysBack);

  await db
    .insert(ucFilterRemindersTable)
    .values({
      userId: String(testUserId),
      productId: TEST_PRODUCT_ID,
      productName: "Rewards Test Filter",
      lifespanDays: TEST_LIFESPAN,
      activatedAt,
      sentStages,
      active: true,
    })
    .onConflictDoUpdate({
      target: ucFilterRemindersTable.userId,
      set: {
        productId: TEST_PRODUCT_ID,
        productName: "Rewards Test Filter",
        lifespanDays: TEST_LIFESPAN,
        activatedAt,
        sentStages,
        active: true,
        updatedAt: new Date(),
      },
    });

  return activatedAt;
}

/** Return all ledger rows for the test user scoped to filter-replacement. */
async function fetchLedgerRows() {
  return db
    .select()
    .from(ucRewardsLedgerTable)
    .where(
      and(
        eq(ucRewardsLedgerTable.userId, testUserId),
        eq(ucRewardsLedgerTable.eventType, "filter-replacement"),
      ),
    );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("dispatchFilterReminders — rewards points crediting", () => {
  it("credits a ledger row with correct userId, points, and refId when replace30 fires", async () => {
    // Arrange: replace30 is due today (activated 61 days ago, offset = 60, grace = 3).
    const activatedAt = await seedReminderForStage("replace30");

    // Delete any leftover ledger rows from earlier sub-tests.
    await db
      .delete(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.userId, testUserId));

    // Act
    const summary = await dispatchFilterReminders();

    // Assert dispatch recorded a send.
    assert.ok(summary.stagesSent >= 1, `expected at least one stagesSent, got ${summary.stagesSent}`);

    // Assert ledger row was inserted.
    const rows = await fetchLedgerRows();
    assert.equal(rows.length, 1, `expected 1 ledger row, got ${rows.length}`);

    const row = rows[0]!;
    assert.equal(row.userId, testUserId, "ledger userId must match the test user");
    assert.equal(row.points, 50, "ledger points must match the rule's pointsValue");
    assert.equal(row.eventType, "filter-replacement", "ledger eventType must be filter-replacement");

    // refId must be cycle-scoped: "<userId>:<productId>:<activatedAtMs>:replace30"
    const expectedRefId = `${testUserId}:${TEST_PRODUCT_ID}:${activatedAt.getTime()}:replace30`;
    assert.equal(row.refId, expectedRefId, `expected refId "${expectedRefId}", got "${row.refId}"`);
  });

  it("does NOT insert a duplicate ledger row when the same stage is dispatched again (idempotency)", async () => {
    // The stage was already claimed in the previous test; re-running dispatch
    // must not double-credit points.
    const rowsBefore = await fetchLedgerRows();
    assert.equal(rowsBefore.length, 1, "prerequisite: exactly 1 ledger row should exist before re-dispatch");

    // Act: second dispatch run.
    const summary = await dispatchFilterReminders();

    // No new stages should be sent (stage already claimed).
    assert.equal(summary.stagesSent, 0, `stagesSent must be 0 on re-dispatch, got ${summary.stagesSent}`);

    // Ledger row count must remain 1.
    const rowsAfter = await fetchLedgerRows();
    assert.equal(rowsAfter.length, 1, `expected 1 ledger row after re-dispatch, got ${rowsAfter.length}`);
  });

  it("credits a separate ledger row for replace15 with its own scoped refId", async () => {
    // Arrange: set activatedAt so replace15 (offset=75) is due today;
    // mark replace30 already sent so only replace15 fires.
    const activatedAt = await seedReminderForStage("replace15", ["activation", "day30", "replace30"]);

    // Clear ledger rows from the replace30 tests above.
    await db
      .delete(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.userId, testUserId));

    // Act
    const summary = await dispatchFilterReminders();

    assert.ok(summary.stagesSent >= 1, `expected at least 1 stagesSent for replace15, got ${summary.stagesSent}`);

    const rows = await fetchLedgerRows();
    assert.equal(rows.length, 1, `expected 1 ledger row for replace15, got ${rows.length}`);

    const row = rows[0]!;
    assert.equal(row.userId, testUserId, "ledger userId must match the test user");
    assert.equal(row.points, 50, "ledger points must match the rule's pointsValue");

    const expectedRefId = `${testUserId}:${TEST_PRODUCT_ID}:${activatedAt.getTime()}:replace15`;
    assert.equal(row.refId, expectedRefId, `expected refId "${expectedRefId}", got "${row.refId}"`);
  });

  it("does NOT credit points when the filter-replacement rule is inactive", async () => {
    // Arrange: deactivate the rule and set up replace30 on a fresh cycle.
    await db
      .update(ucRewardsRulesTable)
      .set({ active: false })
      .where(eq(ucRewardsRulesTable.eventType, "filter-replacement"));

    // Use a new activatedAt to avoid any existing claimed stages.
    const newActivatedAt = daysAgo(61);
    await db
      .insert(ucFilterRemindersTable)
      .values({
        userId: String(testUserId),
        productId: TEST_PRODUCT_ID,
        productName: "Rewards Test Filter",
        lifespanDays: TEST_LIFESPAN,
        activatedAt: newActivatedAt,
        sentStages: [],
        active: true,
      })
      .onConflictDoUpdate({
        target: ucFilterRemindersTable.userId,
        set: {
          productId: TEST_PRODUCT_ID,
          productName: "Rewards Test Filter",
          lifespanDays: TEST_LIFESPAN,
          activatedAt: newActivatedAt,
          sentStages: [],
          active: true,
          updatedAt: new Date(),
        },
      });

    await db
      .delete(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.userId, testUserId));

    // Act
    await dispatchFilterReminders();

    // Assert: no ledger row inserted because the rule is inactive.
    const rows = await fetchLedgerRows();
    assert.equal(
      rows.length,
      0,
      `expected 0 ledger rows when rule is inactive, got ${rows.length}`,
    );

    // Restore rule for any subsequent tests.
    await db
      .update(ucRewardsRulesTable)
      .set({ active: true })
      .where(eq(ucRewardsRulesTable.eventType, "filter-replacement"));
  });
});
