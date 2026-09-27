import {
  pgTable,
  text,
  serial,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const systemStatusTable = pgTable("system_status", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull().unique(), // e.g. 'team-ai-embedded'
  status: text("status").notNull().default("connected"), // connected | degraded | disconnected
  lastChecked: timestamp("last_checked", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSync: timestamp("last_sync", { withTimezone: true }),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertSystemStatusSchema = createInsertSchema(
  systemStatusTable
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSystemStatus = z.infer<typeof insertSystemStatusSchema>;
export type SystemStatus = typeof systemStatusTable.$inferSelect;
