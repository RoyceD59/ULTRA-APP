/**
 * Rotation uses synthetic secrets in this test worker only. Never rotate the
 * workspace or production secret to run this check.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, teamSettingsTable, teamUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { issueToken, verifyToken } from "../lib/jwt.js";

const OLD_SECRET = "session-rotation-test-old-key-not-a-real-secret";
const NEW_SECRET = "session-rotation-test-new-key-not-a-real-secret";
const PASSCODE = "rotation-test-passcode";
const PASSWORD = "RotationTestPassword123!";
const userId = randomUUID();
const email = `rotation-${userId}@teamtest.internal`;
let server: http.Server;
let base: string;
let originalHash: string | null | undefined;
let storedHash: string;

async function login(path: string, body: Record<string, string>): Promise<string> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  const data = await response.json() as { token: string };
  assert.ok(data.token);
  return data.token;
}

describe("ProjectHub SESSION_SECRET rotation", { concurrency: false }, () => {
  before(async () => {
    // Override before importing the app; only synthetic keys are ever read.
    process.env["SESSION_SECRET"] = OLD_SECRET;
    const { default: app } = await import("../app.js");
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api`;

    await db.insert(teamUsersTable).values({
      id: userId, email, name: "Rotation test", role: "admin", isActive: true,
      passwordHash: await bcrypt.hash(PASSWORD, 4), permissions: {},
    });
    const [settings] = await db.select().from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"));
    originalHash = settings?.passcodeHash;
    storedHash = await bcrypt.hash(PASSCODE, 4);
    await db.insert(teamSettingsTable).values({ id: "singleton", passcodeHash: storedHash })
      .onConflictDoUpdate({ target: teamSettingsTable.id, set: { passcodeHash: storedHash } });
  });

  after(async () => {
    await db.delete(teamUsersTable).where(eq(teamUsersTable.id, userId));
    if (originalHash === undefined) {
      await db.delete(teamSettingsTable).where(eq(teamSettingsTable.id, "singleton"));
    } else {
      await db.update(teamSettingsTable).set({ passcodeHash: originalHash })
        .where(eq(teamSettingsTable.id, "singleton"));
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("rejects an unexpired old token across protected routes and accepts a fresh login", async () => {
    process.env["SESSION_SECRET"] = OLD_SECRET;
    const token = await login("/auth/login", { email, password: PASSWORD });
    assert.ok(verifyToken(`Bearer ${token}`));
    const routes = [
      "/auth/me", "/auth/users", "/projects", "/tasks", "/members",
      "/dashboard", "/library", "/notifications/logs",
      "/contacts", "/system/status", "/admin/monitoring",
      "/admin/payment-settings", "/whatsapp/status",
    ];
    const beforeRotation = await fetch(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(beforeRotation.status, 200);

    process.env["SESSION_SECRET"] = NEW_SECRET;
    assert.equal(verifyToken(`Bearer ${token}`), null);
    for (const path of routes) {
      const response = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 401, `${path} must reject the old signature`);
    }
    const writeResponse = await fetch(`${base}/auth/change-password`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "MustNotBeSaved123!" }),
    });
    assert.equal(writeResponse.status, 401, "a revoked session cannot mutate credentials");
    const freshToken = await login("/auth/login", { email, password: PASSWORD });
    assert.ok(verifyToken(`Bearer ${freshToken}`));
    const freshResponse = await fetch(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    assert.equal(freshResponse.status, 200);
  });

  it("preserves team_settings.passcode_hash and passcode login after rotation", async () => {
    process.env["SESSION_SECRET"] = OLD_SECRET;
    const oldToken = await login("/auth/token", { passcode: PASSCODE });
    process.env["SESSION_SECRET"] = NEW_SECRET;
    assert.equal(verifyToken(`Bearer ${oldToken}`), null);
    const [settings] = await db.select().from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"));
    assert.equal(settings?.passcodeHash, storedHash, "rotation must not rewrite the bcrypt hash");
    assert.equal(await bcrypt.compare(PASSCODE, settings!.passcodeHash!), true);
    const freshToken = await login("/auth/token", { passcode: PASSCODE });
    assert.ok(verifyToken(`Bearer ${freshToken}`));
    assert.equal(verifyToken(`Bearer ${oldToken}`), null);
  });

  it("fails closed when SESSION_SECRET is absent", () => {
    process.env["SESSION_SECRET"] = NEW_SECRET;
    const token = issueToken({ id: userId, email, type: "team-session" });
    delete process.env["SESSION_SECRET"];
    try {
      assert.equal(verifyToken(`Bearer ${token}`), null);
      assert.throws(() => issueToken({ id: userId, email }), /SESSION_SECRET is not set/);
    } finally {
      process.env["SESSION_SECRET"] = NEW_SECRET;
    }
  });
});