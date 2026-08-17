/**
 * Tests for GET /uc/admin/customers/count
 *
 * Verifies:
 *   1. 401 for unauthenticated requests (no Authorization header)
 *   2. 401 for UC-user tokens (type !== "team-session")
 *   3. Soft-deleted users (deleted_at IS NOT NULL) are excluded from the count
 *   4. Re-registering (clearing deleted_at) a user increments the count back
 *
 * Concurrency note: the full test suite runs files concurrently and several
 * files insert into uc_users.  To minimise false failures from races we keep
 * the measurement window between consecutive count reads as tight as possible:
 * ALL inserts happen in before() or at the top of the test BEFORE the first
 * count read, so the only DB call between two consecutive reads is a single
 * UPDATE.  That window is ~10-30 ms – much harder to collide with than the
 * ~150 ms window that included an INSERT.
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

// Users inserted during before() so they're available across tests.
let activeUserIds: number[]   = []; // 3 users that stay active throughout
let targetUserId: number;           // the user we will soft-delete / restore

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

  // Pre-insert all uc_users so no insertUser call sits between count reads.
  const suffix = Date.now();

  const actives = await pool.query<{ id: number }>(
    `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone)
     SELECT 'ccount-active-' || gs || '-${suffix}@test.internal', 'x', 'Count', 'Active', ''
     FROM generate_series(1,3) gs
     RETURNING id`
  );
  activeUserIds = actives.rows.map(r => r.id);
  insertedIds.push(...activeUserIds);

  // This user starts as ACTIVE; tests will soft-delete and re-activate it.
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

// ─── Helper ──────────────────────────────────────────────────────────────────

async function getCount(): Promise<number> {
  const { body } = await apiFetch(server, "/api/uc/admin/customers/count", {
    headers: { authorization: teamHeader },
  });
  return (body as { count: number }).count;
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
// All uc_users were inserted in before(), so the only DB writes between
// consecutive count reads are single UPDATE statements (~10-30 ms window).

describe("GET /uc/admin/customers/count — count accuracy", () => {
  it("excludes soft-deleted users and re-activating them restores the count", async () => {
    // All four test users are active at this point.  Read the baseline — we
    // care only about RELATIVE changes from here, not the absolute value.
    const c0 = await getCount();

    // ── Step 1: soft-delete targetUser ──────────────────────────────────────
    // Window between c0 and c1: one UPDATE + one HTTP round-trip (~30 ms).
    await pool.query(
      "UPDATE uc_users SET deleted_at = now() WHERE id = $1",
      [targetUserId]
    );
    const c1 = await getCount();
    assert.equal(
      c1,
      c0 - 1,
      `soft-delete: expected count to drop by 1 (got delta ${c1 - c0})`
    );

    // ── Step 2: clear deleted_at (re-registration) ───────────────────────────
    // Window between c1 and c2: one UPDATE + one HTTP round-trip (~30 ms).
    await pool.query(
      "UPDATE uc_users SET deleted_at = NULL WHERE id = $1",
      [targetUserId]
    );
    const c2 = await getCount();
    assert.equal(
      c2,
      c1 + 1,
      `re-registration: expected count to rise by 1 (got delta ${c2 - c1})`
    );

    // Sanity: net effect of delete-then-restore should be zero.
    assert.equal(c2, c0, "net effect of delete + restore should be zero");
  });
});
