import { pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { ucLocationsTable } from "./uc-locations";
import { ucUsersTable } from "./uc-users";

export const ucLocationRatingsTable = pgTable("uc_location_ratings", {
  id: text("id").primaryKey(),
  locationId: text("location_id").notNull().references(() => ucLocationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => ucUsersTable.id, { onDelete: "cascade" }),
  waterQuality: integer("water_quality").notNull(),
  cleanliness: integer("cleanliness").notNull(),
  equipmentCondition: integer("equipment_condition").notNull(),
  serviceReliability: integer("service_reliability").notNull(),
  safetyConfidence: integer("safety_confidence").notNull(),
  comment: text("comment"),
  status: text("status").notNull().default("published"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_location_ratings_user_location_idx").on(t.userId, t.locationId),
  index("uc_location_ratings_location_status_idx").on(t.locationId, t.status),
]);

export const ucLocationRatingReportsTable = pgTable("uc_location_rating_reports", {
  id: text("id").primaryKey(),
  ratingId: text("rating_id").notNull().references(() => ucLocationRatingsTable.id, { onDelete: "cascade" }),
  reporterUserId: integer("reporter_user_id").notNull().references(() => ucUsersTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_location_rating_reports_once_idx").on(t.ratingId, t.reporterUserId),
  index("uc_location_rating_reports_status_idx").on(t.createdAt),
]);

export const ucLocationAssessmentsTable = pgTable("uc_location_assessments", {
  id: text("id").primaryKey(),
  locationId: text("location_id").notNull().references(() => ucLocationsTable.id, { onDelete: "cascade" }),
  assessorId: text("assessor_id").notNull(),
  waterQuality: integer("water_quality").notNull(),
  cleanliness: integer("cleanliness").notNull(),
  equipmentCondition: integer("equipment_condition").notNull(),
  serviceReliability: integer("service_reliability").notNull(),
  safetyConfidence: integer("safety_confidence").notNull(),
  checks: text("checks").notNull().default("{}"),
  notes: text("notes"),
  status: text("status").notNull().default("verified"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uc_location_assessments_location_idx").on(t.locationId),
  index("uc_location_assessments_status_idx").on(t.status),
]);

export type UcLocationRating = typeof ucLocationRatingsTable.$inferSelect;
export type UcLocationRatingReport = typeof ucLocationRatingReportsTable.$inferSelect;
export type UcLocationAssessment = typeof ucLocationAssessmentsTable.$inferSelect;