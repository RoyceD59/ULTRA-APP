import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcryptjs from "bcryptjs";
import http from "node:http";
import { db, pool, teamUsersTable, ucUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let server: http.Server;
let userId: number;
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
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => err ? reject(err) : resolve());
  });
});

after(async () => {
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
});