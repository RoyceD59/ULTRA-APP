import { pgTable, integer, date, doublePrecision, timestamp, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ucUsersTable } from "./uc-users";

export const ucDailyHydrationTable = pgTable("uc_daily_hydration", {
  userId: integer("user_id").notNull().references(() => ucUsersTable.id, { onDelete: "cascade" }),
  localDate: date("local_date", { mode: "string" }).notNull(),
  litres: doublePrecision("litres").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.userId, table.localDate] }),
  check("uc_daily_hydration_litres_valid", sql`${table.litres} >= 0 AND ${table.litres} < 'Infinity'::double precision`),
]);