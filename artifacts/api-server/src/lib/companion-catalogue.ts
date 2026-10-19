import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { effectiveEditorial } from "./product-editorial.js";

/** Additive bootstrap mirrors the shared Drizzle schema. Never seeds stock. */
export async function ensureCompanionCatalogueSchema() {
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS uc_catalogue_id_seq START WITH 1000000;
    CREATE TABLE IF NOT EXISTS uc_catalogue_inventory (
      id integer PRIMARY KEY DEFAULT nextval('uc_catalogue_id_seq'),
      code text NOT NULL,sku text NOT NULL UNIQUE,parent_sku text,
      stock_status text NOT NULL DEFAULT 'unknown',stock_quantity integer,
      manage_stock boolean NOT NULL DEFAULT false,archived boolean NOT NULL DEFAULT false,
      revision integer NOT NULL DEFAULT 1,metadata jsonb NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS uc_inventory_reservations (
      order_id integer NOT NULL,inventory_id integer NOT NULL REFERENCES uc_catalogue_inventory(id),
      quantity integer NOT NULL,state text NOT NULL DEFAULT 'reserved');
    CREATE UNIQUE INDEX IF NOT EXISTS uc_inventory_reservation_order_item
      ON uc_inventory_reservations(order_id,inventory_id);
    CREATE TABLE IF NOT EXISTS uc_inventory_audit (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,inventory_id integer NOT NULL,
      actor text NOT NULL,action text NOT NULL,revision integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now());`);
  await synchronizeCatalogueIdentities();
}

export async function synchronizeCatalogueIdentities(client: Pick<PoolClient, "query"> = pool, products?: any[], affectedCodes?: string[]) {
  const source = products ?? (await effectiveEditorial()).input.products;
  const identities = source.filter((p: any) => !affectedCodes || affectedCodes.includes(p.code)).flatMap((p: any) => [
    { code: p.code, sku: p.parent_sku, parent_sku: null },
    ...p.variants.map((v: any) => ({ code: p.code, sku: v.child_sku, parent_sku: p.parent_sku })),
  ]);
  await client.query(`INSERT INTO uc_catalogue_inventory(code,sku,parent_sku)
    SELECT code,sku,parent_sku FROM jsonb_to_recordset($1::jsonb)
      AS r(code text,sku text,parent_sku text) ON CONFLICT(sku) DO UPDATE
      SET archived=false,metadata=uc_catalogue_inventory.metadata-'retired_variant'
      WHERE uc_catalogue_inventory.code=EXCLUDED.code
        AND uc_catalogue_inventory.parent_sku IS NOT DISTINCT FROM EXCLUDED.parent_sku
        AND uc_catalogue_inventory.metadata->>'retired_variant'='true'`, [JSON.stringify(identities)]);
  const verified = await client.query("SELECT sku,code,parent_sku FROM uc_catalogue_inventory WHERE sku=ANY($1::text[])", [identities.map((i: any) => i.sku)]);
  if (identities.some((i: any) => !verified.rows.some(r =>
    r.sku === i.sku && r.code === i.code && r.parent_sku === i.parent_sku))) {
    throw new Error("A SKU already belongs to another product or variant. Choose a new identity.");
  }
  // Removed variants retain identity/history but cannot be purchased.
  await client.query(`UPDATE uc_catalogue_inventory SET archived=true,
    metadata=metadata||'{"retired_variant":true}'::jsonb
    WHERE NOT (sku=ANY($1::text[])) AND ($2::text[] IS NULL OR code=ANY($2::text[]))`,
    [identities.map((i: any) => i.sku), affectedCodes ?? null]);
}

function categoryId(category: string): number {
  return createHash("sha256").update(category).digest().readUInt32BE(0) % 1000000000 + 1;
}

/**
 * The raw shape keeps existing normalizers/client contracts compatible. It is
 * produced from app data only: no external credentials, requests or demo data.
 */
export async function companionCatalogue(includeDrafts = false): Promise<Record<string, unknown>[]> {
  const { input, collection } = await effectiveEditorial();
  const inventory = await pool.query(`SELECT i.*,COALESCE(r.held,0)::integer AS held
    FROM uc_catalogue_inventory i LEFT JOIN (
      SELECT inventory_id,SUM(quantity) AS held FROM uc_inventory_reservations
      WHERE state='reserved' GROUP BY inventory_id) r ON r.inventory_id=i.id`);
  const bySku = new Map(inventory.rows.map((r: any) => [r.sku, r]));
  const approved = new Map(collection.products.map((p: any) => [p.code, p]));
  const media = await pool.query("SELECT product_id,url,alt FROM uc_product_media WHERE type='photo' ORDER BY position,id");
  const products: Record<string, unknown>[] = [];
  for (const source of input.products) {
    const row = bySku.get(source.parent_sku) as any;
    const record = approved.get(source.code) as any;
    if (!row || (!includeDrafts && (!record || row.archived))) continue;
    const images: { src: any; alt: any; slot?: number }[] = media.rows.filter((m: any) => m.product_id === row.id)
      .map((m: any) => ({ src: m.url, alt: m.alt }));
    // Existing approved mappings are useful only when already app-owned.
    for (const mapping of record?.imageMappings ?? []) {
      if (/^\/api\/(?:storage|objects|uc\/media)\//.test(mapping.src) &&
          !images.some((m: any) => m.src === mapping.src)) images.push({ src: mapping.src, alt: mapping.alt, slot: mapping.slot });
    }
    const quantity = row.manage_stock ? Math.max(0, Number(row.stock_quantity ?? 0) - row.held) : null;
    const meta = row.metadata ?? {};
    products.push({
      id: row.id, code: source.code, name: source.name, sku: source.parent_sku,
      status: record && !row.archived ? "publish" : "draft",
      type: source.variants.length ? "variable" : "simple",
      variants: source.variants.map((v: any) => bySku.get(v.child_sku)?.id).filter(Boolean),
      price: source.price_kes == null ? "" : String(source.price_kes),
      regular_price: source.price_kes == null ? "" : String(source.price_kes), sale_price: "",
      description: source.summary?.heading ?? "", short_description: source.seo?.h1_sub ?? "",
      categories: [{ id: categoryId(source.category), name: source.category }],
      images, stock_status: row.stock_status, stock_quantity: quantity,
      stock_on_hand: row.stock_quantity, stock_reserved: row.held,
      manage_stock: row.manage_stock, purchasable: Boolean(record?.purchasable && !row.archived),
      enquiryOnly: !record?.purchasable, total_sales: 0, permalink: null,
      revision: row.revision, meta_data: [
        { key: "filter_lifespan_days", value: meta.lifespanDays ?? 0 },
        { key: "filter_capacity_litres", value: meta.filterCapacityLitres ?? 0 },
      ],
    });
    for (const variant of source.variants) {
      const child = bySku.get(variant.child_sku) as any;
      if (!child || child.archived) continue;
      products.push({
        id: child.id, parent_id: row.id, sku: variant.child_sku, name: variant.label,
        status: record && !row.archived ? "publish" : "draft", type: "variation",
        price: source.price_kes == null ? "" : String(source.price_kes),
        stock_status: child.stock_status, manage_stock: child.manage_stock,
        stock_quantity: child.manage_stock ? Math.max(0, Number(child.stock_quantity ?? 0) - child.held) : null,
        stock_on_hand: child.stock_quantity, stock_reserved: child.held,
        purchasable: Boolean(record?.purchasable && !row.archived), images: [],
        revision: child.revision, backorders: "no",
      });
    }
  }
  return products;
}

export async function readCompanionCollection(path: string, extra: Record<string, string> = {}, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const all = await companionCatalogue(extra.status === "any" || extra.status === "draft");
  let rows: Record<string, unknown>[];
  const variants = path.match(/^\/products\/([1-9]\d*)\/variations$/);
  if (path === "/products/categories") {
    const categories = new Map<number, any>();
    for (const p of all.filter(p => p.type !== "variation")) {
      for (const c of p.categories as any[]) categories.set(c.id, { ...c, slug: c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") });
    }
    rows = [...categories.values()];
  } else if (variants) rows = all.filter(p => p.parent_id === Number(variants[1]));
  else if (path === "/products") rows = all.filter(p => p.type !== "variation");
  else return null; // Remote order/customer/review APIs have been retired.
  if (extra.include) {
    const ids = new Set(extra.include.split(",").map(Number)); rows = rows.filter(p => ids.has(Number(p.id)));
  }
  if (extra.sku) {
    const skus = new Set(extra.sku.split(",")); rows = rows.filter(p => skus.has(String(p.sku)));
  }
  if (extra.category) rows = rows.filter(p => (p.categories as any[] ?? []).some(c => c.id === Number(extra.category)));
  if (extra.search) rows = rows.filter(p => String(p.name).toLowerCase().includes(extra.search.toLowerCase()));
  if (extra.status && extra.status !== "any") rows = rows.filter(p => p.status === extra.status || path.endsWith("/categories"));
  const perPage = Number(extra.per_page ?? 100), page = Number(extra.page ?? 1);
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100 ||
      !Number.isInteger(page) || page < 1) return null;
  signal?.throwIfAborted();
  return rows.slice((page - 1) * perPage, page * perPage);
}

export async function readCompanionProduct(path: string) {
  const match = path.match(/^\/products\/([1-9]\d*)(?:\/variations\/([1-9]\d*))?$/);
  if (!match) return null;
  const products = await companionCatalogue(true);
  return products.find(p => p.id === Number(match[2] ?? match[1]) &&
    (match[2] ? p.parent_id === Number(match[1]) : p.type !== "variation")) ?? null;
}

export async function updateCompanionInventory(id: number, patch: Record<string, unknown>, actor: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM uc_catalogue_inventory WHERE id=$1 FOR UPDATE", [id]);
    const row = found.rows[0];
    if (!row) throw Object.assign(new Error("App product not found; refresh the catalogue."), { status: 404 });
    if (patch.revision !== undefined && patch.revision !== row.revision) {
      throw Object.assign(new Error("Inventory changed; refresh before saving."), { status: 409 });
    }
    const state = patch.stock_status ?? row.stock_status;
    if (!["unknown", "instock", "outofstock", "onbackorder"].includes(String(state))) throw new Error("Invalid stock status");
    const managed = patch.stock_quantity !== undefined ? patch.stock_quantity !== null : row.manage_stock;
    const quantity = patch.stock_quantity !== undefined ? patch.stock_quantity : row.stock_quantity;
    if (managed && (!Number.isSafeInteger(quantity) || Number(quantity) < 0)) throw new Error("Stock must be a nonnegative whole number");
    const held = await client.query("SELECT COALESCE(SUM(quantity),0) AS held FROM uc_inventory_reservations WHERE inventory_id=$1 AND state='reserved'", [id]);
    if (Number(held.rows[0].held) && (!managed || Number(quantity) < Number(held.rows[0].held))) {
      throw new Error("Resolve reserved orders before reducing stock below their reserved quantity or disabling tracking.");
    }
    const updated = await client.query(`UPDATE uc_catalogue_inventory SET stock_quantity=$2,manage_stock=$3,
      stock_status=$4,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [id, managed ? quantity : null, managed, managed && Number(quantity) === 0 ? "outofstock" : state]);
    await client.query("INSERT INTO uc_inventory_audit(inventory_id,actor,action,revision) VALUES($1,$2,'stock_edit',$3)",
      [id, actor, updated.rows[0].revision]);
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Called in the same transaction that admits an immutable checkout. */
export async function reserveCompanionInventory(client: PoolClient, orderId: number, lines: any[]) {
  const quantities = new Map<number, number>();
  for (const line of lines) {
    const id = line.variationId ?? line.productId;
    quantities.set(id, (quantities.get(id) ?? 0) + line.quantity);
  }
  // Consistent lock order prevents cross-basket deadlocks.
  for (const [id, quantity] of [...quantities].sort(([a], [b]) => a - b)) {
    const result = await client.query("SELECT * FROM uc_catalogue_inventory WHERE id=$1 FOR UPDATE", [id]);
    const item = result.rows[0];
    if (!item || item.archived || !["instock", "onbackorder"].includes(item.stock_status)) throw new Error("Stock changed; refresh your basket before paying.");
    if (!item.manage_stock) continue;
    const held = await client.query("SELECT COALESCE(SUM(quantity),0) AS held FROM uc_inventory_reservations WHERE inventory_id=$1 AND state='reserved'", [id]);
    if (Number(item.stock_quantity) - Number(held.rows[0].held) < quantity) throw new Error("Not enough stock remains; refresh your basket.");
    await client.query("INSERT INTO uc_inventory_reservations(order_id,inventory_id,quantity) VALUES($1,$2,$3)", [orderId, id, quantity]);
  }
}

/** No time-based release. Unknown/paid cancellations stay reserved for review. */
export async function settleCompanionInventory(client: PoolClient, order: any, nextStatus: string) {
  const consume = ["completed", "delivered"].includes(nextStatus);
  const safeRelease = ["cancelled", "failed", "declined"].includes(nextStatus) &&
    !order.payment_confirmed_at && order.cod_collection_status !== "collected" &&
    (order.payment_method === "cod" || order.checkout_snapshot?.paymentNotStarted === true);
  if (!consume && !safeRelease) return;
  const rows = await client.query("SELECT inventory_id,quantity FROM uc_inventory_reservations WHERE order_id=$1 AND state='reserved' ORDER BY inventory_id", [order.id]);
  for (const row of rows.rows) {
    await client.query("SELECT id FROM uc_catalogue_inventory WHERE id=$1 FOR UPDATE", [row.inventory_id]);
    const changed = await client.query(`UPDATE uc_inventory_reservations SET state=$3
      WHERE order_id=$1 AND inventory_id=$2 AND state='reserved' RETURNING quantity`,
      [order.id, row.inventory_id, consume ? "consumed" : "released"]);
    if (!changed.rows[0]) continue;
    if (consume) {
      const updated = await client.query(`UPDATE uc_catalogue_inventory SET stock_quantity=stock_quantity-$2,
        revision=revision+1,updated_at=now(),stock_status=CASE WHEN stock_quantity-$2=0 THEN 'outofstock' ELSE stock_status END
        WHERE id=$1 AND stock_quantity >= $2 RETURNING id`, [row.inventory_id, row.quantity]);
      if (!updated.rows[0]) throw new Error("Reserved inventory needs staff reconciliation before fulfillment.");
    }
    await client.query(`INSERT INTO uc_inventory_audit(inventory_id,actor,action,revision)
      SELECT id,$2,$3,revision FROM uc_catalogue_inventory WHERE id=$1`,
      [row.inventory_id, `order:${order.id}`, consume ? "fulfilled_reservation" : "unpaid_reservation_released"]);
  }
}
