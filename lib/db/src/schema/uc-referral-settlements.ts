import { bigserial, bigint, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Durable retry and alert state for referral conversion writes that failed after order confirmation. */
export const ucReferralSettlementsTable = pgTable("uc_referral_settlements", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: bigint("order_id", { mode: "number" }).notNull(),
  referralCode: text("referral_code").notNull(),
  userEmail: text("user_email").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(1),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  claimToken: text("claim_token"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  alertClaimedAt: timestamp("alert_claimed_at", { withTimezone: true }),
  alertedAt: timestamp("alerted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uc_referral_settlements_order_unique").on(table.orderId),
]);