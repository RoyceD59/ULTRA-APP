import { pgTable, bigserial, bigint, integer, text, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ucUsersTable } from "./uc-users.js";
import { ucOrdersTable, ucOrderItemsTable } from "./uc-orders.js";

/** One server-owned purchase joining Companion, WooCommerce and provider references. */
export const ucCanonicalPurchasesTable = pgTable("uc_canonical_purchases", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: integer("customer_id").references(() => ucUsersTable.id),
  companionOrderId: integer("companion_order_id").references(() => ucOrdersTable.id),
  woocommerceOrderId: integer("woocommerce_order_id"),
  paymentProvider: text("payment_provider"),
  paymentReference: text("payment_reference"),
  receiptNumber: text("receipt_number"),
  currency: text("currency").notNull().default("KES"),
  subtotalMinor: integer("subtotal_minor"),
  taxMinor: integer("tax_minor"),
  deliveryMinor: integer("delivery_minor"),
  discountMinor: integer("discount_minor"),
  totalMinor: integer("total_minor").notNull(),
  paymentStatus: text("payment_status").notNull().default("pending"),
  fulfilmentStatus: text("fulfilment_status").notNull().default("pending"),
  identitySnapshot: jsonb("identity_snapshot").$type<Record<string, unknown>>(),
  correlationId: text("correlation_id"),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_canonical_purchases_companion_order_unique")
    .on(t.companionOrderId)
    .where(sql`${t.companionOrderId} IS NOT NULL`),
  uniqueIndex("uc_canonical_purchases_woocommerce_order_unique")
    .on(t.woocommerceOrderId)
    .where(sql`${t.woocommerceOrderId} IS NOT NULL`),
  uniqueIndex("uc_canonical_purchases_provider_reference_unique")
    .on(t.paymentProvider, t.paymentReference)
    .where(sql`${t.paymentReference} IS NOT NULL AND ${t.paymentReference} <> ''`),
  index("uc_canonical_purchases_customer_created_idx").on(t.customerId, t.createdAt),
  index("uc_canonical_purchases_correlation_idx").on(t.correlationId),
  check("uc_canonical_purchases_amounts_check", sql`${t.totalMinor} >= 0 AND ((${t.subtotalMinor} IS NULL OR ${t.subtotalMinor} >= 0) AND (${t.taxMinor} IS NULL OR ${t.taxMinor} >= 0) AND (${t.deliveryMinor} IS NULL OR ${t.deliveryMinor} >= 0) AND (${t.discountMinor} IS NULL OR ${t.discountMinor} >= 0))`),
  check("uc_canonical_purchases_total_minor_check", sql`${t.totalMinor} >= 0`),
]);

export const ucCanonicalPurchaseLinesTable = pgTable("uc_canonical_purchase_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  purchaseId: bigint("purchase_id", { mode: "number" }).notNull()
    .references(() => ucCanonicalPurchasesTable.id, { onDelete: "cascade" }),
  sourceOrderItemId: integer("source_order_item_id").references(() => ucOrderItemsTable.id),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitTotalMinor: integer("unit_total_minor"),
  lineTotalMinor: integer("line_total_minor").notNull(),
  productReference: text("product_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_canonical_purchase_lines_source_item_unique")
    .on(t.sourceOrderItemId)
    .where(sql`${t.sourceOrderItemId} IS NOT NULL`),
  index("uc_canonical_purchase_lines_purchase_idx").on(t.purchaseId),
  index("uc_canonical_purchase_lines_product_idx").on(t.productId),
  check("uc_canonical_purchase_lines_line_total_minor_check", sql`${t.lineTotalMinor} >= 0`),
  check("uc_canonical_purchase_lines_quantity_check", sql`${t.quantity} > 0 AND (${t.unitTotalMinor} IS NULL OR ${t.unitTotalMinor} >= 0)`),
]);

export type UcCanonicalPurchase = typeof ucCanonicalPurchasesTable.$inferSelect;
export type UcCanonicalPurchaseLine = typeof ucCanonicalPurchaseLinesTable.$inferSelect;