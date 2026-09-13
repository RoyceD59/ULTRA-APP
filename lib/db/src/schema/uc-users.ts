import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Stores registered Ultra-Clear Companion user accounts.
 * Passwords are stored as bcrypt hashes — never plaintext.
 * The `id` serial becomes the JWT `sub` (subject) on login.
 */
export const ucUsersTable = pgTable("uc_users", {
  id:           serial("id").primaryKey(),
  email:        text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  phone:        text("phone").notNull().default(""),
  /** Explicit channel-verification state used for account recovery delivery. */
  emailVerified: boolean("email_verified").notNull().default(false),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  firstName:    text("first_name").notNull(),
  lastName:     text("last_name").notNull().default(""),
  isAdmin:      boolean("is_admin").notNull().default(false),
  /** Clerk user id when the account was created/linked via social sign-in
   *  (Google / Apple). Null for password-only accounts. */
  clerkUserId:  text("clerk_user_id").unique(),
  /** "password" (default), "social", or "woocommerce". Externally authenticated
   *  accounts hold a random sentinel in passwordHash that can never be used. */
  authProvider: text("auth_provider").notNull().default("password"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Delivery address as entered by the customer (free-form text). */
  address:      text("address").notNull().default(""),
  /** Set when the customer exercises their GDPR/PDPA right to erasure.
   *  Any still-valid bearer token for this userId is rejected by DB-anchored
   *  customer routes once this timestamp is set. */
  deletedAt:          timestamp("deleted_at", { withTimezone: true }),
  /** Incremented on every password reset. Included in issued JWTs so that any
   *  token minted before the reset is rejected by the guard, invalidating all
   *  active sessions immediately after a successful password change. */
  credentialVersion:  integer("credential_version").notNull().default(0),
  /** Set while an operator-issued temporary password is the only credential
   * accepted. The timestamp is cleared atomically with the permanent change. */
  temporaryPasswordExpiresAt: timestamp("temporary_password_expires_at", { withTimezone: true }),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** SHA-256 of the permanent, opaque Rewards QR token. */
  rewardsQrHash:     text("rewards_qr_hash"),
  rewardsQrRevokedAt: timestamp("rewards_qr_revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("uc_users_rewards_qr_hash_idx")
    .on(table.rewardsQrHash)
    .where(sql`${table.rewardsQrHash} IS NOT NULL`),
]);

export type UcUser = typeof ucUsersTable.$inferSelect;
