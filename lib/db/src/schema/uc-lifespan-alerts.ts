import {
  pgTable,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Tracks which store products the team has already been emailed about for a
 * missing `filter_lifespan_days` meta. The daily lifespan-audit scheduler job
 * inserts a row per product the first time it is flagged, and only emails
 * about products with no row yet — preventing daily repeat alerts.
 *
 * Rows are keyed by the WooCommerce product ID. If the team later fixes the
 * product's meta, the audit deletes the row ("resolved"), so a later
 * regression (meta removed again) re-alerts the team once more.
 */
export const ucLifespanAlertsTable = pgTable("uc_lifespan_alerts", {
  productId: integer("product_id").primaryKey(),
  name:      text("name").notNull().default(""),
  sku:       text("sku").notNull().default(""),
  alertedAt: timestamp("alerted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUcLifespanAlertSchema = createInsertSchema(ucLifespanAlertsTable);
export type InsertUcLifespanAlert = z.infer<typeof insertUcLifespanAlertSchema>;
export type UcLifespanAlert = typeof ucLifespanAlertsTable.$inferSelect;
