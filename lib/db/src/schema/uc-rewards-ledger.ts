import { pgTable, serial, integer, text, varchar, timestamp, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ucUsersTable } from "./uc-users.js";

/**
 * Auditable ledger of every points credit (and future debit) for UC Rewards.
 * Points are only credited (earned) for now; redemption is deferred.
 *
 * refId encodes a cycle-scoped idempotency key:
 *   "<userId>:<productId>:<activatedAtMs>:<stageKey>"  (automated credits)
 *   null  (manual admin grants — no dedup needed)
 * The partial unique index on (user_id, ref_id) WHERE ref_id IS NOT NULL
 * prevents duplicate credits from concurrent dispatch runs or retries.
 */
export const ucRewardsLedgerTable = pgTable("uc_rewards_ledger", {
  id:        serial("id").primaryKey(),
  /** uc_users.id — the customer receiving the points */
  userId:    integer("user_id").notNull().references(() => ucUsersTable.id),
  /** Positive = credit; negative = debit (future). */
  points:    integer("points").notNull(),
  /** Human-readable description, e.g. "Filter replacement reward" */
  reason:    varchar("reason", { length: 500 }).notNull(),
  /** Matches ucRewardsRulesTable.eventType; "manual" for admin grants */
  eventType: varchar("event_type", { length: 100 }).notNull(),
  /**
   * Cycle-scoped idempotency key for automated credits:
   *   "<userId>:<productId>:<activatedAtMs>:<stageKey>"
   * Null for manual admin grants. The unique index below prevents
   * double-crediting the same stage within the same filter lifecycle cycle.
   */
  refId:     text("ref_id"),
  /** Admin email when granted manually; null for automated credits */
  grantedBy: varchar("granted_by", { length: 255 }),
  /** Immutable conversion rule applied to redemptions; null for awards. */
  conversionMode: text("conversion_mode"),
  conversionValue: numeric("conversion_value", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Partial unique index: dedup automated credits by (user, ref), skip manual (null refId)
  uniqueIndex("uc_rewards_ledger_user_ref_idx")
    .on(t.userId, t.refId)
    .where(sql`${t.refId} IS NOT NULL`),
  // Covering index for balance queries and ledger listings
  index("uc_rewards_ledger_user_created_idx").on(t.userId, t.createdAt),
]);

export type UcRewardsLedgerEntry = typeof ucRewardsLedgerTable.$inferSelect;
