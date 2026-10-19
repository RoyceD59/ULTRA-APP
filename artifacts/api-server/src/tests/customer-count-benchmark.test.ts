/**
 * Opt-in benchmark. Always run through the isolated database wrapper:
 * CUSTOMER_COUNT_BENCHMARK=1 TEST_GLOB=src/tests/customer-count-benchmark.test.ts pnpm test
 */
import { it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { CUSTOMER_STATISTICS_QUERY, CUSTOMER_STATISTICS_THRESHOLD } from "../lib/customer-statistics.js";

it("benchmarks indexed customer counts at representative volumes", {
  skip: process.env.CUSTOMER_COUNT_BENCHMARK !== "1",
}, async () => {
  const client = await pool.connect();
  try {
    // A private relation avoids touching real customer data or other test fixtures.
    await client.query(`CREATE TEMP TABLE benchmark_customers (
      id bigint, created_at timestamptz NOT NULL, deleted_at timestamptz
    )`);
    await client.query(`CREATE INDEX benchmark_active_idx ON benchmark_customers (deleted_at)
      INCLUDE (created_at) WHERE deleted_at IS NULL`);
    await client.query(`CREATE TEMP TABLE benchmark_total (id integer PRIMARY KEY, active_count bigint, reporting_timezone text);
      CREATE TEMP TABLE benchmark_days (day date PRIMARY KEY, active_count bigint)`);
    const adaptiveQuery = CUSTOMER_STATISTICS_QUERY
      .replaceAll("uc_customer_statistics_days", "benchmark_days")
      .replaceAll("uc_customer_statistics", "benchmark_total")
      .replaceAll("uc_users", "benchmark_customers");
    const metadata = await client.query("SELECT version(), current_setting('TimeZone') AS timezone");
    console.log("CUSTOMER_BENCHMARK_ENV", JSON.stringify(metadata.rows[0]));
    const volumes = process.env.CUSTOMER_COUNT_BENCHMARK_SMALL === "1"
      ? [1_000, 10_000, 25_000]
      : [1_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000];
    for (const volume of volumes) {
      await client.query("TRUNCATE benchmark_customers");
      await client.query(`INSERT INTO benchmark_customers
        SELECT n, now() - (n % 730) * interval '1 day',
          CASE WHEN n % 10 = 0 THEN now() ELSE NULL END
        FROM generate_series(1, $1::bigint) n`, [volume]);
      await client.query("VACUUM ANALYZE benchmark_customers");
      await client.query("TRUNCATE benchmark_total, benchmark_days");
      await client.query(`INSERT INTO benchmark_days
        SELECT (created_at AT TIME ZONE 'Africa/Nairobi')::date, count(*)
        FROM benchmark_customers WHERE deleted_at IS NULL GROUP BY 1`);
      await client.query("INSERT INTO benchmark_total SELECT 1,sum(active_count),'Africa/Nairobi' FROM benchmark_days");
      await client.query("ANALYZE benchmark_days; ANALYZE benchmark_total");
      // Force the best-case index-only path: crossing the target even here
      // demonstrates why a partial index alone is insufficient.
      await client.query("SET enable_seqscan = off");
      const query = `SELECT COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE created_at >= (date_trunc('week', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi'))::int AS new_this_week,
        COUNT(*) FILTER (WHERE created_at >= (date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi'))::int AS new_this_month
        FROM benchmark_customers WHERE deleted_at IS NULL`;
      const times: number[] = [];
      const adaptiveTimes: number[] = [];
      const summaryTimes: number[] = [];
      const expected = await client.query(query);
      for (const threshold of [0, CUSTOMER_STATISTICS_THRESHOLD]) {
        const actual = await client.query(adaptiveQuery, [threshold]);
        assert.deepEqual(
          Object.fromEntries(Object.entries(actual.rows[0]).map(([key, value]) => [key, Number(value)])),
          expected.rows[0],
        );
      }
      for (let run = 0; run < 22; run++) {
        const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
        const adaptive = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${adaptiveQuery}`,
          [CUSTOMER_STATISTICS_THRESHOLD]);
        const summary = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${adaptiveQuery}`, [0]);
        if (run >= 2) {
          times.push(plan.rows[0]["QUERY PLAN"][0]["Execution Time"]);
          adaptiveTimes.push(adaptive.rows[0]["QUERY PLAN"][0]["Execution Time"]);
          summaryTimes.push(summary.rows[0]["QUERY PLAN"][0]["Execution Time"]);
        }
      }
      times.sort((a, b) => a - b);
      adaptiveTimes.sort((a, b) => a - b);
      summaryTimes.sort((a, b) => a - b);
      console.log("CUSTOMER_BENCHMARK", JSON.stringify({
        volume, active: volume * 0.9, p50_ms: times[10], p95_ms: times[18],
        adaptive_p95_ms: adaptiveTimes[18], summary_p95_ms: summaryTimes[18], target_ms: 50,
      }));
    }
  } finally {
    await client.query("RESET enable_seqscan");
    client.release();
  }
});