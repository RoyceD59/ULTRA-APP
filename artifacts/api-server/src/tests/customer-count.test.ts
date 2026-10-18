/**
 * Tests for GET /uc/admin/customers/count
 *
 * Verifies:
 *   1. 401 for unauthenticated requests (no Authorization header)
 *   2. 401 for UC-user tokens (type !== "team-session")
 *   3. Soft-deleted users (deleted_at IS NOT NULL) are excluded from the count
 *   4. Re-registering (clearing deleted_at) a user increments the count back
 *   5. The active-customer partial index exists and serves the endpoint query
 *   6. Weekly and monthly sub-counts classify rows on both sides of each boundary
 *   7. Nairobi midnight resets are independent of PostgreSQL's session timezone
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
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { CUSTOMER_STATISTICS_QUERY } from "../lib/customer-statistics.js";

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

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
  it("serves numeric counters from the summary path without changing the response", async () => {
    const realQuery = pool.query.bind(pool);
    let expected: { count: number; newThisWeek: number; newThisMonth: number } | undefined;
    const queryMock = mock.method(pool, "query", async (queryText: string, values?: unknown[]) => {
      if (queryText === CUSTOMER_STATISTICS_QUERY) {
        const result = await realQuery(queryText, [0]);
        const row = result.rows[0];
        expected = {
          count: Number(row.count), newThisWeek: Number(row.new_this_week),
          newThisMonth: Number(row.new_this_month),
        };
        return result;
      }
      return realQuery(queryText, values);
    });
    try {
      const { status, body } = await apiFetch(server, "/api/uc/admin/customers/count", {
        headers: { authorization: teamHeader },
      });
      assert.equal(status, 200);
      assert.ok(expected, "endpoint should execute the shared summary query");
      assert.deepEqual(body, expected);
      for (const value of Object.values(expected)) assert.equal(typeof value, "number");
    } finally { queryMock.mock.restore(); }
  });

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

  it("resets weekly and monthly counts at their boundaries and excludes deleted users", async () => {
    type CountBody = { count: number; newThisWeek: number; newThisMonth: number };
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const seeded = await pool.query<{
      id: number;
      created_at: Date;
      deleted_at: Date | null;
      week_start: Date;
      month_start: Date;
    }>(
      `WITH boundaries AS (
         SELECT
           date_trunc('week', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi' AS week_start,
           date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi' AS month_start
       ),
       seed(email, created_at, deleted_at) AS (
         SELECT 'ccount-week-before-${suffix}@test.internal', week_start - interval '1 millisecond', NULL::timestamptz FROM boundaries
         UNION ALL
         SELECT 'ccount-week-after-${suffix}@test.internal', week_start + interval '1 millisecond', NULL::timestamptz FROM boundaries
         UNION ALL
         SELECT 'ccount-month-before-${suffix}@test.internal', month_start - interval '1 millisecond', NULL::timestamptz FROM boundaries
         UNION ALL
         SELECT 'ccount-month-after-${suffix}@test.internal', month_start + interval '1 millisecond', NULL::timestamptz FROM boundaries
         UNION ALL
         SELECT 'ccount-deleted-${suffix}@test.internal',
                GREATEST(week_start, month_start) + interval '1 millisecond',
                now()
         FROM boundaries
       ),
       inserted AS (
         INSERT INTO uc_users (email, password_hash, first_name, last_name, phone, created_at, deleted_at)
         SELECT email, 'x', 'Boundary', 'Tester', '', created_at, deleted_at
         FROM seed
         RETURNING id, created_at, deleted_at
       )
       SELECT inserted.*, boundaries.week_start, boundaries.month_start
       FROM inserted CROSS JOIN boundaries`
    );
    insertedIds.push(...seeded.rows.map(row => row.id));

    try {
      const boundaryIds = seeded.rows.map(row => row.id);
      const realQuery = pool.query.bind(pool);
      const queryMock = mock.method(
        pool,
        "query",
        async (queryText: string, values?: unknown[]) => {
          if (
            typeof queryText === "string" &&
            queryText.includes("AS new_this_week") &&
            queryText.includes("AS new_this_month")
          ) {
            return realQuery(
              queryText.replace(
                "WHERE deleted_at IS NULL",
                "WHERE deleted_at IS NULL AND id = ANY($2::int[])"
              ),
              [values?.[0], boundaryIds]
            );
          }
          return realQuery(queryText, values);
        }
      );

      const { status, body } = await apiFetch(server, "/api/uc/admin/customers/count", {
        headers: { authorization: teamHeader },
      });
      queryMock.mock.restore();
      assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
      const counts = body as CountBody;
      const activeRows = seeded.rows.filter(row => row.deleted_at === null);
      const expectedWeekIncrease = activeRows.filter(
        row => row.created_at.getTime() >= row.week_start.getTime()
      ).length;
      const expectedMonthIncrease = activeRows.filter(
        row => row.created_at.getTime() >= row.month_start.getTime()
      ).length;

      assert.equal(counts.count, 4, "only the four active boundary rows count");
      assert.equal(
        counts.newThisWeek,
        expectedWeekIncrease,
        "weekly count should include only active rows at or after the Monday boundary"
      );
      assert.equal(
        counts.newThisMonth,
        expectedMonthIncrease,
        "monthly count should include only active rows at or after the first-of-month boundary"
      );
    } finally {
      const boundaryIds = seeded.rows.map(row => row.id);
      await pool.query("DELETE FROM uc_users WHERE id = ANY($1::int[])", [boundaryIds]);
      for (const id of boundaryIds) {
        const index = insertedIds.indexOf(id);
        if (index !== -1) insertedIds.splice(index, 1);
      }
    }
  });

  it("keeps Nairobi reset instants unchanged across database session timezones", async () => {
    // Literal UTC fixtures are independent of the SQL boundary implementation.
    // Nairobi midnight on Oct 1 / Monday Oct 5 is 21:00 UTC the preceding day.
    const client = await pool.connect();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let queryMock: ReturnType<typeof mock.method> | undefined;
    try {
      await client.query("BEGIN");
      const seeded = await client.query<{ id: number }>(
        `INSERT INTO uc_users (email, password_hash, first_name, last_name, phone, created_at, deleted_at)
         SELECT 'ccount-zone-' || ord || '-' || $1 || '@test.internal',
                'x', 'Timezone', 'Tester', '', instant,
                CASE WHEN ord = 7 THEN '2026-10-05T09:00:00Z'::timestamptz ELSE NULL END
         FROM unnest(ARRAY[
           '2026-09-30T20:59:59.999Z'::timestamptz,
           '2026-09-30T21:00:00Z'::timestamptz,
           '2026-09-30T21:00:00.001Z'::timestamptz,
           '2026-10-04T20:59:59.999Z'::timestamptz,
           '2026-10-04T21:00:00Z'::timestamptz,
           '2026-10-04T21:00:00.001Z'::timestamptz,
           '2026-10-04T21:00:00.001Z'::timestamptz
         ]) WITH ORDINALITY AS fixtures(instant, ord)
         RETURNING id`,
        [suffix]
      );
      const boundaryIds = seeded.rows.map(row => row.id);
      const realQuery = pool.query.bind(pool);
      let clock = "";
      let threshold = 0;
      let countQueries = 0;
      queryMock = mock.method(pool, "query", async (queryText: string, values?: unknown[]) => {
        if (typeof queryText === "string" &&
            queryText.includes("AS new_this_week") &&
            queryText.includes("AS new_this_month")) {
          countQueries++;
          // Execute the actual endpoint SQL on our transaction-local session.
          // Only time and fixture scope are injected, never the boundary logic.
          const scopedQuery = queryText.replaceAll("now()", "$2::timestamptz")
            .replaceAll("uc_customer_statistics_days", "fixture_days")
            .replaceAll("uc_customer_statistics", "fixture_total")
            .replaceAll("uc_users", "fixture_users")
            .replace("WITH statistics AS", `WITH
              fixture_users AS (SELECT * FROM uc_users WHERE id = ANY($3::int[])),
              fixture_total AS (
                SELECT 1 AS id, count(*)::bigint AS active_count,
                  'Africa/Nairobi'::text AS reporting_timezone
                FROM fixture_users WHERE deleted_at IS NULL
              ),
              fixture_days AS (
                SELECT (created_at AT TIME ZONE 'Africa/Nairobi')::date AS day,
                  count(*)::bigint AS active_count
                FROM fixture_users WHERE deleted_at IS NULL GROUP BY 1
              ),
              statistics AS`);
          return client.query(scopedQuery, [threshold, clock, boundaryIds]);
        }
        return realQuery(queryText, values);
      });

      const resets = [
        // The endpoint retains its existing lower-bound-only semantics:
        // future-dated fixtures also count until the boundary passes them.
        { clock: "2026-09-30T20:59:59.999Z", week: 6, month: 6 },
        { clock: "2026-09-30T21:00:00Z", week: 6, month: 5 },
        { clock: "2026-10-04T20:59:59.999Z", week: 6, month: 5 },
        { clock: "2026-10-04T21:00:00Z", week: 2, month: 5 },
      ];
      for (const timezone of ["UTC", "Africa/Nairobi", "America/Los_Angeles", "Asia/Tokyo"]) {
        await client.query("SELECT set_config('TimeZone', $1, true)", [timezone]);
        for (const branch of [0, Number.MAX_SAFE_INTEGER]) {
          threshold = branch;
          for (const reset of resets) {
          clock = reset.clock;
          const { status, body } = await apiFetch(server, "/api/uc/admin/customers/count", {
            headers: { authorization: teamHeader },
          });
          assert.equal(status, 200, JSON.stringify(body));
          assert.deepEqual(body, {
            count: 6,
            newThisWeek: reset.week,
            newThisMonth: reset.month,
          }, `session ${timezone} at ${clock}, threshold ${threshold} must use Nairobi boundaries (inclusive midnight)`);
          }
        }
      }
      assert.equal(countQueries, 32, "both endpoint branches must execute the production count query");
    } finally {
      queryMock?.mock.restore();
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("GET /uc/admin/customers/count — query performance", () => {
  it("has an idempotent partial index that the count query can use", async () => {
    // Running the migration statement again proves it remains safe on restart.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS uc_users_active_count_covering_idx
        ON uc_users (deleted_at)
        INCLUDE (created_at)
        WHERE deleted_at IS NULL
    `);

    const definition = await pool.query<{ indexdef: string }>(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'uc_users'
          AND indexname = 'uc_users_active_count_covering_idx'`
    );
    assert.equal(definition.rowCount, 1, "active-customer count index should exist");
    assert.match(
      definition.rows[0]!.indexdef,
      /\(deleted_at\) INCLUDE \(created_at\) WHERE \(deleted_at IS NULL\)$/
    );

    // A small test database may rationally prefer a sequential scan. Disabling
    // sequential/bitmap scans lets EXPLAIN verify index-only eligibility,
    // independently of concurrent fixtures changing the visibility map or
    // planner costs. This is not a claim of zero physical heap visibility reads.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      await client.query("SET LOCAL enable_bitmapscan = off");
      const plan = await client.query<{ "QUERY PLAN": string }>(`
        EXPLAIN (COSTS OFF)
        SELECT
          COUNT(*)::int,
          COUNT(*) FILTER (WHERE created_at >= (date_trunc('week', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi'))::int,
          COUNT(*) FILTER (WHERE created_at >= (date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi'))::int
        FROM uc_users
        WHERE deleted_at IS NULL
      `);
      assert.match(
        plan.rows.map(row => row["QUERY PLAN"]).join("\n"),
        /Index Only Scan using uc_users_active_count_covering_idx/,
        "customer count query must be eligible for the covering index-only plan"
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
