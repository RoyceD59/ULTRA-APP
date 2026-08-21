/**
 * Tests for push notifications fired when rewards points are credited.
 *
 * Covers:
 *   1. A push notification is sent with the correct body format when
 *      creditReplacementPoints credits points (via dispatchFilterReminders).
 *   2. The push is skipped when the user has opted out of order/reminder
 *      notifications (optOutOrders = true in uc_push_tokens).
 *   3. The push is skipped silently when no push token is registered.
 *   4. A stale DeviceNotRegistered token is deleted after a failed send.
 *   5. A push notification is sent after the admin POST /uc/admin/rewards/grant.
 *
 * Strategy:
 *   - Intercept globalThis.fetch to absorb Expo push API calls and capture
 *     the outgoing payload without real network I/O.
 *   - Resend calls are absorbed via RESEND_BASE_URL stub (same as other tests).
 *   - All seeded rows are removed in after().
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";
import { and, eq } from "drizzle-orm";

import {
  db,
  ucUsersTable,
  ucFilterRemindersTable,
  ucNotifPrefsTable,
  ucRewardsRulesTable,
  ucRewardsLedgerTable,
  ucPushTokensTable,
} from "@workspace/db";
import { dispatchFilterReminders } from "../lib/reminder-dispatch.js";
import { issueToken } from "../lib/jwt.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_LIFESPAN = 90;
// replace30 offset = max(min(90−30,89),1) = 60; activate 61 days ago → in grace window
const DAYS_BACK_REPLACE30 = 61;
const TEST_PRODUCT_ID = 99871;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const RESEND_STUB = "http://resend-rewards-push-stub.test";
const TEST_PUSH_TOKEN = "ExponentPushToken[rewards-push-test-token]";
const STALE_PUSH_TOKEN  = "ExponentPushToken[rewards-stale-token]";

// ── Shared state ──────────────────────────────────────────────────────────────

let testUserId: number;
let testUserEmail: string;
let server: http.Server;
let capturedPushPayloads: unknown[] = [];
let realFetch: typeof globalThis.fetch;
let simulateStaleToken = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

async function seedPushToken(opts: { optOutOrders?: boolean; token?: string } = {}): Promise<void> {
  await db
    .insert(ucPushTokensTable)
    .values({
      userId: String(testUserId),
      pushToken: opts.token ?? TEST_PUSH_TOKEN,
      optOutOrders: opts.optOutOrders ?? false,
    })
    .onConflictDoUpdate({
      target: ucPushTokensTable.userId,
      set: {
        pushToken: opts.token ?? TEST_PUSH_TOKEN,
        optOutOrders: opts.optOutOrders ?? false,
        updatedAt: new Date(),
      },
    });
}

async function clearPushToken(): Promise<void> {
  await db.delete(ucPushTokensTable).where(eq(ucPushTokensTable.userId, String(testUserId)));
}

async function seedFilterReminder(sentStages: string[] = []): Promise<void> {
  const activatedAt = daysAgo(DAYS_BACK_REPLACE30);
  await db
    .insert(ucFilterRemindersTable)
    .values({
      userId: String(testUserId),
      productId: TEST_PRODUCT_ID,
      productName: "Push Test Filter",
      lifespanDays: TEST_LIFESPAN,
      activatedAt,
      sentStages,
      active: true,
    })
    .onConflictDoUpdate({
      target: ucFilterRemindersTable.userId,
      set: {
        productId: TEST_PRODUCT_ID,
        productName: "Push Test Filter",
        lifespanDays: TEST_LIFESPAN,
        activatedAt,
        sentStages,
        active: true,
        updatedAt: new Date(),
      },
    });
}

async function clearLedger(): Promise<void> {
  await db.delete(ucRewardsLedgerTable).where(eq(ucRewardsLedgerTable.userId, testUserId));
}

async function apiFetch(
  path: string,
  init: RequestInit
): Promise<{ status: number; body: unknown }> {
  const addr = server.address() as { port: number };
  const res = await realFetch(`http://localhost:${addr.port}${path}`, init);
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

function adminAuthHeader(): string {
  // The test user is created with isAdmin:true (DB-anchored path in isAdminRequest).
  // Issue a JWT with their real numeric ID so requireAdmin resolves correctly.
  return `Bearer ${issueToken({ id: testUserId, email: testUserEmail, firstName: "PushRewards", lastName: "Tester" })}`;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  realFetch = globalThis.fetch;
  process.env["SESSION_SECRET"] ??= "test-secret-rewards-push";
  process.env["RESEND_BASE_URL"] = RESEND_STUB;

  // Intercept fetch: capture Expo push calls; absorb Resend calls.
  globalThis.fetch = async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.startsWith(RESEND_STUB)) {
      return new Response(JSON.stringify({ id: "re_stub" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr === EXPO_PUSH_URL) {
      const body = init?.body ? JSON.parse(String(init.body)) : [];
      capturedPushPayloads.push(...body);
      if (simulateStaleToken) {
        return new Response(
          JSON.stringify({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ data: [{ status: "ok" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return realFetch(url, init);
  };

  // Create test user.
  testUserEmail = `rewards-push-${Date.now()}@uctest.internal`;
  const hash = await bcryptjs.hash("TestPass1!", 4);
  const [user] = await db
    .insert(ucUsersTable)
    .values({
      email: testUserEmail,
      passwordHash: hash,
      firstName: "PushRewards",
      lastName: "Tester",
      phone: "+254700099801",
      isAdmin: true,
    })
    .returning({ id: ucUsersTable.id });
  testUserId = user!.id;

  await db.insert(ucNotifPrefsTable).values({
    userId: String(testUserId),
    reminderEmail: true,
    reminderSms: false,
    reminderWhatsapp: false,
  });

  // Ensure active filter-replacement rewards rule exists.
  await db
    .insert(ucRewardsRulesTable)
    .values({ eventType: "filter-replacement", label: "Push Test Reward", pointsValue: 75, active: true })
    .onConflictDoUpdate({
      target: ucRewardsRulesTable.eventType,
      set: { pointsValue: 75, active: true },
    });

  // Start HTTP server for admin-grant tests.
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  globalThis.fetch = realFetch;
  delete process.env["RESEND_BASE_URL"];

  await clearLedger();
  await clearPushToken();
  await db.delete(ucFilterRemindersTable).where(eq(ucFilterRemindersTable.userId, String(testUserId)));
  await db.delete(ucNotifPrefsTable).where(eq(ucNotifPrefsTable.userId, String(testUserId)));
  await db.delete(ucUsersTable).where(eq(ucUsersTable.id, testUserId));

  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Rewards push notification — filter-replacement credit path", () => {
  beforeEach(async () => {
    capturedPushPayloads = [];
    simulateStaleToken = false;
    await clearLedger();
  });

  it("sends a push notification with the correct body format when points are credited", async () => {
    await seedPushToken();
    await seedFilterReminder(["activation"]);

    await dispatchFilterReminders();

    // Allow fire-and-forget to complete.
    await new Promise(r => setTimeout(r, 200));

    assert.ok(capturedPushPayloads.length >= 1, `expected at least one Expo push, got ${capturedPushPayloads.length}`);
    const payload = capturedPushPayloads[0] as { to: string; title: string; body: string; data: unknown };
    assert.equal(payload.to, TEST_PUSH_TOKEN, "push must target the registered token");
    assert.match(payload.body, /^🌟 You earned \d+ points!/, "body must start with 🌟 You earned N points!");
    assert.match(payload.body, /Your balance is now \d+ pts\.$/, "body must end with balance");
    assert.ok(!payload.title.includes("🌟"), "emoji belongs in body, not title");
  });

  it("skips the push when the user has opted out of order/reminder notifications", async () => {
    await seedPushToken({ optOutOrders: true });
    await seedFilterReminder(["activation"]);

    await dispatchFilterReminders();
    await new Promise(r => setTimeout(r, 200));

    // A ledger row should still be created — push is the only skipped part.
    const ledger = await db
      .select()
      .from(ucRewardsLedgerTable)
      .where(and(eq(ucRewardsLedgerTable.userId, testUserId), eq(ucRewardsLedgerTable.eventType, "filter-replacement")));
    assert.ok(ledger.length >= 1, "ledger row must still be created even when push is opted out");

    assert.equal(capturedPushPayloads.length, 0, "no push should fire when optOutOrders is true");
  });

  it("skips the push silently when no push token is registered", async () => {
    await clearPushToken();
    await seedFilterReminder(["activation"]);

    await dispatchFilterReminders();
    await new Promise(r => setTimeout(r, 200));

    assert.equal(capturedPushPayloads.length, 0, "no push should fire when no token is registered");
  });

  it("removes a stale DeviceNotRegistered token after a failed push", async () => {
    simulateStaleToken = true;
    await seedPushToken({ token: STALE_PUSH_TOKEN });
    await seedFilterReminder(["activation"]);

    await dispatchFilterReminders();
    await new Promise(r => setTimeout(r, 400));

    // Token must have been removed from uc_push_tokens.
    const row = await db.query.ucPushTokensTable.findFirst({
      where: eq(ucPushTokensTable.userId, String(testUserId)),
    });
    assert.equal(row, undefined, "stale token must be deleted after DeviceNotRegistered response");
  });
});

describe("Rewards push notification — admin grant endpoint", () => {
  beforeEach(async () => {
    capturedPushPayloads = [];
    simulateStaleToken = false;
    await clearLedger();
  });

  it("sends a push notification after a successful admin grant", async () => {
    await seedPushToken();

    const r = await apiFetch("/api/uc/admin/rewards/grant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: adminAuthHeader(),
      },
      body: JSON.stringify({
        lookup: testUserEmail,
        points: 30,
        reason: "Manual bonus for test",
        grantedBy: "test-admin",
      }),
    });

    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    await new Promise(res => setTimeout(res, 300));

    assert.ok(capturedPushPayloads.length >= 1, `expected at least one Expo push after grant, got ${capturedPushPayloads.length}`);
    const payload = capturedPushPayloads[0] as { to: string; body: string };
    assert.equal(payload.to, TEST_PUSH_TOKEN, "push must target the registered token");
    assert.match(payload.body, /^🌟 You earned 30 points!/, "body must reference granted points count");
    assert.match(payload.body, /Your balance is now \d+ pts\.$/, "body must include updated balance");
  });

  it("accepts the exact rewards QR payload rendered by a customer account", async () => {
    await clearPushToken();
    const appQrPayload = `uc-rewards:${testUserId}:+254700099801`;

    const r = await apiFetch("/api/uc/admin/rewards/grant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: adminAuthHeader(),
      },
      body: JSON.stringify({
        lookup: appQrPayload,
        points: 15,
        reason: "QR account scan test",
        grantedBy: "test-admin",
      }),
    });

    assert.equal(r.status, 201, `expected QR scan to grant points: ${JSON.stringify(r.body)}`);
    const body = r.body as { customer?: { id?: number }; newBalance?: number };
    assert.equal(body.customer?.id, testUserId, "QR payload must resolve the account encoded by the app");
    assert.equal(body.newBalance, 15, "the scan must credit the selected account");
  });

  it("does not send a push when the customer has no push token (grant still succeeds)", async () => {
    await clearPushToken();

    const r = await apiFetch("/api/uc/admin/rewards/grant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: adminAuthHeader(),
      },
      body: JSON.stringify({
        lookup: testUserEmail,
        points: 10,
        reason: "No-token test grant",
        grantedBy: "test-admin",
      }),
    });

    // Grant must succeed regardless of push token presence.
    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    await new Promise(res => setTimeout(res, 200));

    assert.equal(capturedPushPayloads.length, 0, "no push should fire when no token is registered");
  });
});
