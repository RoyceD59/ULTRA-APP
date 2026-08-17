import { pgTable, serial, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Admin-configurable rules that map reward event types to point values.
 * Admins can edit point values and toggle rules active/inactive without
 * a code change.
 */
export const ucRewardsRulesTable = pgTable("uc_rewards_rules", {
  id:          serial("id").primaryKey(),
  /** Machine-readable event type key, e.g. "filter-replacement", "qualifying-product" */
  eventType:   varchar("event_type", { length: 100 }).notNull().unique(),
  /** Human-readable label shown in the admin panel */
  label:       varchar("label", { length: 255 }).notNull(),
  /** Points awarded when this event fires */
  pointsValue: integer("points_value").notNull().default(0),
  /** When false, this rule is skipped — no points are credited */
  active:      boolean("active").notNull().default(true),
  /** Email or identifier of the team member who last modified this rule */
  updatedBy:   varchar("updated_by", { length: 255 }),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcRewardsRule = typeof ucRewardsRulesTable.$inferSelect;
