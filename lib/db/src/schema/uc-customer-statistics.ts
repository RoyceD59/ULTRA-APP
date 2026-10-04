import { sql } from "drizzle-orm";
import { pgTable, integer, bigint, date, text, check } from "drizzle-orm/pg-core";

/** Maintained by database triggers, never by application-side dual writes. */
export const ucCustomerStatisticsTable = pgTable("uc_customer_statistics", {
  id: integer("id").primaryKey(),
  activeCount: bigint("active_count", { mode: "number" }).notNull(),
  reportingTimezone: text("reporting_timezone").notNull(),
}, table => [
  check("uc_customer_statistics_singleton", sql`${table.id} = 1`),
  check("uc_customer_statistics_nonnegative", sql`${table.activeCount} >= 0`),
]);

/** Africa/Nairobi creation dates; old buckets are not scanned by dashboard reads. */
export const ucCustomerStatisticsDaysTable = pgTable("uc_customer_statistics_days", {
  day: date("day", { mode: "string" }).primaryKey(),
  activeCount: bigint("active_count", { mode: "number" }).notNull(),
}, table => [
  check("uc_customer_statistics_days_nonnegative", sql`${table.activeCount} >= 0`),
]);