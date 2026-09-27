import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

/**
 * Stores the Google OAuth 2.0 credential for private Google Sheets access.
 * Only one row is expected at a time (the current active credential).
 * Refresh tokens are stored here so the nightly scheduler can re-authenticate.
 */
export const googleOAuthCredentialsTable = pgTable("google_oauth_credentials", {
  id: serial("id").primaryKey(),
  googleEmail: text("google_email").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GoogleOAuthCredential = typeof googleOAuthCredentialsTable.$inferSelect;
