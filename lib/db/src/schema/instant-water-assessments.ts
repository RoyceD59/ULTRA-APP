import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Durable records for instant-water-check-v1.
 *
 * These tables intentionally do not overload uc_water_tests: a public lead has
 * no Companion user yet, while the legacy table requires one.  The ticket's
 * assessment_id is unique so a physical request can only ever transition the
 * ticket created with the assessment.
 */
export const instantWaterAssessmentsTable = pgTable(
  "instant_water_assessments",
  {
    id: text("id").primaryKey(),
    reference: text("reference")
      .notNull()
      .unique("instant_water_assessments_reference_key"),
    customerUserId: text("customer_user_id"),
    firstName: text("first_name").notNull(),
    normalizedPhone: text("normalized_phone").notNull(),
    phoneVerificationState: text("phone_verification_state")
      .notNull()
      .default("unverified_lead"),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    consentGiven: text("consent_given").notNull(),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentVersion: text("consent_version").notNull(),
    country: text("country").notNull(),
    area: text("area").notNull(),
    source: text("source").notNull(),
    concern: text("concern").notNull(),
    setting: text("setting").notNull(),
    rawAnswers: jsonb("raw_answers").notNull(),
    rulesVersion: text("rules_version").notNull(),
    result: jsonb("result").notNull(),
    areaFlags: jsonb("area_flags").notNull().default({}),
    sourceAttribution: jsonb("source_attribution").notNull().default({}),
    lifecycleStatus: text("lifecycle_status")
      .notNull()
      .default("instant_result_ready"),
    accountLinkState: text("account_link_state")
      .notNull()
      .default("unverified_lead"),
    physicalRequestState: text("physical_request_state")
      .notNull()
      .default("not_requested"),
    publicTokenHash: text("public_token_hash"),
    publicTokenExpiresAt: timestamp("public_token_expires_at", {
      withTimezone: true,
    }),
    publicTokenRevokedAt: timestamp("public_token_revoked_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("instant_water_assessments_public_token_hash_idx").on(
      table.publicTokenHash,
    ),
    index("instant_water_assessments_customer_user_idx").on(
      table.customerUserId,
      table.createdAt,
    ),
    index("instant_water_assessments_phone_idx").on(table.normalizedPhone),
    index("instant_water_assessments_status_idx").on(
      table.lifecycleStatus,
      table.createdAt,
    ),
  ],
);

export const instantWaterCheckTicketsTable = pgTable(
  "instant_water_check_tickets",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => instantWaterAssessmentsTable.id, {
        onDelete: "cascade",
      }),
    customerUserId: text("customer_user_id"),
    serviceState: text("service_state")
      .notNull()
      .default("instant_result_ready"),
    country: text("country").notNull(),
    area: text("area").notNull(),
    serviceAddress: text("service_address"),
    preferredContactTime: text("preferred_contact_time"),
    physicalRequestAcknowledgedAt: timestamp(
      "physical_request_acknowledged_at",
      { withTimezone: true },
    ),
    mediaReferences: jsonb("media_references").notNull().default([]),
    internalNotes: text("internal_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("instant_water_check_tickets_assessment_idx").on(
      table.assessmentId,
    ),
    index("instant_water_check_tickets_state_idx").on(
      table.serviceState,
      table.createdAt,
    ),
    index("instant_water_check_tickets_customer_user_idx").on(
      table.customerUserId,
      table.createdAt,
    ),
  ],
);

/** Endpoint-scoped, durable 30-day idempotency records. */
export const instantWaterIdempotencyTable = pgTable(
  "instant_water_idempotency",
  {
    id: text("id").primaryKey(),
    endpoint: text("endpoint").notNull(),
    scope: text("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    assessmentId: text("assessment_id"),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("instant_water_idempotency_scope_key_idx").on(
      table.endpoint,
      table.scope,
      table.idempotencyKey,
    ),
    index("instant_water_idempotency_expires_idx").on(table.expiresAt),
  ],
);

/** OTPs are bearer credentials; only a hash is persisted. */
export const instantWaterVerificationChallengesTable = pgTable(
  "instant_water_verification_challenges",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => instantWaterAssessmentsTable.id, {
        onDelete: "cascade",
      }),
    channel: text("channel").notNull(),
    phoneHash: text("phone_hash").notNull(),
    codeHash: text("code_hash").notNull(),
    codeCiphertext: text("code_ciphertext").notNull(),
    attempts: integer("attempts").notNull().default(0),
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    deliveryErrorCategory: text("delivery_error_category"),
    deliveryNextRetryAt: timestamp("delivery_next_retry_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    deliveryClaimedAt: timestamp("delivery_claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("instant_water_verification_phone_created_idx").on(
      table.phoneHash,
      table.createdAt,
    ),
    index("instant_water_verification_assessment_idx").on(table.assessmentId),
  ],
);

/** Short-lived action credentials are scoped to one assessment. */
export const instantWaterActionTokensTable = pgTable(
  "instant_water_action_tokens",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => instantWaterAssessmentsTable.id, {
        onDelete: "cascade",
      }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("instant_water_action_tokens_assessment_idx").on(
      table.assessmentId,
      table.expiresAt,
    ),
  ],
);

export const instantWaterHandoffTokensTable = pgTable(
  "instant_water_handoff_tokens",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => instantWaterAssessmentsTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("instant_water_handoff_tokens_assessment_idx").on(table.assessmentId, table.expiresAt),
  ],
);

export const instantWaterRateLimitsTable = pgTable(
  "instant_water_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const instantWaterMediaUploadsTable = pgTable(
  "instant_water_media_uploads",
  {
    objectPath: text("object_path").primaryKey(),
    uploaderUserId: text("uploader_user_id"),
    assessmentId: text("assessment_id").references(() => instantWaterAssessmentsTable.id, { onDelete: "cascade" }),
    declaredType: text("declared_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    detectedType: text("detected_type"),
    detectedSize: integer("detected_size"),
    scanStatus: text("scan_status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("instant_water_media_uploads_assessment_idx").on(table.assessmentId),
    index("instant_water_media_uploads_uploader_idx").on(table.uploaderUserId),
  ],
);

export const instantWaterAuditEventsTable = pgTable(
  "instant_water_audit_events",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id").references(() => instantWaterAssessmentsTable.id, { onDelete: "cascade" }),
    actorTeamUserId: text("actor_team_user_id").notNull(),
    action: text("action").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("instant_water_audit_events_assessment_idx").on(table.assessmentId, table.createdAt),
    index("instant_water_audit_events_actor_idx").on(table.actorTeamUserId, table.createdAt),
  ],
);

export type InstantWaterAssessment =
  typeof instantWaterAssessmentsTable.$inferSelect;
export type InstantWaterCheckTicket =
  typeof instantWaterCheckTicketsTable.$inferSelect;
export type InstantWaterIdempotency = typeof instantWaterIdempotencyTable.$inferSelect;
export type InstantWaterVerificationChallenge =
  typeof instantWaterVerificationChallengesTable.$inferSelect;
export type InstantWaterActionToken =
  typeof instantWaterActionTokensTable.$inferSelect;
export type InstantWaterRateLimit = typeof instantWaterRateLimitsTable.$inferSelect;
export type InstantWaterMediaUpload = typeof instantWaterMediaUploadsTable.$inferSelect;
export type InstantWaterAuditEvent = typeof instantWaterAuditEventsTable.$inferSelect;