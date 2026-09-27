import { pgTable, serial, integer, text, timestamp, uniqueIndex, index, bigint, bigserial, boolean, check, AnyPgColumn, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ucUsersTable } from "./uc-users.js";
import { ucRegisteredFiltersTable } from "./uc-registered-filters.js";
import { ucCanonicalPurchaseLinesTable } from "./uc-canonical-purchases.js";

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

/** Canonical append-only lifecycle and impact events. The legacy ledger above
 * remains available for backward-compatible reads during migration. */
export const ucLifecycleImpactEventsTable = pgTable("uc_lifecycle_impact_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: integer("customer_id").references(() => ucUsersTable.id),
  registeredFilterId: integer("registered_filter_id").references(() => ucRegisteredFiltersTable.id),
  canonicalPurchaseLineId: bigint("canonical_purchase_line_id", { mode: "number" })
    .references(() => ucCanonicalPurchaseLinesTable.id),
  eventType: text("event_type").notNull(),
  source: text("source").notNull(),
  value: integer("value").notNull().default(0),
  unit: text("unit").notNull().default("litres"),
  eligible: boolean("eligible").notNull().default(false),
  actor: text("actor").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  resultSnapshot: jsonb("result_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  correctionOfEventId: bigint("correction_of_event_id", { mode: "number" })
    .references((): AnyPgColumn => ucLifecycleImpactEventsTable.id),
  correlationId: text("correlation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_lifecycle_impact_events_actor_idempotency_unique").on(t.actor, t.idempotencyKey),
  index("uc_lifecycle_impact_events_customer_created_idx").on(t.customerId, t.createdAt),
  index("uc_lifecycle_impact_events_filter_created_idx").on(t.registeredFilterId, t.createdAt),
  index("uc_lifecycle_impact_events_eligible_idx").on(t.eligible, t.createdAt),
  index("uc_lifecycle_impact_events_correction_idx").on(t.correctionOfEventId),
  check("uc_lifecycle_impact_events_type_check", sql`${t.eventType} IN ('registration','activation','deactivation','maintenance','replacement','referral_conversion','correction')`),
  check("uc_lifecycle_impact_events_unit_check", sql`${t.unit} IN ('litres','count','event')`),
  check("uc_lifecycle_impact_events_eligible_ownership_check", sql`NOT ${t.eligible} OR (${t.customerId} IS NOT NULL AND ${t.registeredFilterId} IS NOT NULL) OR (${t.customerId} IS NULL AND ${t.registeredFilterId} IS NULL AND ${t.source} = 'approved_organizational')`),
  check("uc_lifecycle_impact_events_correction_self_check", sql`${t.correctionOfEventId} IS NULL OR ${t.correctionOfEventId} <> ${t.id}`),
  check("uc_lifecycle_impact_events_correction_pair_check", sql`(${t.eventType} = 'correction') = (${t.correctionOfEventId} IS NOT NULL)`),
]);

export type UcLifecycleImpactEvent = typeof ucLifecycleImpactEventsTable.$inferSelect;