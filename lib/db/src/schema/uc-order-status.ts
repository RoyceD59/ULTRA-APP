import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { ucOrdersTable } from "./uc-orders.js";

/** Immutable customer-visible status transition ledger. */
export const ucCustomerStageEventsTable = pgTable(
  "uc_customer_stage_events",
  {
    id: serial("id").primaryKey(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    stage: text("stage").notNull(),
    status: text("status"),
    sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }),
    sourceVersion: text("source_version"),
    idempotencyKey: text("idempotency_key").notNull(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uc_customer_stage_events_resource_key_unique").on(
      t.resourceType,
      t.resourceId,
      t.idempotencyKey,
    ),
    index("uc_customer_stage_events_resource_created_idx").on(
      t.resourceType,
      t.resourceId,
      t.createdAt,
    ),
  ],
);

/** Durable notification work item (push by default; SMS/email in payload.channel).
 * The row is created in the same transaction as the
 * order projection and event, so a provider outage cannot lose an update. */
export const ucOrderNotificationOutboxTable = pgTable(
  "uc_order_notification_outbox",
  {
    id: serial("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    orderId: integer("order_id").notNull().references(() => ucOrdersTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    stage: text("stage").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    claimToken: text("claim_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uc_order_notification_outbox_event_key_unique").on(t.eventKey),
    index("uc_order_notification_outbox_pending_idx").on(t.status, t.nextAttemptAt),
  ],
);

export type UcCustomerStageEvent = typeof ucCustomerStageEventsTable.$inferSelect;
export type UcOrderNotificationOutbox = typeof ucOrderNotificationOutboxTable.$inferSelect;