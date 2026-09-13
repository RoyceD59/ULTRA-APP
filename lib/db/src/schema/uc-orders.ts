import { pgTable, serial, integer, text, timestamp, json, boolean, uniqueIndex, bigint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Persists orders placed through the UC Companion app.
 * When WooCommerce credentials are present, WC is the system of record and
 * these tables are not used. In mock mode, orders live here.
 */
export const ucOrdersTable = pgTable("uc_orders", {
  id:               serial("id").primaryKey(),
  userId:           text("user_id").notNull(),
  status:           text("status").notNull().default("pending"),
  total:            text("total").notNull(),
  currency:         text("currency").notNull().default("KES"),
  paymentMethod:    text("payment_method").notNull(),
  paymentReference: text("payment_reference").default(""),
  // Request key for a durable local promoted checkout.  This is deliberately
  // independent of payment references because COD has none.
  checkoutIdempotencyKey: text("checkout_idempotency_key").notNull().default(""),
  checkoutClaimId: text("checkout_claim_id"),
  checkoutState: text("checkout_state"),
  remoteAttemptedAt: timestamp("remote_attempted_at", { withTimezone: true }),
  /** Authoritative provider/local confirmation instant; fill once. */
  paymentConfirmedAt: timestamp("payment_confirmed_at", { withTimezone: true }),
  // M-Pesa confirmation code (e.g. "SGB1KX2Q4P") extracted from the Daraja
  // callback — the code the customer sees in their M-Pesa SMS and the one the
  // team matches against M-Pesa statements when doing the books. Empty for
  // non-M-Pesa orders or when no callback has arrived yet. Fill-once: never
  // overwritten after it is set.
  mpesaReceipt:     text("mpesa_receipt").notNull().default(""),
  promoCode:        text("promo_code").default(""),
  discountPercent:  integer("discount_percent").notNull().default(0),
  discountAmount:   integer("discount_amount").notNull().default(0),
  /** Immutable claimed referral discount; unique so it cannot price two orders. */
  referralBenefitId: bigint("referral_benefit_id", { mode: "number" }),
  shippingAddress:  json("shipping_address").$type<Record<string, string>>(),
  dateCreated:      timestamp("date_created", { withTimezone: true }).notNull().defaultNow(),
  // WooCommerce order ID persisted at confirmation time so that a retry can
  // return a consistent external ID even when the WC store is briefly
  // unreachable.  NULL for orders that never touched WooCommerce (DB-only,
  // mock, or COD without an anchor).  Fill-once: never overwritten after set.
  wcOrderId:        integer("wc_order_id"),
  // True only for orders inserted automatically by the Paystack webhook recovery
  // path (customer paid but the app lost connectivity before createOrder fired).
  // Set at insert time — never derived from userId heuristics.
  webhookRecovery:  boolean("webhook_recovery").notNull().default(false),
  // COD collection is deliberately separate from the general order status:
  // "awaiting_collection" means no cash has been received; "collected" is
  // set only by the staff-only confirmation endpoint.
  codCollectionStatus: text("cod_collection_status"),
  codCollectedBy:     text("cod_collected_by"),
  codCollectedAt:     timestamp("cod_collected_at", { withTimezone: true }),
  codWcSyncStatus: text("cod_wc_sync_status"),
  codWcSyncError: text("cod_wc_sync_error"),
  codWcSyncAttemptedAt: timestamp("cod_wc_sync_attempted_at", { withTimezone: true }),
  codWcSyncAttemptCount: integer("cod_wc_sync_attempt_count").notNull().default(0),
  customerStage:    text("customer_stage"),
  customerStageUpdatedAt: timestamp("customer_stage_updated_at", { withTimezone: true }),
}, (t) => [
  // Partial unique index: prevent duplicate orders for the same payment reference.
  // Excludes empty strings so that COD orders (no reference) are not affected.
  uniqueIndex("uc_orders_payment_reference_unique")
    .on(t.paymentReference)
    .where(sql`payment_reference != ''`),
  uniqueIndex("uc_orders_user_checkout_idempotency_unique")
    .on(t.userId, t.checkoutIdempotencyKey)
    .where(sql`checkout_idempotency_key != ''`),
  uniqueIndex("uc_orders_referral_benefit_unique").on(t.referralBenefitId),
]);

export const ucOrderItemsTable = pgTable("uc_order_items", {
  id:        serial("id").primaryKey(),
  orderId:   integer("order_id").notNull().references(() => ucOrdersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull(),
  name:      text("name").notNull(),
  quantity:  integer("quantity").notNull(),
  total:     text("total").notNull(),
});

export type UcOrder     = typeof ucOrdersTable.$inferSelect;
export type UcOrderItem = typeof ucOrderItemsTable.$inferSelect;
