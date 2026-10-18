import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { ucUsersTable } from "./uc-users";

/** Stock interest only: never an order, payment, account or inventory reservation. */
export const ucRestockRequestsTable = pgTable("uc_restock_requests", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => ucUsersTable.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  name: text("name"),
  phone: text("phone"),
  location: text("location"),
  productCode: text("product_code").notNull(),
  productName: text("product_name").notNull(),
  productSlug: text("product_slug").notNull(),
  parentSku: text("parent_sku").notNull(),
  variantSku: text("variant_sku"),
  variantLabel: text("variant_label"),
  status: text("status").notNull().default("pending"),
  requestKey: text("request_key").notNull(),
  demandKey: text("demand_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, table => [
  check("uc_restock_requests_kind_check", sql`${table.kind} IN ('guest', 'customer')`),
  check("uc_restock_requests_status_check", sql`${table.status} IN ('pending', 'contacted', 'resolved')`),
  uniqueIndex("uc_restock_requests_retry_uniq").on(table.requestKey),
  uniqueIndex("uc_restock_requests_open_uniq").on(table.demandKey)
    .where(sql`${table.status} IN ('pending', 'contacted')`),
  index("uc_restock_requests_status_created_idx").on(table.status, table.createdAt),
  index("uc_restock_requests_customer_idx").on(table.customerId),
]);
