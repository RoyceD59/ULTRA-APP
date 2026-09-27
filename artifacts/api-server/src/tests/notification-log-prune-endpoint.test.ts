/**
 * Integration tests for POST /api/uc/admin/notification-logs/prune
 *
 * Covers:
 *   (a) 403 when a non-admin token is provided
 *   (b) 403 when no Authorization header is provided
 *   (c) Old sent rows (past success window) are deleted; recent sent rows survive
 *   (d) Old failed rows (past failure window) are deleted; recent failed rows survive
 *   (e) Response shape has deletedSuccess, deletedFailure, and deletedTotal = sum
 *
 * Strategy:
 *   - App started on an ephemeral port (listen(0)) — never clashes with dev server.
 *   - A test admin and a test regular user are seeded in the DB, cleaned up in after().
 *   - team_settings retention windows are set to 5 d (success) / 10 d (failure) for
 *     determinism, then restored in after().
 *   - MPESA_* and WC_* env vars are deleted before the suite, per harness conventions.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";

import app from "../app.js";
import { db, ucUsersTable, ucNotificationLogTable, teamSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Harness: clear env vars that confuse the order-flow helpers ───────────────
const MPESA_WC_KEYS = [
  "MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_PASSKEY",
  "MPESA_SHORTCODE", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET",
];
const savedEnv: Record<string, string | undefined> = {};
for (const k of MPESA_WC_KEYS) {
  savedEnv[k] = process.env[k];
  delete process.env[k];
}

// ── Server setup ──────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;
let adminJwt: string;
let regularJwt: string;

const ADMIN_EMAIL   = `prune-ep-admin-${Date.now()}@uctest.internal`;
const REGULAR_EMAIL = `prune-ep-user-${Date.now()}@uctest.internal`;
const TEST_PASSWORD = "test-secret-pw-12345";

const createdUserIds: number[] = [];
const createdLogIds:  number[] = [];

// Snapshot of the team_settings retention fields before the test mutates them.
let prevSuccessDays: number | null = null;
let prevFailureDays: number | null = null;
let settingsExisted = false;

// Retention windows used during this suite (in days).
const SUCCESS_DAYS = 5;
const FAILURE_DAYS = 10;

/** Returns a Date that is `days` days in the past. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

before(
  async () => {
    // ── 1. Start the server ────────────────────────────────────────────────
    await new Promise<void>((resolve, reject) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("Could not determine server address"));
          return;
        }
        base = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    });

    // ── 2. Seed users ──────────────────────────────────────────────────────
    const hash = await bcryptjs.hash(TEST_PASSWORD, 4);

    const [admin] = await db
      .insert(ucUsersTable)
      .values({ email: ADMIN_EMAIL, passwordHash: hash, firstName: "Prune", lastName: "Admin", phone: "+254700000010", isAdmin: true })
      .returning({ id: ucUsersTable.id });
    createdUserIds.push(admin!.id);

    const [regular] = await db
      .insert(ucUsersTable)
      .values({ email: REGULAR_EMAIL, passwordHash: hash, firstName: "Prune", lastName: "User", phone: "+254700000011", isAdmin: false })
      .returning({ id: ucUsersTable.id });
    createdUserIds.push(regular!.id);

    // ── 3. Obtain JWTs ─────────────────────────────────────────────────────
    async function login(email: string): Promise<string> {
      const resp = await fetch(`${base}/uc/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: TEST_PASSWORD }),
      });
      assert.equal(resp.status, 200, `login must succeed for ${email}`);
      const body = await resp.json() as { token?: string };
      assert.ok(body.token, "login response must include a JWT");
      return body.token!;
    }

    adminJwt   = await login(ADMIN_EMAIL);
    regularJwt = await login(REGULAR_EMAIL);

    // ── 4. Configure deterministic retention windows in team_settings ──────
    const [existing] = await db
      .select({
        successDays: teamSettingsTable.notificationLogSuccessRetentionDays,
        failureDays: teamSettingsTable.notificationLogFailureRetentionDays,
      })
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);

    settingsExisted = existing !== undefined;
    prevSuccessDays = existing?.successDays ?? null;
    prevFailureDays = existing?.failureDays ?? null;

    if (settingsExisted) {
      await db
        .update(teamSettingsTable)
        .set({
          notificationLogSuccessRetentionDays: SUCCESS_DAYS,
          notificationLogFailureRetentionDays: FAILURE_DAYS,
        })
        .where(eq(teamSettingsTable.id, "singleton"));
    } else {
      await db
        .insert(teamSettingsTable)
        .values({
          id: "singleton",
          notificationLogSuccessRetentionDays: SUCCESS_DAYS,
          notificationLogFailureRetentionDays: FAILURE_DAYS,
        });
    }
  },
  { timeout: 30_000 },
);

after(async () => {
  // ── Restore team_settings ──────────────────────────────────────────────────
  if (settingsExisted) {
    await db
      .update(teamSettingsTable)
      .set({
        notificationLogSuccessRetentionDays: prevSuccessDays,
        notificationLogFailureRetentionDays: prevFailureDays,
      })
      .where(eq(teamSettingsTable.id, "singleton"));
  } else {
    // We inserted the singleton; remove the retention overrides (set back to null).
    await db
      .update(teamSettingsTable)
      .set({
        notificationLogSuccessRetentionDays: null,
        notificationLogFailureRetentionDays: null,
      })
      .where(eq(teamSettingsTable.id, "singleton"));
  }

  // ── Clean up log rows ──────────────────────────────────────────────────────
  if (createdLogIds.length > 0) {
    await db
      .delete(ucNotificationLogTable)
      .where(inArray(ucNotificationLogTable.id, createdLogIds));
  }

  // ── Clean up users ─────────────────────────────────────────────────────────
  if (createdUserIds.length > 0) {
    await db
      .delete(ucUsersTable)
      .where(inArray(ucUsersTable.id, createdUserIds));
  }

  // ── Restore env vars ───────────────────────────────────────────────────────
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Insert a notification log row and record its id for cleanup. */
async function insertLog(overrides: {
  status:  "sent" | "failed";
  sentAt:  Date;
  channel?: string;
}): Promise<number> {
  const [row] = await db
    .insert(ucNotificationLogTable)
    .values({
      channel:     overrides.channel ?? "sms",
      recipient:   "+254712000099",
      template:    "order_confirmation",
      messageBody: "Test prune message",
      status:      overrides.status,
      sentAt:      overrides.sentAt,
    })
    .returning({ id: ucNotificationLogTable.id });
  const id = row!.id;
  createdLogIds.push(id);
  return id;
}

/** Call the prune endpoint and return the raw Response. */
function callPrune(token?: string): Promise<Response> {
  return fetch(`${base}/uc/admin/notification-logs/prune`, {
    method:  "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function callPrunePreview(token?: string): Promise<Response> {
  return fetch(`${base}/uc/admin/notification-logs/prune-preview`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/** Return true iff the given log row still exists in the DB. */
async function rowExists(id: number): Promise<boolean> {
  const rows = await db
    .select({ id: ucNotificationLogTable.id })
    .from(ucNotificationLogTable)
    .where(eq(ucNotificationLogTable.id, id))
    .limit(1);
  return rows.length > 0;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /uc/admin/notification-logs/prune — authorization", () => {
  it("(a) returns 403 when no Authorization header is provided", async () => {
    const resp = await callPrune();
    assert.equal(resp.status, 403, "missing auth must be rejected with 403");
  });

  it("(b) returns 403 when a non-admin token is provided", async () => {
    const resp = await callPrune(regularJwt);
    assert.equal(resp.status, 403, "non-admin token must be rejected with 403");
  });
});

describe("GET /uc/admin/notification-logs/prune-preview", () => {
  it("requires admin authorization", async () => {
    assert.equal((await callPrunePreview()).status, 403);
    assert.equal((await callPrunePreview(regularJwt)).status, 403);
  });

  it("counts eligible rows without deleting them", async () => {
    const oldSentId = await insertLog({ status: "sent", sentAt: daysAgo(SUCCESS_DAYS + 3) });
    const oldFailedId = await insertLog({ status: "failed", sentAt: daysAgo(FAILURE_DAYS + 3) });
    const recentSentId = await insertLog({ status: "sent", sentAt: daysAgo(2) });

    const resp = await callPrunePreview(adminJwt);
    assert.equal(resp.status, 200);
    const body = await resp.json() as {
      eligibleSuccess: number;
      eligibleFailure: number;
      eligibleTotal: number;
    };
    assert.ok(body.eligibleSuccess >= 1);
    assert.ok(body.eligibleFailure >= 1);
    assert.equal(body.eligibleTotal, body.eligibleSuccess + body.eligibleFailure);
    assert.equal(await rowExists(oldSentId), true);
    assert.equal(await rowExists(oldFailedId), true);
    assert.equal(await rowExists(recentSentId), true);
  });
});

describe("POST /uc/admin/notification-logs/prune — row retention", () => {
  it("(c) old sent rows are deleted; recent sent rows survive", async () => {
    // Old: SUCCESS_DAYS + 3 days past the window → must be pruned
    const oldSentId = await insertLog({ status: "sent", sentAt: daysAgo(SUCCESS_DAYS + 3) });
    // Recent: 2 days ago → inside the window → must be kept
    const recentSentId = await insertLog({ status: "sent", sentAt: daysAgo(2) });

    const resp = await callPrune(adminJwt);
    assert.equal(resp.status, 200, "prune must succeed with admin token");

    assert.equal(
      await rowExists(oldSentId), false,
      "sent row older than the success window must be deleted",
    );
    assert.equal(
      await rowExists(recentSentId), true,
      "sent row inside the success window must not be deleted",
    );

    // Remove the surviving recent row from the cleanup list — it's still there.
    // (It will be cleaned up by the after() hook via createdLogIds.)
  });

  it("(d) old failed rows are deleted; recent failed rows survive", async () => {
    // Old: FAILURE_DAYS + 5 days past the window → must be pruned
    const oldFailedId = await insertLog({ status: "failed", sentAt: daysAgo(FAILURE_DAYS + 5) });
    // Recent: 4 days ago → inside the failure window → must be kept
    const recentFailedId = await insertLog({ status: "failed", sentAt: daysAgo(4) });

    const resp = await callPrune(adminJwt);
    assert.equal(resp.status, 200, "prune must succeed with admin token");

    assert.equal(
      await rowExists(oldFailedId), false,
      "failed row older than the failure window must be deleted",
    );
    assert.equal(
      await rowExists(recentFailedId), true,
      "failed row inside the failure window must not be deleted",
    );
  });
});

describe("POST /uc/admin/notification-logs/prune — response shape", () => {
  it("(e) response reports deletedSuccess, deletedFailure, and deletedTotal = sum", async () => {
    // Seed one old sent and one old failed row so the counts are non-zero.
    await insertLog({ status: "sent",   sentAt: daysAgo(SUCCESS_DAYS + 4) });
    await insertLog({ status: "failed", sentAt: daysAgo(FAILURE_DAYS + 6) });

    const resp = await callPrune(adminJwt);
    assert.equal(resp.status, 200);

    const body = await resp.json() as {
      ok?: boolean;
      deletedSuccess?: number;
      deletedFailure?: number;
      deletedTotal?: number;
    };

    assert.equal(body.ok, true, "response must have ok=true");
    assert.ok(typeof body.deletedSuccess === "number", "deletedSuccess must be a number");
    assert.ok(typeof body.deletedFailure === "number", "deletedFailure must be a number");
    assert.ok(typeof body.deletedTotal   === "number", "deletedTotal must be a number");

    assert.equal(
      body.deletedTotal,
      (body.deletedSuccess ?? 0) + (body.deletedFailure ?? 0),
      "deletedTotal must equal deletedSuccess + deletedFailure",
    );

    // The rows we just seeded must have been counted.
    assert.ok(
      (body.deletedSuccess ?? 0) >= 1,
      `deletedSuccess should be ≥ 1 (got ${body.deletedSuccess})`,
    );
    assert.ok(
      (body.deletedFailure ?? 0) >= 1,
      `deletedFailure should be ≥ 1 (got ${body.deletedFailure})`,
    );
  });
});
