import { integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { ucOrdersTable } from "./uc-orders";

/** Immutable staff audit trail for cash-on-delivery collection confirmations. */
export const ucCodCollectionEventsTable = pgTable("uc_cod_collection_events", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ucOrdersTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  actor: text("actor").notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("uc_cod_collection_events_order_unique").on(t.orderId),
  unique("uc_cod_collection_events_order_idempotency_unique").on(t.orderId, t.idempotencyKey),
]);

export type UcCodCollectionEvent = typeof ucCodCollectionEventsTable.$inferSelect;