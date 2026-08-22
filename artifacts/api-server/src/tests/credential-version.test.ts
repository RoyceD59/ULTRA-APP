/**
 * Integration tests: credential version revokes sessions after password reset.
 *
 * A UC customer bearer token embeds a `credentialVersion` claim that matches
 * the `credential_version` column in `uc_users`. The UC deleted-account guard
 * compares them on every /uc/* request. When a password is reset, the column
 * is incremented — causing any previously-issued token (version N-1) to be
 * rejected with 401 on all subsequent requests.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
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
  process.env["SESSION_SECRET"] ??= "test-secret-for-credential-version-tests";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });

  const suffix = Date.now();
  userEmail = `cred-version-${suffix}@example.com`;

  // Insert user with credential_version = 0 (the default).
  const row = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
     VALUES ($1, 'x', 'Test', 'User', '') RETURNING id`,
    [userEmail],
  );
  userId = row.rows[0]!.id;
});

after(async () => {
  await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [String(userId)]);
  await pool.query("DELETE FROM uc_users WHERE id = $1", [userId]);
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
});

describe("credential version — session revocation after password reset", () => {
  it("a token with the correct credentialVersion (0) is accepted", async () => {
    const token = `Bearer ${issueToken({ id: userId, email: userEmail, credentialVersion: 0 })}`;
    const { status } = await apiFetch(server, "/api/uc/customer/profile", {
      headers: { authorization: token },
    });
    assert.equal(status, 200, "pre-reset token with correct version should be accepted");
  });

  it("a token with no credentialVersion claim (old-style) is also accepted (treated as 0)", async () => {
    // Tokens issued before this feature existed have no credentialVersion claim.
    const token = `Bearer ${issueToken({ id: userId, email: userEmail })}`;
    const { status } = await apiFetch(server, "/api/uc/customer/profile", {
      headers: { authorization: token },
    });
    assert.equal(status, 200, "legacy token without credentialVersion should be accepted when DB is still at 0");
  });

  it("incrementing credential_version in DB causes the old token to be rejected (401)", async () => {
    // Simulate a password reset by bumping the column directly.
    await pool.query(
      "UPDATE uc_users SET credential_version = credential_version + 1 WHERE id = $1",
      [userId],
    );

    const oldToken = `Bearer ${issueToken({ id: userId, email: userEmail, credentialVersion: 0 })}`;
    const { status, body } = await apiFetch(server, "/api/uc/customer/profile", {
      headers: { authorization: oldToken },
    });
    assert.equal(status, 401, `expected 401 for stale token, got ${status}: ${JSON.stringify(body)}`);
    assert.match(
      String((body as { error?: string })?.error ?? ""),
      /sign in|expired/i,
      "error message should prompt re-authentication",
    );
  });

  it("a new token with the updated credentialVersion (1) is accepted again", async () => {
    const newToken = `Bearer ${issueToken({ id: userId, email: userEmail, credentialVersion: 1 })}`;
    const { status } = await apiFetch(server, "/api/uc/customer/profile", {
      headers: { authorization: newToken },
    });
    assert.equal(status, 200, "new token with updated credentialVersion should be accepted");
  });

  it("a token with a future credentialVersion (too high) is also rejected", async () => {
    const futureToken = `Bearer ${issueToken({ id: userId, email: userEmail, credentialVersion: 99 })}`;
    const { status } = await apiFetch(server, "/api/uc/customer/profile", {
      headers: { authorization: futureToken },
    });
    assert.equal(status, 401, "token with mismatched (too-high) credentialVersion should be rejected");
  });

  it("WooCommerce tokens (id >= 1e9) are unaffected — no DB row to check", async () => {
    const wooId = 1_000_000_001;
    const wooToken = `Bearer ${issueToken({ id: wooId, email: "woo@example.com", src: "woo" })}`;
    // The guard skips non-DB-anchored IDs — public route must respond normally (not 401/503).
    const { status } = await apiFetch(server, "/api/uc/products", {
      headers: { authorization: wooToken },
    });
    assert.equal(status, 200, "WooCommerce token with out-of-range id should pass the guard");
  });

  it("stale token is rejected on a write route too (PATCH /uc/customer/profile)", async () => {
    // DB is at credential_version = 1; issue a token for version 0.
    const staleToken = `Bearer ${issueToken({ id: userId, email: userEmail, credentialVersion: 0 })}`;
    const { status } = await apiFetch(server, "/api/uc/customer/profile", {
      method: "PATCH",
      headers: { authorization: staleToken, "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Hacked" }),
    });
    assert.equal(status, 401, "stale token must be rejected on write routes too");
  });
});
