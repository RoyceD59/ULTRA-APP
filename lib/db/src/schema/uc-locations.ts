import { pgTable, text, timestamp, boolean, numeric, index } from "drizzle-orm/pg-core";

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
  active: boolean("active").notNull().default(true),
  verified: boolean("verified").notNull().default(false),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("uc_locations_public_idx").on(t.active, t.verified),
]);

export type UcLocation = typeof ucLocationsTable.$inferSelect;