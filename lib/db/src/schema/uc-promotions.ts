import { pgTable, serial, text, integer, boolean, timestamp, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ucUsersTable } from "./uc-users.js";

export const ucPromotionsTable = pgTable("uc_promotions", {
  id: serial("id").primaryKey(), code: text("code").notNull(), type: text("type").notNull(),
  effectMode: text("effect_mode").notNull(), effectValue: numeric("effect_value", { precision: 12, scale: 2 }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true), globalUseLimit: integer("global_use_limit"),
  perUserUseLimit: integer("per_user_use_limit"), createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("uc_promotions_code_lower_idx").on(sql`lower(${t.code})`), index("uc_promotions_active_window_idx").on(t.active, t.startsAt)]);

export const ucPromotionProductsTable = pgTable("uc_promotion_products", {
  promotionId: integer("promotion_id").notNull().references(() => ucPromotionsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull(),
}, (t) => [uniqueIndex("uc_promotion_products_unique_idx").on(t.promotionId, t.productId)]);

export const ucPromotionUsesTable = pgTable("uc_promotion_uses", {
  id: serial("id").primaryKey(), promotionId: integer("promotion_id").notNull().references(() => ucPromotionsTable.id),
  userId: integer("user_id").notNull().references(() => ucUsersTable.id), operation: text("operation").notNull(),
  operationRef: text("operation_ref"), actor: text("actor").notNull(), idempotencyKey: text("idempotency_key").notNull(),
  effectSnapshot: text("effect_snapshot").notNull(), benefitAmount: numeric("benefit_amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("uc_promotion_uses_idempotency_idx").on(t.userId, t.idempotencyKey), index("uc_promotion_uses_promotion_user_idx").on(t.promotionId, t.userId)]);