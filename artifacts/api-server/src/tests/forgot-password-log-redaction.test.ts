/**
 * Security test: password-reset emails must not persist the reset token or
 * reset URL in uc_notification_log.
 *
 * A reset URL contains a live, single-use token. Storing it in the
 * notification log gives anyone with DB/log access a direct path to take over
 * a customer's account before they use the link. This test verifies that
 * POST /uc/auth/forgot-password logs only redacted delivery metadata.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pool } from "@workspace/db";

async function apiFetch(
  server: http.Server,
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, options);
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

let server: http.Server;
let userId: number;
let userEmail: string;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-log-redaction-tests";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });

  const suffix = Date.now();
  userEmail = `log-redact-${suffix}@example.com`;
  const row = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
     VALUES ($1, 'x', 'Redact', 'Test', '') RETURNING id`,
    [userEmail],
  );
  userId = row.rows[0]!.id;
});

after(async () => {
  await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [String(userId)]);
  await pool.query("DELETE FROM uc_notification_log WHERE recipient = $1", [userEmail]);
  await pool.query("DELETE FROM uc_users WHERE id = $1", [userId]);
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
});

describe("forgot-password: reset token must not be stored in notification log", () => {
  it("POST /uc/auth/forgot-password always returns 200 (anti-enumeration)", async () => {
    const { status, body } = await apiFetch(server, "/api/uc/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: userEmail }),
    });
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.equal((body as { ok?: boolean }).ok, true);
  });

  it("returns 200 (ok: true) even for an email not in the database", async () => {
    const { status, body } = await apiFetch(server, "/api/uc/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@notexist.example.com" }),
    });
    assert.equal(status, 200);
    assert.equal((body as { ok?: boolean }).ok, true);
  });

  it("no reset token or reset URL appears in uc_notification_log message_body", async () => {
    // If Resend delivery failed silently (no RESEND_API_KEY in test), the log
    // row may still exist with a "failed" status — the body must still be clean.
    const logRows = await pool.query<{ message_body: string }>(
      "SELECT message_body FROM uc_notification_log WHERE recipient = $1 ORDER BY sent_at DESC LIMIT 5",
      [userEmail],
    );

    for (const row of logRows.rows) {
      const body = row.message_body ?? "";
      // Must not contain any UUID-shaped raw token.
      assert.doesNotMatch(
        body,
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        `notification log must not store a UUID token, but found one in: "${body}"`,
      );
      // Must not contain the reset-password URL path.
      assert.doesNotMatch(
        body,
        /\/uc\/auth\/reset-password/i,
        `notification log must not store the reset URL path, but found it in: "${body}"`,
      );
    }
  });

  it("password_reset_tokens table stores only a SHA-256 hash, not the raw token UUID", async () => {
    const tokenRow = await pool.query<{ token: string }>(
      "SELECT token FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [String(userId)],
    );
    assert.ok(tokenRow.rows[0]?.token, "a reset token row must exist after forgot-password call");
    const stored = tokenRow.rows[0]!.token;
    // A SHA-256 hex digest is 64 hex characters; a raw UUID is 36 characters with dashes.
    assert.match(stored, /^[0-9a-f]{64}$/, `stored token must be a 64-char hex SHA-256 hash, got: "${stored}"`);
    // Must not be a raw UUID.
    assert.doesNotMatch(stored, /^[0-9a-f-]{36}$/, "stored token must not be a raw UUID");
  });

  it("returns 400 when no email is supplied", async () => {
    const { status } = await apiFetch(server, "/api/uc/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(status, 400);
  });
});
