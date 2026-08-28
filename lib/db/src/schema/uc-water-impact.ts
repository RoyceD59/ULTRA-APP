import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { ucUsersTable } from "./uc-users.js";
import { ucRegisteredFiltersTable } from "./uc-registered-filters.js";

/** Append-only personal water-impact ledger. Negative entries are corrections. */
export const ucWaterImpactLedgerTable = pgTable("uc_water_impact_ledger", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => ucUsersTable.id),
  registeredFilterId: integer("registered_filter_id").notNull().references(() => ucRegisteredFiltersTable.id),
  litres: integer("litres").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_water_impact_idempotency_idx").on(t.userId, t.idempotencyKey),
  index("uc_water_impact_user_created_idx").on(t.userId, t.createdAt),
  index("uc_water_impact_filter_idx").on(t.registeredFilterId, t.createdAt),
]);

export type UcWaterImpactLedgerEntry = typeof ucWaterImpactLedgerTable.$inferSelect;