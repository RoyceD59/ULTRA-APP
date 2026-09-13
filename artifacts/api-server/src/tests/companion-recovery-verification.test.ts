import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const teamAdminId = `recovery-admin-${suffix}`;
const teamMemberId = `recovery-member-${suffix}`;
let userId: number;

async function post(path: string, body: unknown, bearer?: string) {
  const address = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function getStatus(path: string): Promise<number> {
  const address = server.address() as { port: number };
  return (await fetch(`http://127.0.0.1:${address.port}/api${path}`)).status;
}

before(async () => {
  process.env["SESSION_SECRET"] = "companion-recovery-verification-test";
  await pool.query(`
    ALTER TABLE uc_users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
    ALTER TABLE uc_users ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS uc_password_reset_audit (
      id text PRIMARY KEY, actor_type text NOT NULL, actor_id text, target_user_id text,
      channel text, result text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS uc_contact_verification_tokens (
      id text PRIMARY KEY, user_id text NOT NULL, channel text NOT NULL,
      contact_hash text NOT NULL, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
      used_at timestamptz, verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const user = await pool.query<{ id: number }>(
    `INSERT INTO uc_users
       (email, phone, password_hash, first_name, last_name, email_verified, phone_verified)
     VALUES ($1, $2, 'x', 'Recovery', 'Test', false, false) RETURNING id`,
    [`recovery-${suffix}@example.com`, `+254700${String(Date.now()).slice(-6)}`],
  );
  userId = user.rows[0]!.id;
  await pool.query(
    `INSERT INTO team_users (id, email, name, password_hash, role, is_active, permissions)
     VALUES ($1,$2,'Admin','x','admin',true,'{}'), ($3,$4,'Member','x','member',true,'{}')`,
    [teamAdminId, `admin-${suffix}@example.com`, teamMemberId, `member-${suffix}@example.com`],
  );
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
});

after(async () => {
  await pool.query("DELETE FROM uc_password_reset_audit WHERE target_user_id = $1 OR actor_id IN ($2,$3)", [String(userId), teamAdminId, teamMemberId]);
  await pool.query("DELETE FROM uc_contact_verification_tokens WHERE user_id = $1", [String(userId)]);
  await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [String(userId)]);
  await pool.query("DELETE FROM team_users WHERE id IN ($1,$2)", [teamAdminId, teamMemberId]);
  await pool.query("DELETE FROM uc_users WHERE id = $1", [userId]);
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});

describe("Companion verified recovery channels", () => {
  it("does not issue for an unverified contact and keeps the generic response", async () => {
    const response = await post("/uc/auth/forgot-password", { identifier: `recovery-${suffix}@example.com`, channel: "email" });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });
    const rows = await pool.query("SELECT 1 FROM password_reset_tokens WHERE user_id = $1", [String(userId)]);
    assert.equal(rows.rowCount, 0);
  });

  it("issues for verified email and WhatsApp and invalidates the older reset", async () => {
    await pool.query("UPDATE uc_users SET email_verified=true WHERE id=$1", [userId]);
    await post("/uc/auth/forgot-password", { identifier: `recovery-${suffix}@example.com`, channel: "email" });
    const first = await pool.query<{ id: string }>(
      "SELECT id FROM password_reset_tokens WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [String(userId)],
    );
    assert.ok(first.rows[0]);
    await pool.query("UPDATE uc_users SET phone_verified=true WHERE id=$1", [userId]);
    const phone = await pool.query<{ phone: string }>("SELECT phone FROM uc_users WHERE id=$1", [userId]);
    const response = await post("/uc/auth/forgot-password", { identifier: phone.rows[0]!.phone, channel: "whatsapp" });
    assert.deepEqual(response.body, { ok: true });
    const old = await pool.query<{ used_at: Date | null }>("SELECT used_at FROM password_reset_tokens WHERE id=$1", [first.rows[0]!.id]);
    assert.ok(old.rows[0]!.used_at, "new issue must invalidate the prior link");
  });

  it("requires durable admin permission and returns/audits no secret", async () => {
    const denied = issueToken({ id: teamMemberId, email: `member-${suffix}@example.com`, type: "team-session", role: "admin" });
    assert.equal((await post(`/uc/admin/users/${userId}/reset-password`, { channel: "email" }, denied)).status, 403);

    const admin = issueToken({ id: teamAdminId, email: `admin-${suffix}@example.com`, type: "team-session", role: "admin" });
    const accepted = await post(`/uc/admin/users/${userId}/reset-password`, { channel: "email" }, admin);
    assert.equal(accepted.status, 202);
    assert.deepEqual(accepted.body, { ok: true });
    assert.doesNotMatch(JSON.stringify(accepted.body), /token|password|url|@|\\+254/i);
    const audit = await pool.query<{ actor_id: string; target_user_id: string; channel: string; result: string }>(
      "SELECT actor_id,target_user_id,channel,result FROM uc_password_reset_audit WHERE actor_id=$1 ORDER BY created_at DESC LIMIT 1",
      [teamAdminId],
    );
    assert.equal(audit.rows[0]?.target_user_id, String(userId));
    assert.equal(audit.rows[0]?.channel, "email");
  });

  it("contact verification credentials expire and are single-use", async () => {
    const raw = crypto.randomUUID();
    const hash = createHash("sha256").update(raw).digest("hex");
    const contactHash = createHash("sha256").update(`recovery-${suffix}@example.com`).digest("hex");
    await pool.query(
      `INSERT INTO uc_contact_verification_tokens
         (id,user_id,channel,contact_hash,token_hash,expires_at)
       VALUES ($1,$2,'email',$3,$4,now() + interval '5 minutes')`,
      [crypto.randomUUID(), String(userId), contactHash, hash],
    );
    assert.equal(await getStatus(`/uc/auth/verify-contact?token=${encodeURIComponent(raw)}`), 200);
    assert.equal(await getStatus(`/uc/auth/verify-contact?token=${encodeURIComponent(raw)}`), 400);

    const expiredRaw = crypto.randomUUID();
    await pool.query(
      `INSERT INTO uc_contact_verification_tokens
         (id,user_id,channel,contact_hash,token_hash,expires_at)
       VALUES ($1,$2,'email',$3,$4,now() - interval '1 second')`,
      [crypto.randomUUID(), String(userId), contactHash, createHash("sha256").update(expiredRaw).digest("hex")],
    );
    assert.equal(await getStatus(`/uc/auth/verify-contact?token=${encodeURIComponent(expiredRaw)}`), 400);
  });
});