import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Stores per-user notification opt-out preferences, independent of push token
 * registration. This means a user can set their preferences before granting
 * push permission — prefs are then synced into uc_push_tokens when a token
 * is eventually registered.
 */
export const ucNotifPrefsTable = pgTable("uc_notif_prefs", {
  userId:       text("user_id").primaryKey(),
  optOutOrders: boolean("opt_out_orders").notNull().default(false),
  // ── Filter-reminder delivery channels (strictly opt-in — default false) ──
  // When enabled, the daily reminder-dispatch job also sends the filter
  // lifecycle messages through the corresponding external channel.
  reminderEmail:    boolean("reminder_email").notNull().default(false),
  reminderSms:      boolean("reminder_sms").notNull().default(false),
  reminderWhatsapp: boolean("reminder_whatsapp").notNull().default(false),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcNotifPref = typeof ucNotifPrefsTable.$inferSelect;
