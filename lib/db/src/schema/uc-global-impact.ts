import { pgTable, text, integer, doublePrecision, timestamp, bigserial, jsonb } from "drizzle-orm/pg-core";

export const ucGlobalImpactTable = pgTable("uc_global_impact", {
  id: text("id").primaryKey(),
  litresOffset: doublePrecision("litres_offset").notNull(),
  usersOffset: doublePrecision("users_offset").notNull(),
  revision: integer("revision").notNull(),
  lastUpdatedBy: text("last_updated_by").notNull(),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }),
  legacySha256: text("legacy_sha256"),
});

export const ucGlobalImpactAuditTable = pgTable("uc_global_impact_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  previous: jsonb("previous"),
  next: jsonb("next").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
