import { pgTable, serial, integer, text, timestamp, date, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ucUsersTable } from "./uc-users";
import { ucOrdersTable, ucOrderItemsTable } from "./uc-orders";
import { ucRegisteredFiltersTable } from "./uc-registered-filters";

/** Staff reservations, not accounts, payments, or impact claims. */
export const ucCustomerAssignmentsTable = pgTable("uc_customer_assignments", {
  id: serial("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  customerName: text("customer_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  lifespanDays: integer("lifespan_days").notNull(),
  capacityLitres: integer("capacity_litres").notNull(),
  installationDate: date("installation_date", { mode: "string" }).notNull(),
  orderId: integer("order_id").notNull().references(() => ucOrdersTable.id),
  orderItemId: integer("order_item_id").notNull().references(() => ucOrderItemsTable.id),
  wooOrderItemId: integer("woo_order_item_id"),
  targetAccountId: integer("target_account_id").references(() => ucUsersTable.id),
  linkedAccountId: integer("linked_account_id").references(() => ucUsersTable.id),
  filterId: integer("filter_id").references(() => ucRegisteredFiltersTable.id),
  status: text("status").notNull().default("pending"),
  reviewReason: text("review_reason"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
}, t => [
  uniqueIndex("uc_customer_assignments_key_unique").on(t.idempotencyKey),
  uniqueIndex("uc_customer_assignments_line_unique").on(t.orderItemId),
  index("uc_customer_assignments_status_id_idx").on(t.status, t.id),
  index("uc_customer_assignments_account_status_id_idx").on(t.linkedAccountId, t.status, t.id),
  check("uc_customer_assignments_status_check", sql`${t.status} IN ('pending','linked','review')`),
]);

export const ucCustomerAssignmentAuditTable = pgTable("uc_customer_assignment_audit", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull().references(() => ucCustomerAssignmentsTable.id),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("uc_customer_assignment_audit_assignment_id_idx").on(t.assignmentId, t.id),
]);