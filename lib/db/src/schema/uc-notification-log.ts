import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Audit log for every SMS and email send attempt made by the UC Companion
 * backend (sms.ts / email.ts helpers). Written non-blocking after each attempt;
 * a write failure here never propagates to the parent request.
 */
export const ucNotificationLogTable = pgTable(
  "uc_notification_log",
  {
    id:           serial("id").primaryKey(),
    channel:      text("channel").notNull(),       // 'sms' | 'email'
    provider:     text("provider").notNull().default(""),  // 'africas_talking' | 'resend' | 'sendgrid' | 'smtp' | 'none'
    recipient:    text("recipient").notNull(),      // phone or email address
    template:     text("template").notNull().default(""),
    messageBody:  text("message_body").notNull().default(""), // SMS text or email plain-text body
    orderId:      integer("order_id"),             // optional FK-ish reference
    ticketId:     text("ticket_id"),
    testId:       text("test_id"),
    status:       text("status").notNull(),         // 'sent' | 'failed'
    errorMessage: text("error_message"),
    // Resend's opaque message ID. Kept so privileged ProjectHub users can
    // retrieve delivery events without storing or exposing email contents.
    resendMessageId: text("resend_message_id"),
    // Most recent delivery event observed from Resend, e.g. accepted,
    // delivered, delayed, or bounced.
    deliveryEvent: text("delivery_event"),
    deliveryEventAt: timestamp("delivery_event_at", { withTimezone: true }),
    sentAt:       timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("uc_notification_log_sent_at_idx").on(t.sentAt),
    // Composite index for the nightly pruning job and any status-filtered,
    // time-ordered listing: WHERE status = ? AND sent_at < ?
    // Also covers status-only filters via its leading column, so the old
    // single-column uc_notification_log_status_idx is not needed.
    index("uc_notification_log_status_sent_at_idx").on(t.status, t.sentAt),
    index("uc_notification_log_recovery_delivery_idx").on(t.provider, t.template, t.sentAt),
  ]
);

export const insertUcNotificationLogSchema = createInsertSchema(
  ucNotificationLogTable
).omit({ id: true, sentAt: true });
export type InsertUcNotificationLog = z.infer<typeof insertUcNotificationLogSchema>;
export type UcNotificationLog = typeof ucNotificationLogTable.$inferSelect;
