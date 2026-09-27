import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Team-managed product media overlay. Rows are merged into product responses
 * on top of the base catalogue images (mock or WooCommerce), so the team can
 * add extra photos and a product video without touching the source catalogue.
 * `url` is a relative API path ("/api/uc/product-images/…" or
 * "/api/storage/objects/…") or an absolute http(s) URL.
 */
export const ucProductMediaTable = pgTable("uc_product_media", {
  id:        serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  type:      text("type").notNull(), // "photo" | "video"
  url:       text("url").notNull(),
  alt:       text("alt").notNull().default(""),
  position:  integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcProductMedia = typeof ucProductMediaTable.$inferSelect;
