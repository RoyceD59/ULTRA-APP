import { pgTable, serial, integer, text, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { ucUsersTable } from "./uc-users.js";

/** Durable filter registrations owned by a Companion account. */
export const ucRegisteredFiltersTable = pgTable("uc_registered_filters", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => ucUsersTable.id),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  ratedCapacityLitres: integer("rated_capacity_litres").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }).notNull(),
  sourceOrderId: integer("source_order_id"),
  source: text("source").notNull().default("legacy"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_registered_filters_source_order_product_idx")
    .on(t.source, t.sourceOrderId, t.productId),
  index("uc_registered_filters_user_active_idx").on(t.userId, t.active),
]);

export type UcRegisteredFilter = typeof ucRegisteredFiltersTable.$inferSelect;