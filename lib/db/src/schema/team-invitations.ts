import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const teamInvitationsTable = pgTable("team_invitations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  invitedById: text("invited_by_id"),
  /** Optional page permissions selected by the admin before the invite is sent. */
  permissions: jsonb("permissions").$type<Record<string, string>>(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TeamInvitation = typeof teamInvitationsTable.$inferSelect;
