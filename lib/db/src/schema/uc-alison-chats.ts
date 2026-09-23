import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const ucAlisonConversationsTable = pgTable("uc_alison_conversations", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("uc_alison_conversations_cursor_idx").on(t.createdAt, t.id),
  index("uc_alison_conversations_expiry_idx").on(t.createdAt),
]);

export const ucAlisonTurnsTable = pgTable("uc_alison_turns", {
  conversationId: text("conversation_id").notNull()
    .references(() => ucAlisonConversationsTable.id, { onDelete: "cascade" }),
  turnId: text("turn_id").notNull(),
  userMessage: text("user_message").notNull(),
  assistantMessage: text("assistant_message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.conversationId, t.turnId] }),
  index("uc_alison_turns_order_idx").on(t.conversationId, t.createdAt, t.turnId),
]);

export type UcAlisonConversation = typeof ucAlisonConversationsTable.$inferSelect;
export type UcAlisonTurn = typeof ucAlisonTurnsTable.$inferSelect;