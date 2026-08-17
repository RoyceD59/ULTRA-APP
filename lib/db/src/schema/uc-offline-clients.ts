import { pgTable, serial, text, timestamp, json } from "drizzle-orm/pg-core";

/**
 * Manually logged offline client sales — clients who purchased directly from
 * the sales team and never registered in the UC Companion app.
 * These entries are included in UC Impact metrics automatically.
 */

export interface OfflineProduct {
  productId?:     number;   // maps to PRODUCT_LITRES capacity map on the server
  productName:    string;   // display name (always required)
  quantity:       number;
  litresPerUnit?: number;   // override when productId is not in the capacity map
}

export const ucOfflineClientsTable = pgTable("uc_offline_clients", {
  id:        serial("id").primaryKey(),
  clientRef: text("client_ref").notNull().default(""),   // optional name / phone / ref
  phone:     text("phone"),                              // optional E.164-style phone number
  email:     text("email"),                              // optional RFC-valid email address
  products:  json("products").$type<OfflineProduct[]>().notNull().default([]),
  saleDate:  text("sale_date").notNull(),                // YYYY-MM-DD
  notes:     text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcOfflineClient = typeof ucOfflineClientsTable.$inferSelect;
