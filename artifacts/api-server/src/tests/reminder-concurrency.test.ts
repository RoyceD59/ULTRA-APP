/**
 * Tests for the atomic stage-claim guard in dispatchFilterReminders().
 *
 * Covers:
 *   1. Two concurrent dispatch runs never double-send: exactly one send per
 *      stage when both Promise.all branches race for the same claim.
 *   2. A third run sends nothing — the stage is already recorded.
 *   3. A cycle reset (new activatedAt + cleared sentStages, e.g. filter
 *      replaced) allows the activation stage to be claimed once more without
 *      triggering a double-send on a concurrent retry.
 *   4. A row inserted with microsecond-precision `now()` (as the production
 *      sync endpoint writes it) is still claimed correctly by the millisecond-
 *      truncating date comparison in claimStage().
 *
 * Strategy:
 *   - Insert a real uc_users row (required by the inner join in
 *     dispatchFilterReminders) with reminderEmail=true.
 *   - Set RESEND_BASE_URL to a local stub endpoint and intercept
 *     globalThis.fetch so every attempted send is counted without network I/O.
 *   - SMS is a silent no-op when AT credentials are absent (default in test env).
 *   - WhatsApp is skipped when the session is disconnected (default).
 *   - All rows are deleted in after().
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import bcryptjs from "bcryptjs";
import { sql, eq } from "drizzle-orm";

import {
  db,
  ucUsersTable,
  ucFilterRemindersTable,
  ucNotifPrefsTable,
} from "@workspace/db";
import { dispatchFilterReminders } from "../lib/reminder-dispatch.js";

// ── Shared test state ─────────────────────────────────────────────────────────

const TEST_EMAIL = `reminder-conc-${Date.now()}@uctest.internal`;
let testUserId: number;

/** Count of stub Resend calls made during the current test window. */
let resendCallCount = 0;
let realFetch: typeof globalThis.fetch;
const RESEND_STUB = "http://resend-stub.test";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  realFetch = globalThis.fetch;

  // Route sendViaResend through the direct-fetch path (not the connector proxy)
  // by pointing RESEND_BASE_URL at our stub host.
  process.env["RESEND_BASE_URL"] = RESEND_STUB;

  // Intercept fetch: count Resend calls and return a stub 200.
  globalThis.fetch = async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url).startsWith(RESEND_STUB)) {
      resendCallCount++;
      return new Response(JSON.stringify({ id: "re_stub" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Let anything else (connector proxy, DB, etc.) through.
    return realFetch(url, init);
  };

  // Create the test user (integer id).
  const hash = await bcryptjs.hash("TestPass1!", 4);
  const [user] = await db
    .insert(ucUsersTable)
    .values({
      email: TEST_EMAIL,
      passwordHash: hash,
      firstName: "Reminder",
      lastName: "Tester",
      phone: "+254700000042",
    })
    .returning({ id: ucUsersTable.id });
  testUserId = user!.id;

  // Opt in to email reminders only.
  await db.insert(ucNotifPrefsTable).values({
    userId: String(testUserId),
    reminderEmail: true,
    reminderSms: false,
    reminderWhatsapp: false,
  });
});

after(async () => {
  // Restore environment and globals.
  delete process.env["RESEND_BASE_URL"];
  globalThis.fetch = realFetch;

  // Remove all seeded rows.
  await db
    .delete(ucFilterRemindersTable)
    .where(eq(ucFilterRemindersTable.userId, String(testUserId)));
  await db
    .delete(ucNotifPrefsTable)
    .where(eq(ucNotifPrefsTable.userId, String(testUserId)));
  await db.delete(ucUsersTable).where(eq(ucUsersTable.id, testUserId));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seed (or replace) the filter-reminder row for the test user. */
async function seedReminder(
  activatedAt: Date,
  sentStages: string[] = [],
): Promise<void> {
  await db
    .insert(ucFilterRemindersTable)
    .values({
      userId: String(testUserId),
      productId: 9901,
      productName: "Test Filter",
      lifespanDays: 90,
      activatedAt,
      sentStages,
      active: true,
    })
    .onConflictDoUpdate({
      target: ucFilterRemindersTable.userId,
      set: {
        productId: 9901,
        productName: "Test Filter",
        lifespanDays: 90,
        activatedAt,
        sentStages,
        active: true,
        updatedAt: new Date(),
      },
    });
}

/** Reset the sent-stages counter used to assert call counts per sub-test. */
function resetCounter(): void {
  resendCallCount = 0;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("dispatchFilterReminders — concurrent-claim idempotency", () => {
  it("two concurrent runs send the activation stage exactly once", async () => {
    // Activate today → the 'activation' stage (offset 0, grace 3) is due.
    await seedReminder(new Date());
    resetCounter();

    // Race two full dispatch runs.
    const [s1, s2] = await Promise.all([
      dispatchFilterReminders(),
      dispatchFilterReminders(),
    ]);

    // Exactly one run should have claimed and sent the activation stage.
    assert.equal(
      resendCallCount,
      1,
      `expected exactly 1 Resend call across both runs, got ${resendCallCount}`,
    );

    // Combined stagesSent across both runs must be 1.
    const totalSent = s1.stagesSent + s2.stagesSent;
    assert.equal(
      totalSent,
      1,
      `combined stagesSent must be 1, got ${totalSent}`,
    );
  });

  it("a third run after both concurrent runs sends nothing", async () => {
    // Reminder row still has activation claimed from the previous test.
    resetCounter();

    const s3 = await dispatchFilterReminders();

    assert.equal(
      resendCallCount,
      0,
      `third run must send 0 emails, got ${resendCallCount}`,
    );
    assert.equal(s3.stagesSent, 0, "stagesSent must be 0 on the third run");
  });

  for (const {
    stage,
    daysSinceActivation,
    previouslyHandled,
  } of [
    {
      stage: "day30",
      daysSinceActivation: 31,
      previouslyHandled: ["activation"],
    },
    {
      stage: "day60",
      daysSinceActivation: 61,
      previouslyHandled: ["activation", "day30", "replace30"],
    },
    {
      stage: "replace30",
      daysSinceActivation: 61,
      previouslyHandled: ["activation", "day30", "day60"],
    },
    {
      stage: "replace15",
      daysSinceActivation: 76,
      previouslyHandled: ["activation", "day30", "day60", "replace30"],
    },
  ] as const) {
    it(`two concurrent runs claim ${stage} exactly once and a third run sends nothing`, async () => {
      const activatedAt = new Date(Date.now() - daysSinceActivation * 86_400_000);
      await seedReminder(activatedAt, [...previouslyHandled]);
      resetCounter();

      const [first, second] = await Promise.all([
        dispatchFilterReminders(),
        dispatchFilterReminders(),
      ]);

      assert.equal(
        resendCallCount,
        1,
        `expected exactly 1 Resend call for ${stage} across both runs, got ${resendCallCount}`,
      );
      assert.equal(
        first.stagesSent + second.stagesSent,
        1,
        `combined stagesSent for ${stage} must be 1`,
      );

      const [row] = await db
        .select({ sentStages: ucFilterRemindersTable.sentStages })
        .from(ucFilterRemindersTable)
        .where(eq(ucFilterRemindersTable.userId, String(testUserId)))
        .limit(1);
      const claimedStages = Array.isArray(row?.sentStages) ? row.sentStages : [];
      assert.equal(
        claimedStages.filter((claimed) => claimed === stage).length,
        1,
        `${stage} must be recorded exactly once`,
      );

      resetCounter();
      const third = await dispatchFilterReminders();
      assert.equal(
        resendCallCount,
        0,
        `third run for ${stage} must send 0 emails`,
      );
      assert.equal(
        third.stagesSent,
        0,
        `third run for ${stage} must report 0 stagesSent`,
      );
    });
  }

  it("a cycle reset (new activatedAt + cleared sentStages) allows exactly one new send", async () => {
    // Simulate the user replacing their filter: new activatedAt, blank sentStages.
    const newActivatedAt = new Date();
    await db
      .update(ucFilterRemindersTable)
      .set({ activatedAt: newActivatedAt, sentStages: [], updatedAt: new Date() })
      .where(eq(ucFilterRemindersTable.userId, String(testUserId)));

    resetCounter();

    // Two concurrent runs race to claim the reset cycle's activation stage.
    await Promise.all([dispatchFilterReminders(), dispatchFilterReminders()]);

    assert.equal(
      resendCallCount,
      1,
      `after a cycle reset, exactly 1 Resend call expected across both runs, got ${resendCallCount}`,
    );
  });

  it("a second dispatch after a cycle reset sends nothing", async () => {
    resetCounter();
    const s = await dispatchFilterReminders();
    assert.equal(
      resendCallCount,
      0,
      `re-run after cycle-reset dispatch must send 0 emails, got ${resendCallCount}`,
    );
    assert.equal(s.stagesSent, 0);
  });

  it("microsecond-precision activated_at (inserted via raw SQL now()) is claimed correctly", async () => {
    // The production sync endpoint writes `now()` directly, giving microsecond
    // precision. claimStage() truncates to milliseconds before comparing, so
    // the claim must still succeed. Verify by inserting via raw SQL and then
    // running a dispatch: exactly one send, not zero (missed) or more than one.
    await db.execute(
      sql`
        INSERT INTO uc_filter_reminders
          (user_id, product_id, product_name, lifespan_days, activated_at,
           sent_stages, active, created_at, updated_at)
        VALUES (
          ${String(testUserId)},
          9901,
          'Test Filter',
          90,
          now(),        -- microsecond precision
          '[]'::jsonb,
          true,
          now(),
          now()
        )
        ON CONFLICT (user_id) DO UPDATE
          SET product_id   = EXCLUDED.product_id,
              product_name = EXCLUDED.product_name,
              lifespan_days = EXCLUDED.lifespan_days,
              activated_at  = EXCLUDED.activated_at,
              sent_stages   = EXCLUDED.sent_stages,
              active        = EXCLUDED.active,
              updated_at    = now()
      `,
    );

    resetCounter();

    // Two concurrent runs — claim must fire exactly once despite µs precision.
    await Promise.all([dispatchFilterReminders(), dispatchFilterReminders()]);

    assert.equal(
      resendCallCount,
      1,
      `microsecond-precision row must be claimed exactly once, got ${resendCallCount} Resend calls`,
    );
  });
});
