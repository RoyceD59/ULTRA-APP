import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Hashed, expiring, single-use credentials used to verify recovery contacts. */
export const ucContactVerificationTokensTable = pgTable("uc_contact_verification_tokens", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  channel: text("channel").notNull(),
  contactHash: text("contact_hash").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});