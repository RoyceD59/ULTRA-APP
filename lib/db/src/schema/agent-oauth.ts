import { pgTable, text, timestamp, json, uniqueIndex, index, bigserial } from "drizzle-orm/pg-core";

export const agentOauthClientsTable = pgTable("agent_oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  secretHash: text("secret_hash").notNull(),
  scopes: json("scopes").$type<string[]>().notNull().default([]),
  status: text("status").$type<"active" | "suspended" | "revoked">().notNull().default("active"),
  createdBy: text("created_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_oauth_clients_status_idx").on(t.status),
]);

export const agentOauthTokensTable = pgTable("agent_oauth_tokens", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  clientId: text("client_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  scopes: json("scopes").$type<string[]>().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("agent_oauth_tokens_hash_idx").on(t.tokenHash),
  index("agent_oauth_tokens_client_idx").on(t.clientId),
  index("agent_oauth_tokens_expiry_idx").on(t.expiresAt),
]);

export const agentOauthAuditTable = pgTable("agent_oauth_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  clientId: text("client_id"),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  target: text("target"),
  scopes: json("scopes").$type<string[]>().notNull().default([]),
  outcome: text("outcome").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_oauth_audit_created_idx").on(t.createdAt),
  index("agent_oauth_audit_client_idx").on(t.clientId),
]);

export const agentOauthApprovalsTable = pgTable("agent_oauth_approvals", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  parametersHash: text("parameters_hash").notNull(),
  approvedBy: text("approved_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_oauth_approvals_client_idx").on(t.clientId),
]);