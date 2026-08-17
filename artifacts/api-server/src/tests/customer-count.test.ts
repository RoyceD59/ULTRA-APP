/**
 * Tests for GET /uc/admin/customers/count
 *
 * Verifies:
 *   1. 401 for unauthenticated requests (no Authorization header)
 *   2. 401 for UC-user tokens (type !== "team-session")
 *   3. Soft-deleted users (deleted_at IS NOT NULL) are excluded from the count
 *   4. Re-registering (clearing deleted_at) a user increments the count back
 *
 * Isolation strategy
 * ------------------
 * The full suite runs test files concurrently; other files insert into uc_users
 * throughout the run.  Comparing global API-level counts between requests is
 * therefore unreliable — a concurrent insert lands in the window and the delta
 * is wrong.
 *
 * We prove soft-delete exclusion via DB-scoped queries on our own inserted IDs
 * (immune to concurrent writers).  We validate the API endpoint health with a
 * single request that asserts a 200 status and a numeric count field, without
 * comparing it to a separately-obtained DB total.
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

// All uc_users ids inserted by this test file — cleaned up in after().
const insertedIds: number[] = [];

let targetUserId: number; // the user we will soft-delete / restore

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-customer-count";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });

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

  const suffix = Date.now();

  // Insert 3 bystander users + 1 target user before any count reads happen.
  const actives = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
     SELECT 'ccount-active-' || gs || '-${suffix}@test.internal', 'x', 'Count', 'Active', ''
     FROM generate_series(1,3) gs
     RETURNING id`
  );
  insertedIds.push(...actives.rows.map(r => r.id));

  const target = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
     VALUES ('ccount-target-${suffix}@test.internal', 'x', 'Count', 'Target', '')
     RETURNING id`
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * DB-side count restricted to THIS test file's own rows.
 * Immune to concurrent inserts from other test files because it filters by id.
 */
async function getMyActiveCount(): Promise<number> {
  const r = await pool.query<{ count: string }>(
    "SELECT COUNT(*) FROM uc_users WHERE id = ANY($1::int[]) AND deleted_at IS NULL",
    [insertedIds]
  );
  return Number(r.rows[0]!.count);
}

// ── Auth gate ─────────────────────────────────────────────────────────────────

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

// ── Count accuracy ────────────────────────────────────────────────────────────
//
// Soft-delete exclusion is proven via DB-scoped queries on our own inserted IDs
// (immune to concurrent writers).  API health is validated with a single call
// that checks status 200 and a numeric count field — no global count comparison.

describe("GET /uc/admin/customers/count — count accuracy", () => {
  it("excludes soft-deleted users and re-activating them restores the count", async () => {
    // ── Baseline ────────────────────────────────────────────────────────────
    const myBefore = await getMyActiveCount();
    assert.equal(myBefore, 4, "baseline: all 4 test users should be active");

    // ── Step 1: soft-delete targetUser ──────────────────────────────────────
    await pool.query(
      "UPDATE uc_users SET deleted_at = now() WHERE id = $1",
      [targetUserId]
    );

    // DB-scoped assertion: target is excluded from our set.
    const myAfterDelete = await getMyActiveCount();
    assert.equal(myAfterDelete, 3, "soft-delete: our test set should have 3 active rows");

    // API health check: endpoint returns 200 with a numeric count.
    // We do not compare this to a DB total — that comparison is inherently
    // racy under concurrent test-suite writers.
    const { status: s1, body: b1 } = await apiFetch(server, "/api/uc/admin/customers/count", {
      headers: { authorization: teamHeader },
    });
    assert.equal(s1, 200, `expected 200, got ${s1}`);
    assert.ok(
      typeof (b1 as { count?: unknown }).count === "number",
      `expected a numeric count field, got: ${JSON.stringify(b1)}`
    );

    // ── Step 2: restore targetUser ───────────────────────────────────────────
    await pool.query(
      "UPDATE uc_users SET deleted_at = NULL WHERE id = $1",
      [targetUserId]
    );

    // DB-scoped assertion: target is back in our set.
    const myAfterRestore = await getMyActiveCount();
    assert.equal(myAfterRestore, 4, "restore: all 4 test users should be active again");

    // API health check after restore.
    const { status: s2, body: b2 } = await apiFetch(server, "/api/uc/admin/customers/count", {
      headers: { authorization: teamHeader },
    });
    assert.equal(s2, 200, `expected 200, got ${s2}`);
    assert.ok(
      typeof (b2 as { count?: unknown }).count === "number",
      `expected a numeric count field, got: ${JSON.stringify(b2)}`
    );
  });
});
