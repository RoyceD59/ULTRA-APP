import {
  pgTable,
  text,
  serial,
  timestamp,
  date,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { membersTable } from "./members";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  assigneeId: integer("assignee_id").references(() => membersTable.id, {
    onDelete: "set null",
  }),
  dueDate: date("due_date", { mode: "string" }),
  // Team Horizon orchestration fields
  sourcePlatform: text("source_platform"), // e.g. 'team-ai-embedded', 'manual'
  resourceRequired: jsonb("resource_required"), // flexible resource allocation object
  deliveryFormat: text("delivery_format"), // 'pdf' | 'csv' | 'summary'
  notifyVia: text("notify_via"), // 'email' | 'whatsapp' | 'both'
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
