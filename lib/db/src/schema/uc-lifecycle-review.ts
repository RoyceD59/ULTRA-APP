import { bigserial, bigint, integer, jsonb, pgTable, text, timestamp, date, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ucUsersTable } from "./uc-users.js";
import { ucCanonicalPurchasesTable, ucCanonicalPurchaseLinesTable } from "./uc-canonical-purchases.js";

export const ucIdentityConflictsTable = pgTable("uc_identity_conflicts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  principalType: text("principal_type").notNull(),
  principalReference: text("principal_reference").notNull(),
  candidateCustomerIds: jsonb("candidate_customer_ids").$type<number[]>().notNull().default([]),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  resolvedCustomerId: integer("resolved_customer_id").references(() => ucUsersTable.id),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("uc_identity_conflicts_status_check", sql`${t.status} IN ('open','in_review','resolved')`),
  index("uc_identity_conflicts_queue_idx").on(t.status, t.createdAt),
  index("uc_identity_conflicts_principal_idx").on(t.principalType, t.principalReference),
]);

export const ucReconciliationConflictsTable = pgTable("uc_reconciliation_conflicts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  conflictType: text("conflict_type").notNull(),
  canonicalPurchaseId: bigint("canonical_purchase_id", { mode: "number" })
    .references(() => ucCanonicalPurchasesTable.id),
  purchaseLineId: bigint("purchase_line_id", { mode: "number" })
    .references(() => ucCanonicalPurchaseLinesTable.id),
  source: text("source").notNull(),
  sourceReference: text("source_reference").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  priority: integer("priority").notNull().default(0),
  assignedTo: text("assigned_to"),
  resolution: text("resolution"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("uc_reconciliation_conflicts_status_check", sql`${t.status} IN ('open','in_review','resolved')`),
  uniqueIndex("uc_reconciliation_conflicts_open_source_unique")
    .on(t.source, t.sourceReference, t.reason)
    .where(sql`${t.status} IN ('open', 'in_review')`),
  index("uc_reconciliation_conflicts_queue_idx").on(t.status, t.priority, t.createdAt),
  index("uc_reconciliation_conflicts_purchase_idx").on(t.canonicalPurchaseId),
]);

export const ucLegacyRegistrationReviewsTable = pgTable("uc_legacy_registration_reviews", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: integer("customer_id").notNull().references(() => ucUsersTable.id),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  approximatePurchaseDate: date("approximate_purchase_date", { mode: "string" }),
  installationDate: date("installation_date", { mode: "string" }),
  receiptReference: text("receipt_reference"),
  serialOrQrReference: text("serial_or_qr_reference"),
  sellerChannel: text("seller_channel"),
  evidenceObjectPath: text("evidence_object_path"),
  status: text("status").notNull().default("pending_review"),
  customerMessage: text("customer_message"),
  decisionReason: text("decision_reason"),
  canonicalPurchaseId: bigint("canonical_purchase_id", { mode: "number" })
    .references(() => ucCanonicalPurchasesTable.id),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  resultSnapshot: jsonb("result_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("uc_legacy_registration_reviews_status_check", sql`${t.status} IN ('pending_review','approved','rejected','correction_requested')`),
  uniqueIndex("uc_legacy_registration_reviews_customer_idempotency_unique")
    .on(t.customerId, t.idempotencyKey),
  index("uc_legacy_registration_reviews_queue_idx").on(t.status, t.createdAt),
  index("uc_legacy_registration_reviews_customer_idx").on(t.customerId, t.createdAt),
]);

export const ucLegacyRegistrationDecisionsTable = pgTable("uc_legacy_registration_decisions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewId: bigint("review_id", { mode: "number" }).notNull()
    .references(() => ucLegacyRegistrationReviewsTable.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  resultSnapshot: jsonb("result_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_legacy_registration_decisions_review_actor_key_unique")
    .on(t.reviewId, t.actor, t.idempotencyKey),
  check("uc_legacy_registration_decisions_decision_check", sql`${t.decision} IN ('approved','rejected','correction_requested','merged')`),
  index("uc_legacy_registration_decisions_review_idx").on(t.reviewId, t.createdAt),
]);

export const ucAuditEventsTable = pgTable("uc_audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actor: text("actor").notNull(),
  actorType: text("actor_type").notNull(),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  reason: text("reason"),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  resultSnapshot: jsonb("result_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  previousValue: jsonb("previous_value").$type<Record<string, unknown>>(),
  newValue: jsonb("new_value").$type<Record<string, unknown>>(),
  correlationId: text("correlation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_audit_events_actor_idempotency_unique").on(t.actor, t.idempotencyKey),
  index("uc_audit_events_resource_idx").on(t.resourceType, t.resourceId, t.createdAt),
  index("uc_audit_events_actor_idx").on(t.actor, t.createdAt),
  index("uc_audit_events_correlation_idx").on(t.correlationId),
]);

export type UcIdentityConflict = typeof ucIdentityConflictsTable.$inferSelect;
export type UcReconciliationConflict = typeof ucReconciliationConflictsTable.$inferSelect;
export type UcLegacyRegistrationReview = typeof ucLegacyRegistrationReviewsTable.$inferSelect;
export type UcLegacyRegistrationDecision = typeof ucLegacyRegistrationDecisionsTable.$inferSelect;
export type UcAuditEvent = typeof ucAuditEventsTable.$inferSelect;