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
 * product's meta, the audit marks the row resolved (resolvedAt set) instead of
 * deleting it, so a later regression (meta removed again) re-alerts the team
 * once more AND the alert history is preserved: alertCount tracks how many
 * times the product has been alerted, letting repeat offenders be flagged in
 * the alert email ("regressed — alerted N times before").
 */
export const ucLifespanAlertsTable = pgTable("uc_lifespan_alerts", {
  productId:  integer("product_id").primaryKey(),
  name:       text("name").notNull().default(""),
  sku:        text("sku").notNull().default(""),
  alertedAt:  timestamp("alerted_at", { withTimezone: true }).notNull().defaultNow(),
  /** How many times this product has been alerted (1 on first alert). */
  alertCount: integer("alert_count").notNull().default(1),
  /** Set when the product's meta was fixed; cleared again on regression. */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertUcLifespanAlertSchema = createInsertSchema(ucLifespanAlertsTable);
export type InsertUcLifespanAlert = z.infer<typeof insertUcLifespanAlertSchema>;
export type UcLifespanAlert = typeof ucLifespanAlertsTable.$inferSelect;
