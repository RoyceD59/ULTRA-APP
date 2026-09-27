import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Persisted Alison (AI water chat) feedback ratings.
 * Replaces the previous in-memory feedbackLog array so ratings survive
 * server restarts and can be queried historically.
 */
export const ucAiFeedbackTable = pgTable("uc_ai_feedback", {
  id:       serial("id").primaryKey(),
  rating:   text("rating").notNull(),   // "up" | "down"
  question: text("question").notNull(),
  answer:   text("answer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Team-written improvement suggestion for this feedback entry (max 250 chars,
  // enforced at the API layer). Null when no suggestion has been written yet.
  improvementNote:   text("improvement_note"),
  improvementNoteAt: timestamp("improvement_note_at", { withTimezone: true }),
});

export type UcAiFeedback = typeof ucAiFeedbackTable.$inferSelect;
