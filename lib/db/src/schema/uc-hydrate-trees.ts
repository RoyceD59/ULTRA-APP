import { pgTable, integer, bigserial, bigint, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ucUsersTable } from "./uc-users.js";
import { ucCanonicalPurchasesTable } from "./uc-canonical-purchases.js";

/**
 * Hydrate the Future™ shared trees. Several customers' tree contributions
 * fill one tree; each member's Impact Card shows a copy of it. The target is
 * snapshotted per tree so a later cost change never re-prices existing trees.
 * established_at is set only from programme field verification.
 */
export const ucHydrateTreesTable = pgTable("uc_hydrate_trees", {
  treeNumber: integer("tree_number").primaryKey(),
  targetMinor: integer("target_minor").notNull(),
  establishedAt: timestamp("established_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("uc_hydrate_trees_target_check", sql`${t.targetMinor} > 0`),
]);

/**
 * One row per (purchase, tree) slice of a purchase's tree share. Rows are
 * never moved between trees; a refunded purchase is marked reversed instead.
 */
export const ucHydrateTreeContributionsTable = pgTable("uc_hydrate_tree_contributions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  canonicalPurchaseId: bigint("canonical_purchase_id", { mode: "number" }).notNull()
    .references(() => ucCanonicalPurchasesTable.id),
  customerId: integer("customer_id").notNull().references(() => ucUsersTable.id),
  treeNumber: integer("tree_number").notNull().references(() => ucHydrateTreesTable.treeNumber),
  amountMinor: integer("amount_minor").notNull(),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_hydrate_tree_contributions_purchase_tree_unique").on(t.canonicalPurchaseId, t.treeNumber),
  index("uc_hydrate_tree_contributions_customer_idx").on(t.customerId, t.createdAt),
  index("uc_hydrate_tree_contributions_tree_idx").on(t.treeNumber),
  check("uc_hydrate_tree_contributions_amount_check", sql`${t.amountMinor} > 0`),
]);

export type UcHydrateTree = typeof ucHydrateTreesTable.$inferSelect;
export type UcHydrateTreeContribution = typeof ucHydrateTreeContributionsTable.$inferSelect;
