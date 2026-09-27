import {
  pgTable,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Records the most recent successful low-stock email for each WooCommerce
 * product. The scheduled digest uses this timestamp to suppress products that
 * the team was already alerted about during the preceding 24 hours.
 */
export const ucLowStockAlertsTable = pgTable("uc_low_stock_alerts", {
  productId: integer("product_id").primaryKey(),
  alertedAt: timestamp("alerted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUcLowStockAlertSchema = createInsertSchema(ucLowStockAlertsTable);
export type InsertUcLowStockAlert = z.infer<typeof insertUcLowStockAlertSchema>;
export type UcLowStockAlert = typeof ucLowStockAlertsTable.$inferSelect;