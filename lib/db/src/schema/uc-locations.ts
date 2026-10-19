import { pgTable, text, timestamp, boolean, numeric, index, date } from "drizzle-orm/pg-core";

/** Managed public service locations. Verification is deliberately server-audited. */
export const ucLocationsTable = pgTable("uc_locations", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
  longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
  hours: text("hours").notNull().default(""),
  phone: text("phone"),
  vendorName: text("vendor_name"),
  countryIso: text("country_iso").notNull().default("KE"),
  city: text("city"),
  accessNotes: text("access_notes"),
  municipal: text("municipal"),
  sourceAttribution: text("source_attribution"),
  active: boolean("active").notNull().default(true),
  verified: boolean("verified").notNull().default(false),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastFieldVerifiedOn: date("last_field_verified_on", { mode: "string" }),
  nextReviewOn: date("next_review_on", { mode: "string" }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("uc_locations_public_idx").on(t.active, t.verified),
]);

export type UcLocation = typeof ucLocationsTable.$inferSelect;

/** One successful team reminder per field-review cycle, surviving API restarts. */
export const ucLocationReviewAlertsTable = pgTable("uc_location_review_alerts", {
  locationId: text("location_id").primaryKey().references(() => ucLocationsTable.id, { onDelete: "cascade" }),
  reviewKey: text("review_key").notNull(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
});