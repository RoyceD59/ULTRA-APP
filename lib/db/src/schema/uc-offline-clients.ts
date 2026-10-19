import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, json, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Manually logged offline client sales — clients who purchased directly from
 * the sales team and never registered in the UC Companion app.
 * These entries are included in UC Impact metrics automatically.
 */

export interface OfflineProduct {
  lineId?: string;
  /** Server-owned unit identities. Removed units are never recycled. */
  unitIds?: string[];
  productId?:     number;   // maps to PRODUCT_LITRES capacity map on the server
  productName:    string;   // display name (always required)
  quantity:       number;
  litresPerUnit?: number;   // override when productId is not in the capacity map
}

export const ucOfflineClientsTable = pgTable("uc_offline_clients", {
  id:        serial("id").primaryKey(),
  clientRef: text("client_ref").notNull().default(""),   // optional name / phone / ref
  phone:     text("phone"),                              // optional E.164-style phone number
  email:     text("email"),                              // optional RFC-valid email address
  products:  json("products").$type<OfflineProduct[]>().notNull().default([]),
  saleDate:  text("sale_date").notNull(),                // YYYY-MM-DD
  notes:     text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Client supplied key used to make sale creation safe to retry. */
  idempotencyKey: text("idempotency_key").notNull().default(""),
  companionUserId: integer("companion_user_id"),
  accountSetupStatus: text("account_setup_status").notNull().default("pending"),
  deliveryChannel: text("delivery_channel"),
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  deliveryMetadata: json("delivery_metadata").$type<Record<string, unknown>>().notNull().default({}),
  conflictReason: text("conflict_reason"),
  deliveryJobKey: text("delivery_job_key"),
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
  deliveryLastAttemptAt: timestamp("delivery_last_attempt_at", { withTimezone: true }),
  deliveryError: text("delivery_error"),
  deliveryClaimToken: text("delivery_claim_token"),
  deliveryClaimExpiresAt: timestamp("delivery_claim_expires_at", { withTimezone: true }),
  /** Credential version installed by the active delivery claim; internal only. */
  issuedCredentialVersion: integer("issued_credential_version"),
}, (table) => [
  index("uc_offline_clients_companion_user_idx").on(table.companionUserId),
  index("uc_offline_clients_idempotency_idx").on(table.idempotencyKey),
  // Legacy rows have the empty default. Only non-empty client keys are unique.
  uniqueIndex("uc_offline_clients_idempotency_unique")
    .on(table.idempotencyKey)
    .where(sql`${table.idempotencyKey} <> ''`),
]);

export type UcOfflineClient = typeof ucOfflineClientsTable.$inferSelect;
