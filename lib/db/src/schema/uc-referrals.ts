import { pgTable, serial, varchar, text, integer, boolean, timestamp, json, uniqueIndex, index } from "drizzle-orm/pg-core";

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
