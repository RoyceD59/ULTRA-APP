import { pgTable, serial, varchar, text, integer, boolean, timestamp, json, uniqueIndex, index, bigserial, bigint } from "drizzle-orm/pg-core";

/**
 * One row per referral-code owner.
 * `referredEmails` is a JSON array of email addresses that signed up using
 * this code. It is stored here rather than in a join table because it is only
 * ever read as a count for the GDPR export — individual emails are never
 * surfaced to callers.
 */
export const ucReferralCodesTable = pgTable("uc_referral_codes", {
  id:               serial("id").primaryKey(),
  /** The unique referral code string, e.g. "JAMES-AB3Z". */
  code:             varchar("code", { length: 40 }).notNull(),
  /** Normalised (lowercase) email of the code owner. */
  ownerEmail:       text("owner_email").notNull(),
  /** Display name of the code owner at time of code creation. */
  ownerName:        varchar("owner_name", { length: 255 }).notNull().default(""),
  /** JSON array of normalised emails that have signed up using this code. */
  referredEmails:   json("referred_emails").$type<string[]>().notNull().default([]),
  /** Count of conversions (first orders completed by referred users). */
  conversions:      integer("conversions").notNull().default(0),
  /** Total KES credits the owner has earned through conversions. */
  creditsEarnedKes: integer("credits_earned_kes").notNull().default(0),
  active:           boolean("active").notNull().default(true),
  expiresAt:        timestamp("expires_at", { withTimezone: true }),
  maxReferrals:     integer("max_referrals"),
  firstOrderDiscountPercent: integer("first_order_discount_percent").notNull().default(10),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_referral_codes_code_idx").on(t.code),
  uniqueIndex("uc_referral_codes_owner_email_idx").on(t.ownerEmail),
]);

export type UcReferralCode = typeof ucReferralCodesTable.$inferSelect;

/**
 * One row per UC Companion user, tracking their referral-programme state.
 * `referredByCode` is the code they entered at signup (null if none).
 * `firstOrderDone` tracks whether they have completed their first order —
 * the referral discount is valid only for the first order.
 */
export const ucReferralUsersTable = pgTable("uc_referral_users", {
  id:             serial("id").primaryKey(),
  /** Normalised (lowercase) user email. */
  email:          text("email").notNull(),
  /** Referral code the user entered at signup, if any. */
  referredByCode: varchar("referred_by_code", { length: 40 }),
  /** True once the user has completed at least one order. */
  firstOrderDone: boolean("first_order_done").notNull().default(false),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_referral_users_email_idx").on(t.email),
  index("uc_referral_users_referred_by_code_idx").on(t.referredByCode),
]);

export type UcReferralUser = typeof ucReferralUsersTable.$inferSelect;

/** Immutable account-level attribution.  The legacy email tables above remain
 * only for backwards-compatible reads; all new programme decisions use these
 * account ids. */
export const ucReferralAttributionsTable = pgTable("uc_referral_attributions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  referrerUserId: integer("referrer_user_id").notNull(),
  referredUserId: integer("referred_user_id").notNull(),
  referralCode: varchar("referral_code", { length: 40 }).notNull(),
  attributedAt: timestamp("attributed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_referral_attributions_referred_unique").on(t.referredUserId),
  index("uc_referral_attributions_referrer_idx").on(t.referrerUserId),
]);

/** Append-only conversion record; a refunded conversion is retained and marked
 * reversed rather than deleted. */
export const ucReferralConversionsTable = pgTable("uc_referral_conversions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  attributionId: bigint("attribution_id", { mode: "number" }).notNull(),
  qualifyingOrderId: integer("qualifying_order_id").notNull(),
  pointsSnapshot: integer("points_snapshot").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("confirmed"),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_referral_conversions_order_unique").on(t.qualifyingOrderId),
  uniqueIndex("uc_referral_conversions_attribution_unique").on(t.attributionId),
]);

/** Paired, non-transferable benefits.  The unique conversion/user/kind index
 * makes issuance and compensating reversal replay-safe. */
export const ucReferralBenefitsTable = pgTable("uc_referral_benefits", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  conversionId: bigint("conversion_id", { mode: "number" }).notNull(),
  userId: integer("user_id").notNull(),
  kind: varchar("kind", { length: 20 }).notNull(),
  points: integer("points").notNull().default(0),
  discountPercent: integer("discount_percent").notNull().default(0),
  /** Whether this account earned this benefit for inviting or being invited. */
  recipientRole: varchar("recipient_role", { length: 20 }).notNull().default("referred"),
  status: varchar("status", { length: 20 }).notNull().default("available"),
  usedOrderId: integer("used_order_id"),
  usedAt: timestamp("used_at", { withTimezone: true }),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_referral_benefits_conversion_user_kind_unique").on(t.conversionId, t.userId, t.kind),
  index("uc_referral_benefits_user_status_idx").on(t.userId, t.status),
]);
