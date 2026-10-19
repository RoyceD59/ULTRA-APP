import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import { productRecordsDir } from "./product-editorial.js";
import { updateCompanionInventory } from "./companion-catalogue.js";

const require = createRequire(import.meta.url);
type Child = {
  sku: string; parentSku: string; model: string; variant: string | null; colour: string | null;
  filterLifeLitres: number | null; lifeSource: string | null; lifecycle: string;
  stockStatus: "IN_STOCK" | "FUTURE"; qtyOnHand: number; retailKes: number | null;
};
export const skuMaster = require(resolve(productRecordsDir, "sku-master_v7.json")) as {
  source: string; revision: number; children: Child[];
};

/** Additive bootstrap mirrors the shared Drizzle schema. Register data is
 * reference information only; it never changes app stock or prices. */
export async function ensureSkuRegister() {
  await pool.query(`CREATE TABLE IF NOT EXISTS uc_sku_register (
    sku text PRIMARY KEY, parent_sku text NOT NULL, model text NOT NULL, variant text, colour text,
    filter_life_litres integer, life_source text, lifecycle text NOT NULL,
    sheet_stock_status text NOT NULL, sheet_quantity integer NOT NULL,
    retail_price_kes numeric(12,2), source text NOT NULL, source_revision integer NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`INSERT INTO uc_sku_register(sku,parent_sku,model,variant,colour,filter_life_litres,
      life_source,lifecycle,sheet_stock_status,sheet_quantity,retail_price_kes,source,source_revision)
    SELECT r.sku,r."parentSku",r.model,r.variant,r.colour,r."filterLifeLitres",r."lifeSource",r.lifecycle,
      r."stockStatus",r."qtyOnHand",r."retailKes",$2,$3
    FROM jsonb_to_recordset($1::jsonb) AS r(sku text,"parentSku" text,model text,variant text,colour text,
      "filterLifeLitres" integer,"lifeSource" text,lifecycle text,"stockStatus" text,"qtyOnHand" integer,"retailKes" numeric)
    ON CONFLICT(sku) DO UPDATE SET parent_sku=EXCLUDED.parent_sku,model=EXCLUDED.model,variant=EXCLUDED.variant,
      colour=EXCLUDED.colour,filter_life_litres=EXCLUDED.filter_life_litres,life_source=EXCLUDED.life_source,
      lifecycle=EXCLUDED.lifecycle,sheet_stock_status=EXCLUDED.sheet_stock_status,
      sheet_quantity=EXCLUDED.sheet_quantity,retail_price_kes=EXCLUDED.retail_price_kes,
      source=EXCLUDED.source,source_revision=EXCLUDED.source_revision,updated_at=now()
    WHERE uc_sku_register.source_revision<EXCLUDED.source_revision`,
    [JSON.stringify(skuMaster.children), skuMaster.source, skuMaster.revision]);
}

/**
 * Explicit operator action. Applies the workbook snapshot only to inventory
 * rows still marked "unknown", so later staff counts and sales are never
 * overwritten and a repeat run changes nothing. FUTURE rows carry zero stock
 * and become out of stock until staff receive them. A parent row is left
 * unmanaged (blank quantity) with a status derived from its colours.
 */
export async function applySkuMasterStock(actor: string) {
  const rows = (await pool.query("SELECT id,sku,parent_sku,stock_status FROM uc_catalogue_inventory")).rows as
    { id: number; sku: string; parent_sku: string | null; stock_status: string }[];
  const bySku = new Map(rows.map(r => [r.sku, r]));
  const summary = { childrenUpdated: 0, parentsUpdated: 0, alreadySet: 0, noProductPage: [] as string[] };
  for (const child of skuMaster.children) {
    const row = bySku.get(child.sku);
    if (!row) { summary.noProductPage.push(child.sku); continue; }
    if (row.stock_status !== "unknown") { summary.alreadySet++; continue; }
    await updateCompanionInventory(row.id, {
      stock_quantity: child.qtyOnHand, stock_status: child.qtyOnHand > 0 ? "instock" : "outofstock",
    }, actor);
    summary.childrenUpdated++;
  }
  const parents = new Set(skuMaster.children.map(c => c.parentSku));
  for (const sku of parents) {
    const row = bySku.get(sku);
    if (!row || row.parent_sku !== null || row.stock_status !== "unknown") continue;
    const kids = skuMaster.children.filter(c => c.parentSku === sku);
    await updateCompanionInventory(row.id, { stock_status: kids.some(c => c.qtyOnHand > 0) ? "instock" : "outofstock" }, actor);
    summary.parentsUpdated++;
  }
  return summary;
}
