import { pgTable, serial, integer, text, timestamp, json, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** A single photo/video attached to a review. `url` is a relative API path
 *  (e.g. "/api/storage/objects/uploads/<id>") the app resolves against its base. */
export type ReviewMediaItem = { url: string; type: "photo" | "video" };
export type ReviewAnalysis = {
  status: "pending" | "processing" | "failed" | "unavailable" | "completed";
  version: number;
  revision?: number;
  fingerprint?: string;
  category?: "Positive" | "Neutral" | "Negative" | "Mixed";
  explanation?: string;
  themes?: string[];
  attempts?: number;
  lease?: string;
  leaseUntil?: string;
  nextAttemptAt?: string;
  analyzedAt?: string;
  error?: string;
};

/**
 * Customer product reviews for the UC Companion app.
 * `userId` follows the uc_tickets convention: stringified uc_users.id for real
 * accounts, timestamp-range ids for legacy/mock sessions.
 */
export const ucReviewsTable = pgTable("uc_reviews", {
  id:         serial("id").primaryKey(),
  productId:  integer("product_id").notNull(),
  userId:     text("user_id").notNull(),
  authorName: text("author_name").notNull().default("Customer"),
  rating:     integer("rating").notNull(), // 1–5
  title:      text("title").notNull().default(""),
  body:       text("body").notNull(),
  media:      json("media").$type<ReviewMediaItem[]>().notNull().default([]),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  textRevision: integer("text_revision").notNull().default(1),
  analysis: json("analysis").$type<ReviewAnalysis>().notNull().default({ status: "pending", version: 1 }),
}, t => [index("uc_reviews_analysis_status_idx").on(sql`(${t.analysis}->>'status')`, t.id)]);

export type UcReview = typeof ucReviewsTable.$inferSelect;
