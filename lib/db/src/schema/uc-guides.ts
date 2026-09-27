import { pgTable, text, integer, boolean, timestamp, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

export const ucGuidesTable = pgTable("uc_guides", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  category: text("category").notNull(),
  products: text("products").notNull().default(""),
  icon: text("icon").notNull().default("document-text-outline"),
  readTime: text("read_time").notNull().default("3 min read"),
  status: text("status").$type<"draft" | "published">().notNull().default("draft"),
  version: integer("version").notNull().default(1),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedSnapshot: jsonb("published_snapshot"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_guides_slug_idx").on(t.slug),
  index("uc_guides_status_updated_idx").on(t.status, t.updatedAt),
]);

export const ucGuideSectionsTable = pgTable("uc_guide_sections", {
  id: text("id").primaryKey(),
  guideId: text("guide_id").notNull().references(() => ucGuidesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  heading: text("heading").notNull(),
  body: text("body"),
  steps: text("steps").array().notNull().default([]),
  tip: text("tip"),
  warning: text("warning"),
  illustrationIcon: text("illustration_icon"),
}, (t) => [
  index("uc_guide_sections_guide_position_idx").on(t.guideId, t.position),
]);

export const ucGuideMediaTable = pgTable("uc_guide_media", {
  id: text("id").primaryKey(),
  sectionId: text("section_id").notNull().references(() => ucGuideSectionsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  kind: text("kind").$type<"image" | "animation" | "video">().notNull(),
  url: text("url").notNull(),
  objectPath: text("object_path"),
  mimeType: text("mime_type").notNull(),
  altText: text("alt_text").notNull(),
  caption: text("caption"),
  posterUrl: text("poster_url"),
  byteSize: integer("byte_size"),
  durationSeconds: integer("duration_seconds"),
  animated: boolean("animated").notNull().default(false),
}, (t) => [
  index("uc_guide_media_section_position_idx").on(t.sectionId, t.position),
]);

export type UcGuide = typeof ucGuidesTable.$inferSelect;
export type UcGuideSection = typeof ucGuideSectionsTable.$inferSelect;
export type UcGuideMedia = typeof ucGuideMediaTable.$inferSelect;