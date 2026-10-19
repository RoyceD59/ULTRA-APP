import { pgTable, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";

// Company SKU register imported from the owner's master workbook. Public
// identity, retail price, filter life and the workbook's stock snapshot only:
// never cost, margin or trade-tier prices.
export const ucSkuRegisterTable = pgTable("uc_sku_register", {
  sku: text("sku").primaryKey(),
  parentSku: text("parent_sku").notNull(),
  model: text("model").notNull(),
  variant: text("variant"),
  colour: text("colour"),
  filterLifeLitres: integer("filter_life_litres"),
  lifeSource: text("life_source"),
  lifecycle: text("lifecycle").notNull(),
  sheetStockStatus: text("sheet_stock_status").notNull(),
  sheetQuantity: integer("sheet_quantity").notNull(),
  retailPriceKes: numeric("retail_price_kes", { precision: 12, scale: 2 }),
  source: text("source").notNull(),
  sourceRevision: integer("source_revision").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
