import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Metadata-only audit trail for Companion password recovery. No contacts or secrets. */
export const ucPasswordResetAuditTable = pgTable("uc_password_reset_audit", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorType: text("actor_type").notNull(), // self | team
  actorId: text("actor_id"),
  targetUserId: text("target_user_id"),
  channel: text("channel"), // email | whatsapp; never the address/number
  result: text("result").notNull(), // issued | completed | delivery_failed | rejected
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcPasswordResetAudit = typeof ucPasswordResetAuditTable.$inferSelect;