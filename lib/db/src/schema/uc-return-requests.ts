import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Customer return/refund requests for UC Companion orders.
 *
 * Historical note: this table was originally created by a raw-SQL startup
 * migration in the API server (which still runs CREATE TABLE IF NOT EXISTS
 * for backwards compatibility). The definition here matches that DDL exactly
 * so `drizzle-kit push` sees no drift against existing databases.
 */
export const ucReturnRequestsTable = pgTable(
  "uc_return_requests",
  {
    id:        serial("id").primaryKey(),
    orderId:   integer("order_id").notNull(),
    userId:    integer("user_id").notNull(),
    reason:    text("reason").notNull(),
    details:   text("details").notNull().default(""),
    status:    text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uc_return_requests_order_user_idx").on(t.orderId, t.userId),
  ]
);

export const insertUcReturnRequestSchema = createInsertSchema(
  ucReturnRequestsTable
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUcReturnRequest = z.infer<typeof insertUcReturnRequestSchema>;
export type UcReturnRequest = typeof ucReturnRequestsTable.$inferSelect;
