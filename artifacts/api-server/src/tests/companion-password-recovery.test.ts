import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";

let api: http.Server;
let resend: http.Server;
let userId: number;
let deliveryStatus = 200;
const emails: Array<{ text: string; html: string }> = [];
const email = `password-recovery-${crypto.randomUUID()}@example.test`;

async function post(path: string, body: unknown) {
  const { port } = api.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}/api/uc/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function latestToken() {
  const match = emails.at(-1)?.text.match(/resetToken=([^\s]+)/);
  assert.ok(match, "email must contain a Companion reset deep link");
  return decodeURIComponent(match[1]!);
}

before(async () => {
  process.env["SESSION_SECRET"] ??= "password-recovery-test";
  // Never send recovery emails to a real provider in this test.
  resend = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      emails.push(JSON.parse(body));
      res.writeHead(deliveryStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(deliveryStatus === 200 ? { id: "reset-test" } : { message: "Unavailable" }));
    });
  });
  await new Promise<void>(resolve => resend.listen(0, "127.0.0.1", resolve));
  process.env["RESEND_BASE_URL"] = `http://127.0.0.1:${(resend.address() as { port: number }).port}`;
  process.env["RESEND_API_KEY"] = "test-only";
  process.env["UC_RESET_BASE_URL"] = "https://recovery.example.test/api";
  const { default: app } = await import("../app.js");
  await new Promise<void>(resolve => { api = app.listen(0, "127.0.0.1", resolve); });
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone, email_verified)
     VALUES ($1, $2, 'Recovery', 'Test', '', true) RETURNING id`,
    [email, await bcrypt.hash("original-password", 10)],
  );
  userId = inserted.rows[0]!.id;
});

after(async () => {
  await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [String(userId)]);
  await pool.query("DELETE FROM uc_password_reset_audit WHERE target_user_id = $1", [String(userId)]);
  await pool.query("DELETE FROM uc_notification_log WHERE recipient = $1", [email]);
  await pool.query("DELETE FROM uc_users WHERE id = $1", [userId]);
  await Promise.all([api, resend].map(server => new Promise<void>((resolve, reject) =>
    server.close(err => err ? reject(err) : resolve()))));
});

describe("Companion password recovery", () => {
  it("emails a one-hour, hashed reset token and serves its web form", async () => {
    assert.deepEqual(await post("reset-request", { email, channel: "email" }), {
      status: 200, body: { ok: true },
    });
    const token = latestToken();
    const result = await pool.query<{ token: string; expires_at: Date; created_at: Date }>(
      "SELECT token, expires_at, created_at FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL",
      [String(userId)],
    );
    assert.equal(result.rows.length, 1);
    const row = result.rows[0]!;
    assert.equal(row.token, createHash("sha256").update(token).digest("hex"));
    const lifetime = row.expires_at.getTime() - row.created_at.getTime();
    assert.ok(lifetime > 3_590_000 && lifetime <= 3_600_000, `expected one hour, got ${lifetime}ms`);
    assert.match(emails.at(-1)!.text, /valid for 1 hour/);
    assert.match(emails.at(-1)!.html, /valid for 1 hour/);
    const { port } = api.address() as { port: number };
    const page = await fetch(`http://127.0.0.1:${port}/api/uc/auth/reset-password?token=${token}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Set a new password/);
  });

  it("stores the new bcrypt password and rejects reuse through either endpoint", async () => {
    const token = latestToken();
    assert.equal((await post("reset-confirm", { token, newPassword: "replacement-password" })).status, 200);
    const result = await pool.query<{ password_hash: string }>("SELECT password_hash FROM uc_users WHERE id = $1", [userId]);
    assert.equal(await bcrypt.compare("replacement-password", result.rows[0]!.password_hash), true);
    assert.equal(await bcrypt.compare("original-password", result.rows[0]!.password_hash), false);
    for (const path of ["reset-confirm", "reset-password"]) {
      assert.equal((await post(path, { token, newPassword: "replayed-password" })).status, 400);
    }
  });

  it("supersedes old links and rejects expired links without changing the password", async () => {
    await post("reset-request", { email, channel: "email" });
    const superseded = latestToken();
    await post("reset-request", { email, channel: "email" });
    const expired = latestToken();
    assert.equal((await post("reset-confirm", { token: superseded, newPassword: "superseded-password" })).status, 400);
    await pool.query(
      "UPDATE password_reset_tokens SET expires_at = now() - interval '1 second' WHERE token = $1",
      [createHash("sha256").update(expired).digest("hex")],
    );
    assert.equal((await post("reset-confirm", { token: expired, newPassword: "expired-password" })).status, 400);
    const result = await pool.query<{ password_hash: string }>("SELECT password_hash FROM uc_users WHERE id = $1", [userId]);
    assert.equal(await bcrypt.compare("replacement-password", result.rows[0]!.password_hash), true);
  });

  it("does not reveal unknown accounts or provider failures", async () => {
    const count = emails.length;
    const unknown = await post("reset-request", { email: "missing-account@example.test", channel: "email" });
    assert.equal(emails.length, count);
    deliveryStatus = 503;
    const failed = await post("reset-request", { email, channel: "email" });
    assert.deepEqual(failed, unknown);
    assert.deepEqual(failed, { status: 200, body: { ok: true } });
  });
});