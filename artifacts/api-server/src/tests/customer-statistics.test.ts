import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { CUSTOMER_STATISTICS_QUERY, CUSTOMER_STATISTICS_THRESHOLD } from "../lib/customer-statistics.js";

const direct = `SELECT count(*)::bigint AS count,
  count(*) FILTER (WHERE created_at >=
    (date_trunc('week', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi'))::bigint AS new_this_week,
  count(*) FILTER (WHERE created_at >=
    (date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi'))::bigint AS new_this_month
  FROM uc_users WHERE deleted_at IS NULL`;

async function compare(client: PoolClient, threshold = 0, asOf?: string) {
  // Both sides share one MVCC snapshot, even when other test files are writing.
  const query = `
    WITH actual AS (${CUSTOMER_STATISTICS_QUERY}), expected AS (${direct})
    SELECT row_to_json(actual) AS actual, row_to_json(expected) AS expected
    FROM actual CROSS JOIN expected`;
  const { rows } = await client.query(
    asOf ? query.replaceAll("now()", "$2::timestamptz") : query,
    asOf ? [threshold, asOf] : [threshold],
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].actual, rows[0].expected);
  return rows[0].actual as { count: number; new_this_week: number; new_this_month: number };
}

describe("transactional customer dashboard summary", () => {
  it("matches direct counts through registration, deletion, restoration, date correction and rollback", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM uc_customer_statistics WHERE id=1 FOR UPDATE");
      const baseline = await compare(client);
      const prefix = randomUUID();
      const seed = await client.query<{ id: number }>(`
        INSERT INTO uc_users (email, password_hash, first_name, created_at, deleted_at)
        SELECT $1 || n || '@test.internal', 'x', 'Summary',
          CASE n
            WHEN 1 THEN now()
            WHEN 2 THEN (date_trunc('week', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi') - interval '1 microsecond'
            WHEN 3 THEN (date_trunc('week', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi')
            WHEN 4 THEN (date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi') - interval '1 microsecond'
            WHEN 5 THEN (date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi')
            WHEN 6 THEN now() + interval '2 months'
            ELSE now() - interval '2 years'
          END,
          CASE WHEN n=8 THEN now() ELSE NULL END
        FROM generate_series(1,8) n RETURNING id`, [prefix]);
      const ids = seed.rows.map(row => row.id);
      assert.equal((await compare(client)).count, baseline.count + 7);
      await compare(client, Number.MAX_SAFE_INTEGER); // indexed branch
      const count = (await compare(client)).count;
      await compare(client, count); // exact threshold uses summary
      await compare(client, count + 1); // just below threshold uses direct
      // Moving the clock alone must roll over calendar counts without writes
      // or a scheduled reset. Also exercise a month whose week starts before it.
      for (const asOf of ["2026-10-01T00:00:00Z", "2026-10-05T00:00:00Z",
        "2026-11-01T00:00:00Z", "2027-01-01T00:00:00Z"]) {
        await compare(client, 0, asOf);
      }
      for (const timezone of ["UTC", "Africa/Nairobi", "America/Los_Angeles", "Asia/Tokyo"]) {
        await client.query("SELECT set_config('TimeZone',$1,true)", [timezone]);
        await client.query("UPDATE uc_users SET created_at=$2::timestamptz WHERE id=$1",
          [ids[0], "2026-09-30T21:00:00Z"]);
        await compare(client, 0, "2026-09-30T20:59:59.999Z");
        await compare(client, 0, "2026-09-30T21:00:00Z");
        await client.query("UPDATE uc_users SET created_at=now() WHERE id=$1", [ids[0]]);
        await compare(client);
      }

      await client.query("UPDATE uc_users SET deleted_at=now() WHERE id=ANY($1::int[])", [ids]);
      assert.equal((await compare(client)).count, baseline.count);
      await client.query("UPDATE uc_users SET deleted_at=now() WHERE id=ANY($1::int[])", [ids]);
      await compare(client); // repeated deletion is a no-op
      await client.query("UPDATE uc_users SET deleted_at=NULL WHERE id=ANY($1::int[])", [ids]);
      assert.equal((await compare(client)).count, baseline.count + 8);
      await client.query("UPDATE uc_users SET deleted_at=NULL, first_name='Changed' WHERE id=ANY($1::int[])", [ids]);
      await compare(client); // profile edit and repeated restoration
      await client.query("UPDATE uc_users SET created_at=now()-interval '3 years' WHERE id=$1", [ids[0]]);
      await compare(client);
      await client.query("UPDATE uc_users SET created_at=now() WHERE id=$1", [ids[0]]);
      await compare(client);
      await client.query("SAVEPOINT changes");
      await client.query("DELETE FROM uc_users WHERE id=ANY($1::int[])", [ids]);
      assert.equal((await compare(client)).count, baseline.count);
      await client.query("ROLLBACK TO SAVEPOINT changes");
      assert.equal((await compare(client)).count, baseline.count + 8);
      await client.query("SAVEPOINT failed_write");
      await assert.rejects(client.query(`
        INSERT INTO uc_users (email,password_hash,first_name)
        SELECT $1,'x','Duplicate' FROM generate_series(1,2)`, [`duplicate-${prefix}@test.internal`]));
      await client.query("ROLLBACK TO SAVEPOINT failed_write");
      await compare(client);
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("does not scan customer rows on the large-volume branch", async () => {
    const client = await pool.connect();
    try {
      const plan = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${CUSTOMER_STATISTICS_QUERY}`, [0]);
      function assertNoCustomerScan(node: Record<string, unknown>) {
        if (node["Relation Name"] === "uc_users") assert.equal(node["Actual Loops"], 0);
        for (const child of (node.Plans ?? []) as Record<string, unknown>[]) assertNoCustomerScan(child);
      }
      assertNoCustomerScan(plan.rows[0]["QUERY PLAN"][0].Plan);
      await compare(client, CUSTOMER_STATISTICS_THRESHOLD);
    } finally { client.release(); }
  });

  it("concurrent committed and rolled-back registrations cannot lose or leak increments", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    const prefix = randomUUID();
    try {
      await a.query("BEGIN");
      await a.query(`INSERT INTO uc_users(email,password_hash,first_name) VALUES ($1,'x','Concurrent')`,
        [`a-${prefix}@test.internal`]);
      await b.query("BEGIN");
      const pending = b.query(`INSERT INTO uc_users(email,password_hash,first_name) VALUES ($1,'x','Concurrent')`,
        [`b-${prefix}@test.internal`]);
      await a.query("COMMIT");
      await pending;
      await b.query("COMMIT");
      await compare(a);
      await a.query("BEGIN");
      await a.query("UPDATE uc_users SET deleted_at=now() WHERE email=$1", [`a-${prefix}@test.internal`]);
      await b.query("BEGIN");
      const secondPending = b.query(`INSERT INTO uc_users(email,password_hash,first_name) VALUES ($1,'x','Concurrent')`,
        [`c-${prefix}@test.internal`]);
      await a.query("ROLLBACK");
      await secondPending;
      await b.query("ROLLBACK");
      await compare(a);
    } finally {
      await a.query("ROLLBACK");
      await b.query("ROLLBACK");
      await a.query("DELETE FROM uc_users WHERE email=ANY($1::text[])", [
        ["a", "b", "c"].map(label => `${label}-${prefix}@test.internal`),
      ]);
      a.release(); b.release();
    }
  });

  it("backfills legacy data once, survives repeated rollout, and resets on truncate", async () => {
    // Transaction-local shadow schema avoids global destructive changes.
    const client = await pool.connect();
    const schema = `customer_stats_${randomUUID().replaceAll("-", "")}`;
    const sql = await readFile(new URL("../../../../lib/db/migrations/0061_uc_customer_statistics.sql", import.meta.url), "utf8");
    const scopedSql = sql.replace("BEGIN;", "").replace("COMMIT;", "")
      .replaceAll("SET search_path = public", `SET search_path = ${schema}`);
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path = ${schema}`);
      await client.query("CREATE TABLE uc_users (id integer, created_at timestamptz NOT NULL, deleted_at timestamptz)");
      await client.query(`INSERT INTO uc_users VALUES (1,'2026-09-30T21:00:00Z',NULL), (2,now(),now()), (3,now()-interval '2 years',NULL)`);
      await client.query(scopedSql);
      await compare(client, 0, "2026-09-30T21:00:00Z");
      // Upgrade an already initialized but untagged UTC preview summary.
      await client.query("ALTER TABLE uc_customer_statistics DROP COLUMN reporting_timezone");
      await client.query("DELETE FROM uc_customer_statistics_days");
      await client.query(`INSERT INTO uc_customer_statistics_days
        SELECT (created_at AT TIME ZONE 'UTC')::date, count(*)
        FROM uc_users WHERE deleted_at IS NULL GROUP BY 1`);
      await client.query(scopedSql);
      await compare(client, 0, "2026-09-30T21:00:00Z");
      await client.query(scopedSql);
      await compare(client, 0);
      await client.query("UPDATE uc_users SET deleted_at=NULL WHERE id=2");
      assert.equal((await compare(client, 0)).count, 3);
      await client.query("TRUNCATE uc_users");
      assert.equal((await compare(client, 0)).count, 0);
      await client.query("INSERT INTO uc_users VALUES(4,now(),NULL)");
      assert.equal((await compare(client, 0)).count, 1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});