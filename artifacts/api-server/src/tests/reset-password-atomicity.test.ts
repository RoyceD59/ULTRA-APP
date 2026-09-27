/**
 * Atomicity test: concurrent password-reset requests with the same token.
 *
 * Each reset token is single-use. Two simultaneous POST /uc/auth/reset-password
 * calls using the same token must result in exactly one success (200 ok: true)
 * and one rejection (400). The credential_version in uc_users must be
 * incremented exactly once regardless of concurrency.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import bcryptjs from "bcryptjs";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

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
let consumedToken: string;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-atomicity-tests";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });

  const suffix = Date.now();
  userEmail = `atomic-reset-${suffix}@example.com`;
  const row = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
     VALUES ($1, 'x', 'Atomic', 'Test', '') RETURNING id`,
    [userEmail],
  );
  userId = row.rows[0]!.id;
});

after(async () => {
  await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [String(userId)]);
  await pool.query("DELETE FROM uc_users WHERE id = $1", [userId]);
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
});

/** Insert a fresh reset token directly.
 *  Stores the SHA-256 hash (mirroring production behaviour); returns the raw
 *  token for use in API calls.
 *  Must supply `id` explicitly because the column uses a Drizzle $defaultFn
 *  (application-side UUID generation) rather than a DB-level default.
 */
async function insertResetToken(
  uid: number,
  expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000),
): Promise<string> {
  const id       = crypto.randomUUID();
  const rawToken = crypto.randomUUID();
  await pool.query(
    `INSERT INTO password_reset_tokens (id, user_id, token, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [id, String(uid), hashToken(rawToken), expiresAt],
  );
  return rawToken;
}

describe("reset-password atomicity — single-use token enforcement", () => {
  it("exactly one concurrent request succeeds; the other is rejected (400)", async () => {
    const token = await insertResetToken(userId);
    consumedToken = token;

    // Fire two simultaneous reset requests with the same token.
    const [r1, r2] = await Promise.all([
      apiFetch(server, "/api/uc/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: "newpass1" }),
      }),
      apiFetch(server, "/api/uc/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: "newpass2" }),
      }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(
      statuses,
      [200, 400],
      `expected exactly one 200 and one 400, got ${statuses.join(", ")}`,
    );

    const successBody = r1.status === 200 ? r1.body : r2.body;
    assert.equal(
      (successBody as { ok?: boolean }).ok,
      true,
      "the successful response must carry ok: true",
    );

    const passwordRow = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM uc_users WHERE id = $1",
      [userId],
    );
    const [firstPasswordMatches, secondPasswordMatches] = await Promise.all([
      bcryptjs.compare("newpass1", passwordRow.rows[0]!.password_hash),
      bcryptjs.compare("newpass2", passwordRow.rows[0]!.password_hash),
    ]);
    assert.equal(
      firstPasswordMatches || secondPasswordMatches,
      true,
      "the winning reset must update the stored password hash",
    );
  });

  it("credential_version is incremented exactly once after the concurrent reset", async () => {
    const row = await pool.query<{ credential_version: number }>(
      "SELECT credential_version FROM uc_users WHERE id = $1",
      [userId],
    );
    const version = row.rows[0]!.credential_version;
    // Started at 0, exactly one reset succeeded → must be 1.
    assert.equal(version, 1, `credential_version should be 1, got ${version}`);
  });

  it("the same raw token cannot be reused after a successful reset (400)", async () => {
    const { status, body } = await apiFetch(server, "/api/uc/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: consumedToken, newPassword: "anotherPass" }),
    });
    assert.equal(status, 400, "unknown/replayed token must be rejected");
    assert.deepEqual(
      body,
      { error: "Invalid or expired reset link. Please request a new one." },
      "replayed links must return the same safe error as other invalid links",
    );
  });

  it("an expired token returns a safe error and does not change credentials", async () => {
    const before = await pool.query<{ password_hash: string; credential_version: number }>(
      "SELECT password_hash, credential_version FROM uc_users WHERE id = $1",
      [userId],
    );
    const expiredToken = await insertResetToken(userId, new Date(Date.now() - 1_000));

    const { status, body } = await apiFetch(server, "/api/uc/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: expiredToken, newPassword: "expiredPass1" }),
    });

    assert.equal(status, 400);
    assert.deepEqual(
      body,
      { error: "Invalid or expired reset link. Please request a new one." },
    );

    const after = await pool.query<{ password_hash: string; credential_version: number }>(
      "SELECT password_hash, credential_version FROM uc_users WHERE id = $1",
      [userId],
    );
    assert.equal(after.rows[0]!.password_hash, before.rows[0]!.password_hash);
    assert.equal(after.rows[0]!.credential_version, before.rows[0]!.credential_version);
  });

  it("a fresh token for the same user works correctly after a prior reset", async () => {
    const token2 = await insertResetToken(userId);
    const { status, body } = await apiFetch(server, "/api/uc/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token2, newPassword: "freshpass1" }),
    });
    assert.equal(status, 200, `expected 200 with new token, got ${status}: ${JSON.stringify(body)}`);
    assert.equal((body as { ok?: boolean }).ok, true);

    // credential_version should now be 2.
    const row = await pool.query<{ credential_version: number }>(
      "SELECT credential_version FROM uc_users WHERE id = $1",
      [userId],
    );
    assert.equal(row.rows[0]!.credential_version, 2, "credential_version should be 2 after second reset");
  });
});
