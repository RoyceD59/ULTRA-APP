import {
  pgTable,
  text,
  serial,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";

export const contactMethodsTable = pgTable("contact_methods", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id")
    .notNull()
    .references(() => contactsTable.id, { onDelete: "cascade" }),
  channelType: text("channel_type").notNull(), // 'email' | 'whatsapp' | 'sms'
  channelValue: text("channel_value").notNull(), // email address or E.164 phone
  isPreferred: boolean("is_preferred").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertContactMethodSchema = createInsertSchema(
  contactMethodsTable
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContactMethod = z.infer<typeof insertContactMethodSchema>;
export type ContactMethod = typeof contactMethodsTable.$inferSelect;
