import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

// Nairobi index-only p95 can exceed 50 ms at 9k active customers under
// workspace load. Switch earlier for headroom (see docs benchmark).
export const CUSTOMER_STATISTICS_THRESHOLD = 5_000;

/** Shared, idempotent migration for deployed startup and isolated tests. */
export async function ensureCustomerStatisticsSchema() {
  const path = import.meta.url.includes("/dist/")
    ? new URL("./0061_uc_customer_statistics.sql", import.meta.url)
    : new URL("../../../../lib/db/migrations/0061_uc_customer_statistics.sql", import.meta.url);
  const client = await pool.connect();
  try {
    await client.query(await readFile(path, "utf8"));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Africa/Nairobi business calendar, independent of session timezone. Future-dated
 * imports retain the previous >= boundary semantics (no upper bound).
 * One SQL statement gives the selector and all counters the same MVCC snapshot.
 * UNION branches gate execution: large volumes never scan uc_users.
 */
export const CUSTOMER_STATISTICS_QUERY = `
  WITH statistics AS MATERIALIZED (
    SELECT active_count FROM uc_customer_statistics
    WHERE id = 1 AND reporting_timezone = 'Africa/Nairobi'
  ), boundaries AS (
    SELECT date_trunc('week', now() AT TIME ZONE 'Africa/Nairobi')::date AS week_start,
           date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi')::date AS month_start
  )
  SELECT count, new_this_week, new_this_month FROM (
    SELECT COUNT(*)::bigint AS count,
      COUNT(*) FILTER (WHERE created_at >=
        (b.week_start::timestamp AT TIME ZONE 'Africa/Nairobi'))::bigint AS new_this_week,
      COUNT(*) FILTER (WHERE created_at >=
        (b.month_start::timestamp AT TIME ZONE 'Africa/Nairobi'))::bigint AS new_this_month
    FROM uc_users CROSS JOIN boundaries b
    WHERE deleted_at IS NULL
      AND (SELECT active_count < $1 FROM statistics)
    HAVING (SELECT active_count < $1 FROM statistics)
    UNION ALL
    SELECT s.active_count AS count,
      coalesce(sum(d.active_count) FILTER (WHERE d.day >= b.week_start), 0)::bigint AS new_this_week,
      coalesce(sum(d.active_count) FILTER (WHERE d.day >= b.month_start), 0)::bigint AS new_this_month
    FROM statistics s CROSS JOIN boundaries b
    LEFT JOIN uc_customer_statistics_days d ON d.day >= LEAST(b.week_start, b.month_start)
    WHERE s.active_count >= $1
    GROUP BY s.active_count
  ) counts`;

export async function getCustomerStatistics() {
  const result = await pool.query<{
    count: string; new_this_week: string; new_this_month: string;
  }>(CUSTOMER_STATISTICS_QUERY, [CUSTOMER_STATISTICS_THRESHOLD]);
  const row = result.rows[0];
  if (!row) throw new Error("Customer statistics not initialized");
  return {
    count: Number(row.count),
    newThisWeek: Number(row.new_this_week),
    newThisMonth: Number(row.new_this_month),
  };
}