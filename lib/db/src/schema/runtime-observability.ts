import { pgTable, text, timestamp, integer, jsonb, primaryKey, index } from "drizzle-orm/pg-core";

// Only validated, bounded operational metadata belongs in these tables.
export const runtimeDiagnosticsTable = pgTable("runtime_diagnostics", {
  fingerprint: text("fingerprint").notNull(),
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  environment: text("environment").notNull(),
  metadata: jsonb("metadata").notNull(),
  count: integer("count").notNull().default(1),
  lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.fingerprint, t.bucket] }), index("runtime_diagnostics_expiry_idx").on(t.bucket)]);

export const runtimeHealthTable = pgTable("runtime_health_samples", {
  environment: text("environment").notNull(),
  key: text("key").notNull(),
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  sample: jsonb("sample").notNull(),
}, t => [primaryKey({ columns: [t.environment, t.key, t.bucket] }), index("runtime_health_expiry_idx").on(t.bucket)]);

export const runtimeMetricsTable = pgTable("runtime_api_metrics", {
  environment: text("environment").notNull(),
  instance: text("instance").notNull(),
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  route: text("route").notNull(),
  method: text("method").notNull(),
  summary: jsonb("summary").notNull(),
}, t => [primaryKey({ columns: [t.environment, t.instance, t.bucket, t.route, t.method] }), index("runtime_metrics_expiry_idx").on(t.bucket)]);

export const runtimeLimitsTable = pgTable("runtime_ingestion_limits", {
  key: text("key").notNull(),
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
}, t => [primaryKey({ columns: [t.key, t.bucket] })]);

export const runtimeIncidentTable = pgTable("runtime_incidents", {
  environment: text("environment").notNull(),
  key: text("key").notNull(),
  state: text("state").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  delivery: text("delivery").notNull().default("disabled"),
}, t => [primaryKey({ columns: [t.environment, t.key] })]);

export const runtimeConfigTable = pgTable("runtime_observability_config", {
  environment: text("environment").primaryKey(),
  mode: text("mode").notNull().default("off"),
  destination: text("destination").notNull().default("slack"),
});