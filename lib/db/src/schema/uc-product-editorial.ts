import { pgTable, text, integer, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ucProductEditorialTable = pgTable("uc_product_editorial", {
  code: text("code").primaryKey(),
  revision: integer("revision").notNull().default(1),
  record: jsonb("record").notNull().$type<Record<string, unknown>>(),
  galleryMapped: boolean("gallery_mapped").notNull().default(false),
  priceImportRevision: integer("price_import_revision").notNull().default(0),
  contentImportRevision: integer("content_import_revision").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertUcProductEditorialSchema = createInsertSchema(ucProductEditorialTable);
export type InsertUcProductEditorial = z.infer<typeof insertUcProductEditorialSchema>;
export type UcProductEditorial = typeof ucProductEditorialTable.$inferSelect;
