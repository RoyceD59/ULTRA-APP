import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const notificationLogsTable = pgTable(
  "notification_logs",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id"), // optional reference to a task
    contactId: integer("contact_id"), // optional reference to a contact
    channelType: text("channel_type").notNull(), // 'email' | 'whatsapp' | 'sms'
    channelValue: text("channel_value").notNull(),
    templateId: text("template_id").notNull(), // STAKEHOLDER_UPDATE | OWNER_ALERT | RESOURCE_REQ
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    status: text("status").notNull().default("sent"), // sent | failed | fallback
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    // WhatsApp delivery receipt tracking
    whatsappMessageId: text("whatsapp_message_id"), // Baileys message key ID for receipt matching
    deliveryStatus: text("delivery_status"), // null | 'delivered' | 'read'
  },
  (t) => [
    // Lookup index for receipt updates — Baileys fires per message ID
    index("notification_logs_whatsapp_message_id_idx").on(t.whatsappMessageId),
  ]
);

export const insertNotificationLogSchema = createInsertSchema(
  notificationLogsTable
).omit({ id: true, sentAt: true });
export type InsertNotificationLog = z.infer<typeof insertNotificationLogSchema>;
export type NotificationLog = typeof notificationLogsTable.$inferSelect;
