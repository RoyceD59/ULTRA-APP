import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Tracks products a UC user wants to be notified about when they come back
 * into stock. One row per (userId, productId) pair.
 *
 * `notifiedRestockAt` is set the first time the restock check job sends a
 * push notification for this product. It is reset to NULL when the product
 * goes back out of stock so the user is notified again on the next restock.
 */
export const ucWishlistTable = pgTable(
  "uc_wishlist",
  {
    id:                 serial("id").primaryKey(),
    /** String representation of the numeric UC user id (matches uc_push_tokens.user_id). */
    userId:             text("user_id").notNull(),
    /** WooCommerce product id. */
    productId:          integer("product_id").notNull(),
    /** Cached display name so we can show it in notifications without an extra WC lookup. */
    productName:        text("product_name").notNull(),
    addedAt:            timestamp("added_at",             { withTimezone: true }).notNull().defaultNow(),
    /** Null = not yet notified after most-recent out-of-stock period. */
    notifiedRestockAt:  timestamp("notified_restock_at",  { withTimezone: true }),
  },
  (t) => [unique("uc_wishlist_user_product_uniq").on(t.userId, t.productId)],
);

export type UcWishlistItem = typeof ucWishlistTable.$inferSelect;
