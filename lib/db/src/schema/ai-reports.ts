import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Durable storage for AI Monitor project status reports.
 *
 * The API previously kept only an in-process `latestReport` — a restart wiped
 * it and silently forced a regeneration (a fresh Claude call). Every generated
 * report is now inserted here; readers load the newest row when the in-memory
 * cache is cold, so the latest report survives API restarts.
 */
export const aiReportsTable = pgTable("ai_reports", {
  id:          serial("id").primaryKey(),
  summary:     text("summary").notNull(),
  highlights:  jsonb("highlights").$type<string[]>().notNull().default([]),
  risks:       jsonb("risks").$type<string[]>().notNull().default([]),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiReportSchema = createInsertSchema(aiReportsTable).omit({ id: true });
export type InsertAiReport = z.infer<typeof insertAiReportSchema>;
export type AiReportRow = typeof aiReportsTable.$inferSelect;
