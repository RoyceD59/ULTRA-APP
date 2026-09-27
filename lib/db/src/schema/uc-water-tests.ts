import { pgTable, text, timestamp, json } from "drizzle-orm/pg-core";

/**
 * Persists water test booking requests from the UC Companion app.
 */
export const ucWaterTestsTable = pgTable("uc_water_tests", {
  id:          text("id").primaryKey(),              // "WT-<timestamp>"
  userId:      text("user_id").notNull(),
  name:        text("name").notNull(),
  address:     text("address").notNull(),
  phone:       text("phone").notNull(),
  waterSource: text("water_source").notNull().default("Municipal"),
  concerns:    text("concerns").notNull().default(""),
  photos:      json("photos").$type<string[]>().default([]),
  videos:      json("videos").$type<string[]>().default([]),
  status:      text("status").notNull().default("pending"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  customerStage: text("customer_stage"),
  customerStageUpdatedAt: timestamp("customer_stage_updated_at", { withTimezone: true }),
  /** Required audit/reference before a result_sent customer stage. */
  resultDeliveryReference: text("result_delivery_reference"),
});

export type UcWaterTest = typeof ucWaterTestsTable.$inferSelect;
