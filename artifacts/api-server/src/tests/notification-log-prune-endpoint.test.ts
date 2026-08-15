/**
 * Integration tests for POST /api/uc/admin/notification-logs/prune ("Prune now")
 *
 * Covers:
 *   (a) 403 when no admin auth token provided
 *   (b) 200 happy path: rows past retention are deleted, recent rows are kept,
 *       and the response reports deletedSuccess / deletedFailure / deletedTotal
 *   (c) team_settings retention overrides are honoured: with a longer success
 *       retention configured in the admin panel, a sent row that would be
 *       deleted under the 30-day default is preserved.
 *
 * The app is started on an ephemeral port (listen(0)). All DB rows and users
 * created during tests are deleted in the after() hook, and any pre-existing
 * team_settings retention overrides are restored.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";

import app from "../app.js";
import { db, ucUsersTable, ucNotificationLogTable, teamSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Server setup ──────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;
let adminJwt: string;

const TEST_ADMIN_EMAIL    = `notif-prune-test-${Date.now()}@uctest.internal`;
const TEST_ADMIN_PASSWORD = "test-secret-pw-12345";
const createdUserIds: number[] = [];
const createdLogIds:  number[] = [];

// Snapshot of any pre-existing team_settings overrides so tests can restore them.
let priorSuccessDays: number | null = null;
let priorFailureDays: number | null = null;
let hadSettingsRow = false;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function insertLog(status: "sent" | "failed", sentAt: Date): Promise<number> {
  const [row] = await db
    .insert(ucNotificationLogTable)
    .values({
      channel:     "sms",
      provider:    "test",
      recipient:   "+254700000001",
      template:    "prune_endpoint_test",
      messageBody: "prune endpoint test row",
      status,
      sentAt,
    })
    .returning({ id: ucNotificationLogTable.id });
  createdLogIds.push(row!.id);
  return row!.id;
}

async function setRetentionOverrides(successDays: number | null, failureDays: number | null): Promise<void> {
  await db
    .insert(teamSettingsTable)
    .values({
      id: "singleton",
      notificationLogSuccessRetentionDays: successDays,
      notificationLogFailureRetentionDays: failureDays,
      updatedAt: new Date(),
    } as typeof teamSettingsTable.$inferInsert)
    .onConflictDoUpdate({
      target: teamSettingsTable.id,
      set: {
        notificationLogSuccessRetentionDays: successDays,
        notificationLogFailureRetentionDays: failureDays,
        updatedAt: new Date(),
      },
    });
}

async function prune(token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/uc/admin/notification-logs/prune`, {
    method:  "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, body };
}

async function logExists(id: number): Promise<boolean> {
  const [row] = await db
    .select({ id: ucNotificationLogTable.id })
    .from(ucNotificationLogTable)
    .where(eq(ucNotificationLogTable.id, id))
    .limit(1);
  return !!row;
}

before(
  async () => {
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

    // Snapshot existing team_settings overrides for restoration.
    const [existing] = await db
      .select({
        successDays: teamSettingsTable.notificationLogSuccessRetentionDays,
        failureDays: teamSettingsTable.notificationLogFailureRetentionDays,
      })
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);
    hadSettingsRow   = !!existing;
    priorSuccessDays = existing?.successDays ?? null;
    priorFailureDays = existing?.failureDays ?? null;

    const passwordHash = await bcryptjs.hash(TEST_ADMIN_PASSWORD, 4);
    const [user] = await db
      .insert(ucUsersTable)
      .values({
        email:     TEST_ADMIN_EMAIL,
        passwordHash,
        firstName: "Test",
        lastName:  "Admin",
        phone:     "+254700000098",
        isAdmin:   true,
      })
      .returning({ id: ucUsersTable.id });
    createdUserIds.push(user!.id);

    const resp = await fetch(`${base}/uc/auth/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(resp.status, 200, "login must succeed for the test admin user");
    const body = await resp.json() as { token?: string };
    assert.ok(body.token, "login response must include a JWT token");
    adminJwt = body.token!;
  },
  { timeout: 30_000 },
);

after(async () => {
  // Restore team_settings overrides.
  if (hadSettingsRow) {
    await setRetentionOverrides(priorSuccessDays, priorFailureDays);
  } else {
    await db.delete(teamSettingsTable).where(eq(teamSettingsTable.id, "singleton"));
  }
  if (createdLogIds.length > 0) {
    await db
      .delete(ucNotificationLogTable)
      .where(inArray(ucNotificationLogTable.id, createdLogIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, createdUserIds));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/uc/admin/notification-logs/prune", () => {
  it("rejects requests without admin auth (403)", async () => {
    const { status } = await prune();
    assert.equal(status, 403);
  });

  it("deletes rows past retention, keeps recent rows, and reports counts", async () => {
    // No overrides → env/default retention (sent=30d, failed=90d in tests).
    await setRetentionOverrides(null, null);

    const oldSent     = await insertLog("sent",   daysAgo(45));   // past 30d  → deleted
    const recentSent  = await insertLog("sent",   daysAgo(5));    // within 30d → kept
    const oldFailed   = await insertLog("failed", daysAgo(120));  // past 90d  → deleted
    const recentFailed = await insertLog("failed", daysAgo(50));  // within 90d → kept

    const { status, body } = await prune(adminJwt);
    assert.equal(status, 200);
    assert.equal(body["ok"], true);
    assert.equal(typeof body["deletedSuccess"], "number");
    assert.equal(typeof body["deletedFailure"], "number");
    assert.equal(
      body["deletedTotal"],
      (body["deletedSuccess"] as number) + (body["deletedFailure"] as number),
    );
    assert.ok((body["deletedSuccess"] as number) >= 1, "at least the old sent row must be counted");
    assert.ok((body["deletedFailure"] as number) >= 1, "at least the old failed row must be counted");

    assert.equal(await logExists(oldSent),      false, "45-day-old sent row must be pruned");
    assert.equal(await logExists(oldFailed),    false, "120-day-old failed row must be pruned");
    assert.equal(await logExists(recentSent),   true,  "5-day-old sent row must survive");
    assert.equal(await logExists(recentFailed), true,  "50-day-old failed row must survive");
  });

  it("honours a longer team_settings retention override over the default", async () => {
    // Admin panel configured 60-day success retention: a 45-day-old sent row
    // would be deleted under the 30-day default but must survive here.
    await setRetentionOverrides(60, 90);

    const sent45 = await insertLog("sent", daysAgo(45)); // within 60d override → kept
    const sent70 = await insertLog("sent", daysAgo(70)); // past 60d override   → deleted

    const { status, body } = await prune(adminJwt);
    assert.equal(status, 200);
    assert.equal(body["ok"], true);

    assert.equal(
      await logExists(sent45),
      true,
      "45-day-old sent row must survive when the configured retention is 60 days",
    );
    assert.equal(await logExists(sent70), false, "70-day-old sent row must be pruned");
  });
});
