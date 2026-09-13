import { bigserial, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { teamUsersTable } from "./team-users";

/**
 * Append-only audit trail for accepted referral alert threshold changes.
 * Actor display fields are snapshotted so historical entries remain readable
 * if the team member later changes their profile.
 */
export const referralAlertThresholdChangesTable = pgTable(
  "referral_alert_threshold_changes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorTeamUserId: text("actor_team_user_id")
      .notNull()
      .references(() => teamUsersTable.id),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    previousValue: integer("previous_value").notNull(),
    newValue: integer("new_value").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type ReferralAlertThresholdChange =
  typeof referralAlertThresholdChangesTable.$inferSelect;