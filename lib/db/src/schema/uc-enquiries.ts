import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Stores product enquiries submitted via the app.
 * userId is nullable — a guest user (not logged in) can still enquire.
 */
export const ucEnquiriesTable = pgTable("uc_enquiries", {
  id:          serial("id").primaryKey(),
  userId:      text("user_id"),   // null for anonymous / guest
  productId:   text("product_id").notNull(),
  productName: text("product_name").notNull(),
  name:        text("name").notNull(),
  email:       text("email").notNull(),
  phone:       text("phone").notNull(),
  message:     text("message").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcEnquiry = typeof ucEnquiriesTable.$inferSelect;
export type InsertUcEnquiry = typeof ucEnquiriesTable.$inferInsert;
