import { pgTable, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

/** Singleton redemption conversion rule. */
export const ucRewardConversionTable = pgTable("uc_reward_conversion", {
  id: text("id").primaryKey().default("singleton"),
  mode: text("mode").notNull().default("kes"),
  value: numeric("value", { precision: 12, scale: 2 }).notNull().default("100"),
  active: boolean("active").notNull().default(true),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcRewardConversion = typeof ucRewardConversionTable.$inferSelect;