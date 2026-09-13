import { bigserial, bigint, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Durable retry and alert state for referral conversion writes that failed after order confirmation. */
export const ucReferralSettlementsTable = pgTable("uc_referral_settlements", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: bigint("order_id", { mode: "number" }).notNull(),
  // Legacy email retries populate these fields; account-bound settlements may
  // intentionally leave them null and use the order/attribution tables.
  referralCode: text("referral_code"),
  userEmail: text("user_email"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(1),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  claimToken: text("claim_token"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  alertClaimedAt: timestamp("alert_claimed_at", { withTimezone: true }),
  alertedAt: timestamp("alerted_at", { withTimezone: true }),
  alertAttempts: integer("alert_attempts").notNull().default(0),
  alertLastError: text("alert_last_error"),
  alertNextAttemptAt: timestamp("alert_next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  slackAlertClaimedAt: timestamp("slack_alert_claimed_at", { withTimezone: true }),
  slackAlertedAt: timestamp("slack_alerted_at", { withTimezone: true }),
  slackAlertAttempts: integer("slack_alert_attempts").notNull().default(0),
  slackAlertLastError: text("slack_alert_last_error"),
  slackAlertNextAttemptAt: timestamp("slack_alert_next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uc_referral_settlements_order_unique").on(table.orderId),
]);