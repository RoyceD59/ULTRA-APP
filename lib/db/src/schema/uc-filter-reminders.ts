import { pgTable, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Server-side mirror of each customer's registered filter activation.
 *
 * The mobile app tracks one active filter per user in AsyncStorage and
 * schedules local push notifications for the 5-stage lifecycle. This table
 * receives a copy of that activation (synced by the app on register /
 * lifespan-correction / removal) so the daily reminder-dispatch job can also
 * deliver the same lifecycle messages via email / SMS / WhatsApp for users
 * who opted in (uc_notif_prefs.reminder_* flags).
 *
 * One row per user — mirrors the app's single-activation model.
 * `sentStages` records which lifecycle stages have already been dispatched
 * externally for the current cycle; it is reset whenever the cycle changes
 * (new product or new activation date).
 */
export const ucFilterRemindersTable = pgTable("uc_filter_reminders", {
  userId:        text("user_id").primaryKey(),
  productId:     integer("product_id").notNull(),
  productName:   text("product_name").notNull(),
  /** Rated lifespan in days. 0 = untrackable — the dispatcher skips these. */
  lifespanDays:  integer("lifespan_days").notNull().default(0),
  activatedAt:   timestamp("activated_at", { withTimezone: true }).notNull(),
  /** WooCommerce order id when registered via receipt; null for catalogue registrations. */
  sourceOrderId: integer("source_order_id"),
  /** Lifecycle stage keys already dispatched (or skipped as stale) this cycle. */
  sentStages:    jsonb("sent_stages").$type<string[]>().notNull().default([]),
  /** Soft disable — set true when the user clears their activation in the app. */
  active:        boolean("active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcFilterReminder = typeof ucFilterRemindersTable.$inferSelect;
