import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ucCommerceMigrationTable = pgTable("uc_commerce_migration", {
  key: text("key").primaryKey(),
  state: text("state").notNull().default("pending_review"),
  summary: jsonb("summary").notNull().default({}).$type<Record<string, number>>(),
  reviewedBy: text("reviewed_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const ucLegacyOrderImportsTable = pgTable("uc_legacy_order_imports", {
  wooOrderId: integer("woo_order_id").primaryKey(),
  digest: text("digest").notNull(),
  localOrderId: integer("local_order_id"),
  state: text("state").notNull(),
  // Protected staging data, never returned by a public/customer route.
  snapshot: jsonb("snapshot").notNull(),
  reviewedBy: text("reviewed_by"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});
export const ucLegacyCustomerLinksTable = pgTable("uc_legacy_customer_links", {
  wooCustomerId: integer("woo_customer_id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  reviewedBy: text("reviewed_by").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertUcLegacyOrderImportSchema = createInsertSchema(ucLegacyOrderImportsTable);
export type InsertUcLegacyOrderImport = z.infer<typeof insertUcLegacyOrderImportSchema>;
