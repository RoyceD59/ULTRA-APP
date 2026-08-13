import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

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
  firstName:    text("first_name").notNull(),
  lastName:     text("last_name").notNull().default(""),
  isAdmin:      boolean("is_admin").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set when the customer exercises their GDPR/PDPA right to erasure.
   *  Any still-valid bearer token for this userId is rejected by DB-anchored
   *  customer routes once this timestamp is set. */
  deletedAt:    timestamp("deleted_at", { withTimezone: true }),
});

export type UcUser = typeof ucUsersTable.$inferSelect;
