import { randomUUID } from "node:crypto";
import { after } from "node:test";
import { pool } from "@workspace/db";
import { editorialContract, ensureProductEditorialSchema } from "../../lib/product-editorial.js";
import { invalidateCatalogueCache } from "../../routes/uc.js";

const fixtureCodes = new Set<string>();
// Register at module scope: a hook registered inside a before() callback is
// owned by that callback and would delete the fixture before the tests run.
after(async () => {
  for (const code of fixtureCodes) {
    await pool.query("DELETE FROM uc_inventory_reservations WHERE inventory_id IN (SELECT id FROM uc_catalogue_inventory WHERE code=$1)", [code]);
    await pool.query("DELETE FROM uc_catalogue_inventory WHERE code=$1", [code]);
    await pool.query("DELETE FROM uc_product_editorial WHERE code=$1", [code]);
  }
  invalidateCatalogueCache();
});

/**
 * A suite-owned, real app-catalogue product. Never mutates a shared seed product,
 * uses a Woo response as authority, or enables provider/payment simulation.
 * Cleanup hooks remove fixture catalogue rows after the owning suite finishes.
 */
export async function appCatalogueFixture(price = 3499, variant = false) {
  await ensureProductEditorialSchema();
  const code = `T${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const record = structuredClone(editorialContract.source.products[0]);
  Object.assign(record, {
    code, slug: code.toLowerCase(), parent_sku: `TEST-${code}`, variants: [],
    price_kes: price, publishable: true, purchasable: true,
  });
  record.ownership.product_price_kes = price;
  if (variant) record.variants = [{ ...editorialContract.source.products[0].variants[0],
    child_sku: `TEST-${code}-CHILD` }];
  record.images = record.images.map((image: any) => ({
    ...image, file: `images/${record.parent_sku}_${String(image.slot).padStart(2, "0")}.jpg`,
    approved: false,
  }));
  await pool.query(`INSERT INTO uc_product_editorial(code,record,price_import_revision,content_import_revision)
    VALUES($1,$2::jsonb,2147483647,2147483647)`, [code, JSON.stringify(record)]);
  fixtureCodes.add(code);
  const result = await pool.query<{ id: number }>(`INSERT INTO uc_catalogue_inventory
    (code,sku,stock_status,manage_stock,metadata)
    VALUES($1,$2,'instock',false,'{"lifespanDays":90,"filterCapacityLitres":150}'::jsonb)
    RETURNING id`, [code, record.parent_sku]);
  invalidateCatalogueCache();
  const child = variant ? (await pool.query<{ id: number }>(`INSERT INTO uc_catalogue_inventory
    (code,sku,parent_sku,stock_status,manage_stock)
    VALUES($1,$2,$3,'instock',false) RETURNING id`, [code, record.variants[0].child_sku, record.parent_sku])).rows[0] : undefined;
  return { id: result.rows[0]!.id, code, record, price, childId: child?.id, childSku: record.variants[0]?.child_sku };
}
