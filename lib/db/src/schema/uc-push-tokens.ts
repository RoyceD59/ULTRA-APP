import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * Stores one Expo push token per user plus their server-side notification
 * opt-out preferences.
 *
 * `userId` is the stable string identity extracted from the JWT.
 * Upserted on every token registration — re-installs always replace the token.
 */
export const ucPushTokensTable = pgTable("uc_push_tokens", {
  userId:        text("user_id").primaryKey(),
  pushToken:     text("push_token").notNull(),
  optOutOrders:  boolean("opt_out_orders").notNull().default(false),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcPushToken = typeof ucPushTokensTable.$inferSelect;
