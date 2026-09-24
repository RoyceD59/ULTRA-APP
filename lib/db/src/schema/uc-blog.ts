import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type BlogSource = { title: string; url: string; publisher?: string };
export type BlogSnapshot = {
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  tags: string[];
  sources: BlogSource[];
  publishedAt: string;
  version: number;
};

export const ucBlogArticlesTable = pgTable("uc_blog_articles", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  body: text("body").notNull().default(""),
  category: text("category").notNull().default("Water education"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  sources: jsonb("sources").$type<BlogSource[]>().notNull().default([]),
  origin: text("origin").$type<"human" | "upload" | "brief" | "weekly" | "agent">().notNull().default("human"),
  status: text("status").$type<"draft" | "rejected" | "published">().notNull().default("draft"),
  rationale: text("rationale"),
  rejectionFeedback: text("rejection_feedback"),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  publishedBy: text("published_by"),
  version: text("version").notNull().default("1"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedSnapshot: jsonb("published_snapshot").$type<BlogSnapshot>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_blog_articles_slug_idx").on(t.slug),
  uniqueIndex("uc_blog_articles_published_slug_idx")
    .on(sql`(${t.publishedSnapshot}->>'slug')`)
    .where(sql`${t.status} = 'published' AND ${t.publishedSnapshot} IS NOT NULL`),
  index("uc_blog_articles_status_updated_idx").on(t.status, t.updatedAt),
]);

export const ucBlogArticleHistoryTable = pgTable("uc_blog_article_history", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => ucBlogArticlesTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  rationale: text("rationale"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("uc_blog_article_history_article_created_idx").on(t.articleId, t.createdAt),
]);

export const ucBlogTopicsTable = pgTable("uc_blog_topics", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  rationale: text("rationale").notNull(),
  provenance: text("provenance").$type<"alison_aggregate" | "external_research" | "projecthub_brief" | "agent">().notNull(),
  runId: text("run_id"),
  sourceUrl: text("source_url"),
  status: text("status").$type<"proposed" | "drafted" | "skipped">().notNull().default("proposed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("uc_blog_topics_created_idx").on(t.createdAt),
]);

export const ucBlogRunsTable = pgTable("uc_blog_runs", {
  id: text("id").primaryKey(),
  runKey: text("run_key").notNull(),
  runType: text("run_type").$type<"weekly" | "brief">().notNull(),
  status: text("status").$type<"queued" | "running" | "completed" | "failed">().notNull().default("queued"),
  requestedBy: text("requested_by"),
  brief: text("brief"),
  resultSummary: text("result_summary"),
  error: text("error"),
  topics: jsonb("topics").$type<Array<Record<string, unknown>>>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("uc_blog_runs_run_key_idx").on(t.runKey),
  index("uc_blog_runs_created_idx").on(t.createdAt),
]);

export const insertUcBlogArticleSchema = createInsertSchema(ucBlogArticlesTable);
export const insertUcBlogRunSchema = createInsertSchema(ucBlogRunsTable);
export type UcBlogArticle = typeof ucBlogArticlesTable.$inferSelect;
export type UcBlogArticleHistory = typeof ucBlogArticleHistoryTable.$inferSelect;
export type UcBlogTopic = typeof ucBlogTopicsTable.$inferSelect;
export type UcBlogRun = typeof ucBlogRunsTable.$inferSelect;
export type InsertUcBlogArticle = z.infer<typeof insertUcBlogArticleSchema>;