import { sql } from "drizzle-orm";
import { bigint, bigserial, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { teamUsersTable } from "./team-users.js";
import { ucLocationsTable } from "./uc-locations.js";

/** Append-only station decisions. No row exists until a station is reviewed. */
export const ucRefillStationActionsTable = pgTable("uc_refill_station_actions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  stationId: text("station_id").notNull().references(() => ucLocationsTable.id),
  action: text("action", { enum: ["enable", "suspend"] }).notNull(),
  actorId: text("actor_id").notNull().references(() => teamUsersTable.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("uc_refill_station_actions_latest_idx").on(t.stationId, t.id.desc()),
  check("uc_refill_station_action_valid", sql`${t.action} IN ('enable','suspend')`),
  check("uc_refill_station_reason_valid", sql`length(trim(${t.reason})) BETWEEN 8 AND 500`),
]);

/** Append-only team-user assignments, checked again on every operator request. */
export const ucRefillOperatorActionsTable = pgTable("uc_refill_operator_actions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  stationId: text("station_id").notNull().references(() => ucLocationsTable.id),
  operatorId: text("operator_id").notNull().references(() => teamUsersTable.id),
  action: text("action", { enum: ["grant", "revoke"] }).notNull(),
  stationEnableEventId: bigint("station_enable_event_id", { mode: "number" }).references(() => ucRefillStationActionsTable.id),
  actorId: text("actor_id").notNull().references(() => teamUsersTable.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("uc_refill_operator_actions_latest_idx").on(t.operatorId, t.stationId, t.id.desc()),
  check("uc_refill_operator_action_valid", sql`${t.action} IN ('grant','revoke')`),
  check("uc_refill_grant_requires_station_event", sql`${t.action} = 'revoke' OR ${t.stationEnableEventId} IS NOT NULL`),
  check("uc_refill_operator_reason_valid", sql`length(trim(${t.reason})) BETWEEN 8 AND 500`),
]);

/** Inert economic definition; approval never creates credit or opens dispensing. */
export const ucRefillCampaignVersionsTable = pgTable("uc_refill_campaign_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignKey: text("campaign_key").notNull(),
  version: integer("version").notNull(),
  stationId: text("station_id").notNull().references(() => ucLocationsTable.id),
  pricingVersion: text("pricing_version").notNull(),
  eligibilityPolicy: text("eligibility_policy", { enum: ["manual_review"] }).notNull(),
  creditMl: bigint("credit_ml", { mode: "number" }).notNull(),
  maxGrants: integer("max_grants").notNull(),
  sponsorFundingMinor: bigint("sponsor_funding_minor", { mode: "number" }).notNull(),
  cashChargeMinor: bigint("cash_charge_minor", { mode: "number" }).notNull().default(0),
  costsMinor: jsonb("costs_minor").notNull().$type<Record<string, number | null>>(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  proposalHash: text("proposal_hash").notNull(),
  proposedBy: text("proposed_by").notNull().references(() => teamUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_refill_campaign_station_version").on(t.campaignKey, t.stationId, t.version),
  index("uc_refill_campaign_versions_station_idx").on(t.stationId, t.createdAt.desc()),
  check("uc_refill_campaign_valid_window", sql`${t.endsAt} > ${t.startsAt}`),
  check("uc_refill_campaign_key_valid", sql`${t.campaignKey} ~ '^[a-z0-9][a-z0-9_-]{2,63}$'`),
  check("uc_refill_campaign_version_valid", sql`${t.version} > 0`),
  check("uc_refill_campaign_pricing_valid", sql`length(trim(${t.pricingVersion})) BETWEEN 1 AND 100`),
  check("uc_refill_campaign_eligibility_valid", sql`${t.eligibilityPolicy} = 'manual_review'`),
  check("uc_refill_campaign_quantities_valid", sql`${t.creditMl} > 0 AND ${t.maxGrants} > 0 AND ${t.sponsorFundingMinor} >= 0 AND ${t.cashChargeMinor} = 0`),
  check("uc_refill_campaign_costs_valid", sql`jsonb_typeof(${t.costsMinor}) = 'object'`),
  check("uc_refill_campaign_hash_valid", sql`${t.proposalHash} ~ '^[a-f0-9]{64}$'`),
]);

export const ucRefillCampaignActionsTable = pgTable("uc_refill_campaign_actions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  campaignVersionId: uuid("campaign_version_id").notNull().references(() => ucRefillCampaignVersionsTable.id),
  action: text("action", { enum: ["approve", "suspend"] }).notNull(),
  actorId: text("actor_id").notNull().references(() => teamUsersTable.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_refill_campaign_action_once").on(t.campaignVersionId, t.action),
  index("uc_refill_campaign_actions_latest_idx").on(t.campaignVersionId, t.id.desc()),
  check("uc_refill_campaign_action_valid", sql`${t.action} IN ('approve','suspend')`),
  check("uc_refill_campaign_action_reason_valid", sql`length(trim(${t.reason})) BETWEEN 8 AND 500`),
]);