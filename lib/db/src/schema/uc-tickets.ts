import { pgTable, text, timestamp, json } from "drizzle-orm/pg-core";

/**
 * Persists maintenance ticket submissions from the UC Companion app.
 */
export const ucTicketsTable = pgTable("uc_tickets", {
  id:                   text("id").primaryKey(),          // "TKT-<timestamp>"
  userId:               text("user_id").notNull(),
  productModel:         text("product_model").notNull(),
  issueDescription:     text("issue_description").notNull(),
  preferredContactTime: text("preferred_contact_time").notNull().default("Any time"),
  photos:               json("photos").$type<string[]>().default([]),
  videos:               json("videos").$type<string[]>().default([]),
  status:               text("status").notNull().default("submitted"),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcTicket = typeof ucTicketsTable.$inferSelect;
