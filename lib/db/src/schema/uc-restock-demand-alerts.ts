import {
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Product-level state for one urgent-demand alert cycle.
 *
 * A row exists from the first atomic claim until stock returns or waiting
 * demand falls below the configured threshold. Keeping this state separate
 * from wishlist membership prevents customer deletions from re-sending an
 * alert while demand remains urgent.
 */
export const ucRestockDemandAlertsTable = pgTable("uc_restock_demand_alerts", {
  productId: integer("product_id").primaryKey(),
  productName: text("product_name").notNull(),
  waitingCount: integer("waiting_count").notNull(),
  threshold: integer("threshold").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull(),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }).notNull(),
  alertedAt: timestamp("alerted_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcRestockDemandAlert = typeof ucRestockDemandAlertsTable.$inferSelect;