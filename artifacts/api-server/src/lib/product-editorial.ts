import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pool } from "@workspace/db";

// Build copies this server-only source beside the API bundle. Never bundle it
// into either frontend. Source-mode tests use the same authored source.
const require = createRequire(import.meta.url);
const location = [resolve(import.meta.dirname, "product-records/product-records.cjs"),
  resolve(process.cwd(), "artifacts/uc-companion/server/product-records.cjs"),
  resolve(process.cwd(), "../uc-companion/server/product-records.cjs")].find(existsSync);
if (!location) throw new Error("Authored product records are missing");
export const editorialContract = require(location) as {
  source: any; createRecordCollection: (input: any) => any;
};
const seed = editorialContract.source;
export const productRecordsDir = resolve(location, "../records");
export const spreadsheetRetail = require(resolve(productRecordsDir, "retail-prices_v7.json")) as {
  revision: number; prices: Record<string, number>;
};
/** One-time v2.6 content upgrade for rows that already exist in the database. */
const contentMigration = require(resolve(productRecordsDir, "product-migration_v2.6.json")) as Record<string, {
  additive: Record<string, unknown>;
  suitability?: { from: unknown; to: any };
  evidence?: { from: unknown; to: unknown };
}>;
const CONTENT_REVISION = 26;
function collectionInput(products: any[]) {
  return { ...seed, products, topic_pages: seed.topic_pages.map((t: any) => ({
    ...t, products: products.filter(p => p.publishable && (p.seo.topics || []).includes(t.topic)).map(p => p.code),
  })) };
}

export async function ensureProductEditorialSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS uc_product_editorial (
    code text PRIMARY KEY, revision integer NOT NULL DEFAULT 1,
    record jsonb NOT NULL, gallery_mapped boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query("ALTER TABLE uc_product_editorial ADD COLUMN IF NOT EXISTS gallery_mapped boolean NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE uc_product_editorial ADD COLUMN IF NOT EXISTS price_import_revision integer NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE uc_product_editorial ADD COLUMN IF NOT EXISTS content_import_revision integer NOT NULL DEFAULT 0");
  await pool.query(`ALTER TABLE uc_order_items ADD COLUMN IF NOT EXISTS variation_id integer;
    ALTER TABLE uc_order_items ADD COLUMN IF NOT EXISTS child_sku text;
    ALTER TABLE uc_order_items ADD COLUMN IF NOT EXISTS variant_label text`);
  await pool.query(`INSERT INTO uc_product_editorial(code,record)
    SELECT entry->>'code',entry FROM jsonb_array_elements($1::jsonb) AS entry
    ON CONFLICT(code) DO NOTHING`, [JSON.stringify(seed.products)]);
  // Owner-approved one-time import of CATALOGUE RETAIL by exact parent SKU.
  // Future staff edits survive restart; never continuously reseed their prices.
  await pool.query(`UPDATE uc_product_editorial AS p SET
    record=jsonb_set(jsonb_set(p.record,'{price_kes}',to_jsonb(v.price)),
      '{ownership,product_price_kes}',to_jsonb(v.price)),
    price_import_revision=$2,revision=revision+1,updated_at=now()
    FROM jsonb_to_recordset($1::jsonb) AS v(sku text,price numeric)
    WHERE p.record->>'parent_sku'=v.sku AND p.price_import_revision<$2`,
    [JSON.stringify(Object.entries(spreadsheetRetail.prices).map(([sku,price]) => ({sku,price}))), spreadsheetRetail.revision]);
  await importContentRevision();
}

/** Additive only: staff edits are never overwritten. Wording is replaced only
 * where the stored section still equals the previous authored text, and the
 * new fields are added only where missing. Runs once per row. */
async function importContentRevision() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(871,2)");
    for (const [code, change] of Object.entries(contentMigration)) {
      const pending = await client.query("SELECT 1 FROM uc_product_editorial WHERE code=$1 AND content_import_revision<$2 FOR UPDATE", [code, CONTENT_REVISION]);
      if (!pending.rowCount) continue;
      await client.query(`UPDATE uc_product_editorial SET
        record=($2::jsonb - ARRAY(SELECT jsonb_object_keys(record))) || record WHERE code=$1`,
        [code, JSON.stringify(change.additive)]);
      for (const section of ["suitability", "evidence"] as const) {
        const edit = change[section];
        if (!edit) continue;
        await client.query(`UPDATE uc_product_editorial SET record=jsonb_set(record,$2::text[],$4::jsonb)
          WHERE code=$1 AND record->$5::text=$3::jsonb`, [code, [section], JSON.stringify(edit.from), JSON.stringify(edit.to), section]);
      }
      const fit = change.suitability?.to?.fit_photos;
      if (fit) {
        await client.query(`UPDATE uc_product_editorial SET record=jsonb_set(record,'{suitability,fit_photos}',$2::jsonb)
          WHERE code=$1 AND NOT (record->'suitability' ? 'fit_photos')`, [code, JSON.stringify(fit)]);
      }
      await client.query("UPDATE uc_product_editorial SET content_import_revision=$2,revision=revision+1,updated_at=now() WHERE code=$1", [code, CONTENT_REVISION]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function effectiveEditorial() {
  const result = await pool.query("SELECT code,revision,record,gallery_mapped FROM uc_product_editorial");
  const rows = new Map(result.rows.map(row => [row.code, row]));
  const persisted = [...seed.products, ...result.rows.filter(row =>
    !seed.products.some((p: any) => p.code === row.code)).map(row => row.record)];
  const input = collectionInput(persisted.map((p: any) => {
    const price = spreadsheetRetail.prices[p.parent_sku];
    const fallback = price === undefined ? p : { ...p, price_kes: price,
      ownership: { ...p.ownership, product_price_kes: price } };
    return rows.get(p.code)?.record ?? fallback;
  }));
  const collection = editorialContract.createRecordCollection(input);
  collection.products = collection.products.map((p: any) => ({ ...p, priceAuthority: "companion",
    galleryMapped: rows.get(p.code)?.gallery_mapped === true }));
  return { input, rows, collection };
}

/** The supplied schema deliberately leaves many nested objects open. Tighten
 * their public shapes against v2.6; reject wrong scalar/array types and secret
 * additions before storing, rather than discovering them during rendering. */
export function validateEditorial(record: any, previous: any, input: any) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Record must be an object");
  for (const field of ["code", "slug", "parent_sku", "category"]) {
    if (record[field] !== previous[field]) throw new Error(`${field} is a stable identity and cannot be changed`);
  }
  if (!Array.isArray(record.variants)) throw new Error("Variants must be an array");
  if (record.variants.some((v: any) => !v || typeof v.child_sku !== "string" ||
      !v.child_sku.trim() || typeof v.label !== "string" || !v.label.trim())) {
    throw new Error("Every variant needs a unique SKU and label");
  }
  const compare = (value: any, templates: any[], path: string) => {
    if (path === "price_kes" || path === "ownership.product_price_kes") {
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("price_kes must be a nonnegative price or null");
      return;
    }
    const compatible = templates.filter(t => value === null ? t === null
      : t !== null && typeof t === typeof value && Array.isArray(t) === Array.isArray(value));
    if (!compatible.length) throw new Error(`${path} has an invalid value`);
    if (value === null) return;
    if (Array.isArray(value)) {
      const elements = compatible.flat();
      if (elements.length) value.forEach((v: any) => compare(v, elements, path));
      else if (value.length) throw new Error(`${path} has no approved authored entries`);
      return;
    }
    if (typeof value === "object") {
      if (path !== "specs") for (const key of Object.keys(compatible[0])) {
        if (compatible.every(t => key in t) && !(key in value)) throw new Error(`${path}.${key} is required`);
      }
      for (const [key, v] of Object.entries(value)) {
        const authored = compatible.filter(t => key in t).map(t => t[key]);
        if (!authored.length) {
          if (path === "images" && ["pictured_colour", "child_sku"].includes(key) && (v === null || typeof v === "string")) continue;
          if (path === "specs" && typeof v === "string") continue;
          throw new Error(`${path}.${key} is not an authored field`);
        }
        compare(v, authored, path ? `${path}.${key}` : key);
      }
      return;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`${path} has an invalid value`);
    }
    if (typeof value === "string" && value.length > 12000) throw new Error(`${path} is too long`);
  };
  compare(record, seed.products, "");
  for (const image of record.images) {
    if (image.approved && (!image.alt?.trim() || !image.file)) throw new Error(`images slot ${image.slot} needs alt text and an existing photo`);
    if (image.child_sku && !record.variants.some((v: any) => v.child_sku === image.child_sku)) throw new Error("Photo variant does not belong to this product");
  }
  const prohibited = /\bSGS[- ]certified\b|\b(?:removes?|removal of|filters? out)\s+(?:viruses?|cysts?|heavy[- ]metals?)\b/i;
  if (prohibited.test(JSON.stringify(record))) throw new Error("Unsupported safety or SGS certification claim");
  for (const claim of record.evidence.claims || []) {
    if (/\b(?:virus(?:es)?|cysts?|heavy[- ]metals?)\b/i.test(claim.text) && !/\b(?:no|not|does not|cannot|unverified)\b/i.test(claim.text)) {
      throw new Error("Virus, cyst and heavy-metal claims are not approved");
    }
    if (claim.evidence.some((key: string) => !input.evidence[key])) throw new Error("Claim references an unknown test report");
    if (claim.status === "verified" && !claim.evidence.length) throw new Error("Verified claims need a report on record");
  }
  const original = seed.products.find((p: any) => p.code === previous.code) ?? previous;
  const filterWarning = original.opening.critical_limit.match(/Remove the filter before filling with hot or boiling liquids, juice, coffee or tea\./)?.[0];
  if (filterWarning && !record.opening.critical_limit.includes(filterWarning)) throw new Error("The approved filter-removal warning must be preserved");
  const products = input.products.some((p: any) => p.code === record.code)
    ? input.products.map((p: any) => p.code === record.code ? record : p)
    : [...input.products, record];
  editorialContract.createRecordCollection(collectionInput(products));
}
