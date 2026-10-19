import { pgTable, pgSequence, integer, text, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A separate namespace prevents an old numeric store URL/cart from silently
// becoming a different app product. Legacy mappings require explicit review.
export const ucCatalogueIdSequence = pgSequence("uc_catalogue_id_seq", { startWith: 1000000 });
export const ucCatalogueInventoryTable = pgTable("uc_catalogue_inventory", {
  id: integer("id").primaryKey().default(sql`nextval('uc_catalogue_id_seq')`),
  code: text("code").notNull(),
  sku: text("sku").notNull().unique(),
  parentSku: text("parent_sku"),
  stockStatus: text("stock_status").notNull().default("unknown"),
  stockQuantity: integer("stock_quantity"),
  manageStock: boolean("manage_stock").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  revision: integer("revision").notNull().default(1),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const ucInventoryReservationsTable = pgTable("uc_inventory_reservations", {
  orderId: integer("order_id").notNull(),
  inventoryId: integer("inventory_id").notNull().references(() => ucCatalogueInventoryTable.id),
  quantity: integer("quantity").notNull(),
  state: text("state").notNull().default("reserved"),
}, t => [uniqueIndex("uc_inventory_reservation_order_item").on(t.orderId, t.inventoryId)]);
export const ucInventoryAuditTable = pgTable("uc_inventory_audit", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  inventoryId: integer("inventory_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  revision: integer("revision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertUcCatalogueInventorySchema = createInsertSchema(ucCatalogueInventoryTable);
export type InsertUcCatalogueInventory = z.infer<typeof insertUcCatalogueInventorySchema>;
export type UcCatalogueInventory = typeof ucCatalogueInventoryTable.$inferSelect;
