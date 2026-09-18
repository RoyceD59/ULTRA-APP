import { pgTable, serial, integer, text, timestamp, boolean, uniqueIndex, index, bigint, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ucUsersTable } from "./uc-users.js";
import { ucCanonicalPurchaseLinesTable } from "./uc-canonical-purchases.js";
import { ucLegacyRegistrationReviewsTable } from "./uc-lifecycle-review.js";

/** Durable filter registrations owned by a Companion account. */
export const ucRegisteredFiltersTable = pgTable("uc_registered_filters", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => ucUsersTable.id),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  ratedCapacityLitres: integer("rated_capacity_litres").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }).notNull(),
  sourceOrderId: integer("source_order_id"),
  source: text("source").notNull().default("legacy"),
  active: boolean("active").notNull().default(true),
  verificationStatus: text("verification_status").notNull().default("approved"),
  lifecycleStatus: text("lifecycle_status").notNull().default("active"),
  canonicalPurchaseLineId: bigint("canonical_purchase_line_id", { mode: "number" })
    .references(() => ucCanonicalPurchaseLinesTable.id),
  legacyReviewId: bigint("legacy_review_id", { mode: "number" })
    .references(() => ucLegacyRegistrationReviewsTable.id),
  maintenanceCount: integer("maintenance_count").notNull().default(0),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_registered_filters_source_order_product_idx")
    .on(t.source, t.sourceOrderId, t.productId),
  uniqueIndex("uc_registered_filters_verified_purchase_line_unique")
    .on(t.canonicalPurchaseLineId)
    .where(sql`${t.verificationStatus} = 'approved' AND ${t.canonicalPurchaseLineId} IS NOT NULL`),
  index("uc_registered_filters_user_active_idx").on(t.userId, t.active),
  index("uc_registered_filters_user_status_idx").on(t.userId, t.verificationStatus, t.lifecycleStatus),
  check("uc_registered_filters_verification_status_check", sql`${t.verificationStatus} IN ('pending_review','approved','rejected','correction_requested')`),
  check("uc_registered_filters_lifecycle_status_check", sql`${t.lifecycleStatus} IN ('active','inactive')`),
]);

export type UcRegisteredFilter = typeof ucRegisteredFiltersTable.$inferSelect;