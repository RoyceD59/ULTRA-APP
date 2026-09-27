import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcryptjs from "bcryptjs";
import { createHash } from "node:crypto";
import http from "node:http";
import { db, passwordResetTokensTable, pool, teamUsersTable, ucUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
let userId: number;
let adminId: string;
let resendStub: http.Server;
let savedResendBaseUrl: string | undefined;
let holdResend = false;
let resendReachedResolve: (() => void) | undefined;
let releaseResend: (() => void) | undefined;
const suffix = `${Date.now()}-${process.pid}`;
const email = `temporary-password-${suffix}@example.com`;
const temporaryPassword = "operator-issued-test-password";

before(async () => {
  process.env["SESSION_SECRET"] = "temporary-password-test-secret";
  const passwordHash = await bcryptjs.hash(temporaryPassword, 10);
  const [user] = await db.insert(ucUsersTable).values({
    email,
    passwordHash,
    firstName: "Temporary",
    lastName: "Password",
    emailVerified: true,
    authProvider: "password",
    mustChangePassword: true,
    temporaryPasswordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).returning({ id: ucUsersTable.id });
  userId = user!.id;
  adminId = `temporary-admin-${suffix}`;
  await db.insert(teamUsersTable).values({
    id: adminId,
    email: `temporary-admin-${suffix}@example.com`,
    name: "Temporary Password Admin",
    passwordHash: await bcryptjs.hash("admin-password", 4),
    role: "admin",
    isActive: true,
  });
  savedResendBaseUrl = process.env["RESEND_BASE_URL"];
  resendStub = http.createServer(async (_req, res) => {
    const succeeds = holdResend;
    if (succeeds) {
      resendReachedResolve?.();
      await new Promise<void>((resolve) => { releaseResend = resolve; });
    }
    res.statusCode = succeeds ? 200 : 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(succeeds ? { id: "temporary-password-test-delivery" } : { name: "test_delivery_failure" }));
  });
  await new Promise<void>((resolve, reject) => {
    resendStub.listen(0, "127.0.0.1", (err?: Error) => err ? reject(err) : resolve());
  });
  const resendPort = (resendStub.address() as { port: number }).port;
  process.env["RESEND_BASE_URL"] = `http://127.0.0.1:${resendPort}`;
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => err ? reject(err) : resolve());
  });
});

after(async () => {
  if (savedResendBaseUrl === undefined) delete process.env["RESEND_BASE_URL"];
  else process.env["RESEND_BASE_URL"] = savedResendBaseUrl;
  await new Promise<void>((resolve, reject) => resendStub.close((err) => err ? reject(err) : resolve()));
  await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, String(userId)));
  await db.delete(teamUsersTable).where(eq(teamUsersTable.email, `temporary-admin-${suffix}@example.com`));
  await db.delete(ucUsersTable).where(eq(ucUsersTable.id, userId));
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});

async function request(path: string, init: RequestInit = {}) {
  const address = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, init);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe("Companion temporary passwords", () => {
  it("limits a temporary session to the permanent-password change route", async () => {
    const login = await request("/uc/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: temporaryPassword }),
    });
    assert.equal(login.status, 200);
    const token = String(login.body["token"]);
    assert.equal((login.body["user"] as Record<string, unknown>)["mustChangePassword"], true);

    const blocked = await request("/uc/customer/profile", {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body["code"], "PASSWORD_CHANGE_REQUIRED");

    const changed = await request("/uc/auth/change-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: "permanent-test-password" }),
    });
    assert.equal(changed.status, 200);
    assert.equal((changed.body["user"] as Record<string, unknown>)["mustChangePassword"], false);

    const oldSession = await request("/uc/customer/profile", {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(oldSession.status, 401, "credential version must invalidate the temporary session");
    const permanentLogin = await request("/uc/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "permanent-test-password" }),
    });
    assert.equal(permanentLogin.status, 200);
    assert.equal((permanentLogin.body["user"] as Record<string, unknown>)["mustChangePassword"], false);
  });

  it("does not persist the plaintext temporary credential", async () => {
    const row = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM uc_users WHERE id = $1",
      [userId],
    );
    assert.ok(row.rows[0]);
    assert.notEqual(row.rows[0]!.password_hash, temporaryPassword);
  });

  it("does not consume an active reset link when temporary-password delivery fails", async () => {
    const resetToken = `temporary-password-reset-${suffix}`;
    const [tokenRow] = await db.insert(passwordResetTokensTable).values({
      userId: String(userId),
      token: resetToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).returning({ id: passwordResetTokensTable.id });
    assert.ok(tokenRow);

    const actorToken = issueToken({
      id: adminId,
      email: `temporary-admin-${suffix}@example.com`,
      type: "team-session",
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const response = await request(`/uc/admin/users/${userId}/temporary-password`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${actorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel: "email" }),
    });
    assert.equal(response.status, 502);

    const [remaining] = await db.select({ usedAt: passwordResetTokensTable.usedAt })
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.id, tokenRow!.id));
    assert.ok(remaining, "the reset link row should still exist");
    assert.equal(remaining!.usedAt, null, "delivery failure must preserve the active reset link");
  });

  it("serializes reset-link mutation behind in-flight temporary-password delivery", async () => {
    const rawToken = `temporary-password-concurrency-${suffix}`;
    await db.insert(passwordResetTokensTable).values({
      userId: String(userId),
      token: createHash("sha256").update(rawToken).digest("hex"),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const actorToken = issueToken({
      id: adminId,
      email: `temporary-admin-${suffix}@example.com`,
      type: "team-session",
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    let deliveryReached!: Promise<void>;
    deliveryReached = new Promise<void>((resolve) => { resendReachedResolve = resolve; });
    holdResend = true;
    const issueRequest = request(`/uc/admin/users/${userId}/temporary-password`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${actorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel: "email" }),
    });
    await deliveryReached;

    let resetFinished = false;
    const resetRequest = request("/uc/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: rawToken, newPassword: "reset-password-wins" }),
    }).then((response) => {
      resetFinished = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(resetFinished, false, "reset must wait while delivery owns the per-user lock");

    holdResend = false;
    releaseResend?.();
    const [issued, reset] = await Promise.all([issueRequest, resetRequest]);
    assert.equal(issued.status, 200);
    assert.equal(reset.status, 400, "successful delivery must consume the reset link before reset can claim it");
  });
});