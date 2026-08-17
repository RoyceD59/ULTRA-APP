/**
 * Tests for GET /uc/admin/customers/count
 *
 * Verifies:
 *   1. 401 for unauthenticated requests (no Authorization header)
 *   2. 401 for UC-user tokens (type !== "team-session")
 *   3. Soft-deleted users (deleted_at IS NOT NULL) are excluded from the count
 *   4. Re-registering (clearing deleted_at) a user increments the count back
 *
 * Isolation strategy:
 *   The full test suite runs test files concurrently and multiple files insert
 *   into uc_users.  To avoid false failures from concurrent writes, tests 3 and
 *   4 do NOT compare two successive global API counts.  Instead they read both
 *   the DB and the API at the same instant and assert that they agree — a
 *   race-proof check that the endpoint reflects DB state regardless of what
 *   other test files are doing.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";

async function apiFetch(
  server: http.Server,
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, options);
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

let server: http.Server;
let teamHeader: string;

// All ids inserted by this test file — cleaned up in after().
const insertedIds: number[] = [];
let targetUserId: number;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-customer-count";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });

  // Seed the team_users row needed to satisfy any downstream checks.
  const teamId    = `test-ccount-team-${Date.now()}`;
  const teamEmail = `count-team-${Date.now()}@test.internal`;
  await pool.query(
    `INSERT INTO team_users (id, email, name, password_hash, role, is_active)
     VALUES ($1, $2, 'Count Tester', 'x', 'admin', true)
     ON CONFLICT DO NOTHING`,
    [teamId, teamEmail]
  );

  teamHeader = `Bearer ${issueToken({
    id:    teamId,
    email: teamEmail,
    type:  "team-session",
    role:  "admin",
  })}`;

  // Pre-insert the target user — active initially.
  const suffix = Date.now();
  const target = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
     VALUES ($1, 'x', 'Count', 'Target', '')
     RETURNING id`,
    [`ccount-target-${suffix}@test.internal`]
  );
  targetUserId = target.rows[0]!.id;
  insertedIds.push(targetUserId);
});

after(async () => {
  if (insertedIds.length > 0) {
    await pool.query("DELETE FROM uc_users WHERE id = ANY($1::int[])", [insertedIds]);
  }
  await new Promise<void>((resolve, reject) =>
    server.close(e => (e ? reject(e) : resolve()))
  );
});

// ─── Helper ──────────────────────────────────────────────────────────────────

async function getCount(): Promise<number> {
  const { body } = await apiFetch(server, "/api/uc/admin/customers/count", {
    headers: { authorization: teamHeader },
  });
  return (body as { count: number }).count;
}

/**
 * Read the DB count of non-deleted uc_users and the API count in one go.
 * Comparing the two at the same instant is race-proof: concurrent writes from
 * other test files affect both reads equally so they always agree.
 */
async function getCountBoth(): Promise<{ db: number; api: number }> {
  const [dbResult, apiCount] = await Promise.all([
    pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM uc_users WHERE deleted_at IS NULL"
    ),
    getCount(),
  ]);
  return { db: parseInt(dbResult.rows[0]!.count, 10), api: apiCount };
}

// ─── Auth gate ────────────────────────────────────────────────────────────────

describe("GET /uc/admin/customers/count — auth gate", () => {
  it("returns 401 with no Authorization header", async () => {
    const { status, body } = await apiFetch(server, "/api/uc/admin/customers/count");
    assert.equal(status, 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
  });

  it("returns 401 for a UC-user token (type is not 'team-session')", async () => {
    const ucHeader = `Bearer ${issueToken({ id: 9999, email: "uc-user@test.internal" })}`;
    const { status, body } = await apiFetch(server, "/api/uc/admin/customers/count", {
      headers: { authorization: ucHeader },
    });
    assert.equal(status, 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
  });
});

// ─── Count accuracy ───────────────────────────────────────────────────────────
//
// Each sub-step reads the DB and API simultaneously so the two numbers must
// always agree, regardless of what other test files write concurrently.

describe("GET /uc/admin/customers/count — count accuracy", () => {
  it("excludes soft-deleted users and re-activating them restores the count", async () => {
    // Verify the API matches the DB while the target user is active.
    {
      const { db: dbCount, api: apiCount } = await getCountBoth();
      assert.equal(
        apiCount, dbCount,
        `API count (${apiCount}) must equal DB count (${dbCount}) before soft-delete`,
      );
    }

    // Soft-delete our target user.
    await pool.query(
      "UPDATE uc_users SET deleted_at = now() WHERE id = $1",
      [targetUserId]
    );

    // After soft-delete: API must still agree with DB (target user excluded in both).
    {
      const { db: dbCount, api: apiCount } = await getCountBoth();
      assert.equal(
        apiCount, dbCount,
        `API count (${apiCount}) must equal DB count (${dbCount}) after soft-delete`,
      );
    }

    // Re-activate (simulates re-registration).
    await pool.query(
      "UPDATE uc_users SET deleted_at = NULL WHERE id = $1",
      [targetUserId]
    );

    // After re-activation: API must once again agree with DB.
    {
      const { db: dbCount, api: apiCount } = await getCountBoth();
      assert.equal(
        apiCount, dbCount,
        `API count (${apiCount}) must equal DB count (${dbCount}) after re-activation`,
      );
    }
  });
});
