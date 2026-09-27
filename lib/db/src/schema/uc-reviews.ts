import { pgTable, serial, integer, text, timestamp, json } from "drizzle-orm/pg-core";

/** A single photo/video attached to a review. `url` is a relative API path
 *  (e.g. "/api/storage/objects/uploads/<id>") the app resolves against its base. */
export type ReviewMediaItem = { url: string; type: "photo" | "video" };

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
});

export type UcReview = typeof ucReviewsTable.$inferSelect;
