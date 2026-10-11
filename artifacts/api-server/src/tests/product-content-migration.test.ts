import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pool } from "@workspace/db";
import { ensureProductEditorialSchema, productRecordsDir } from "../lib/product-editorial.js";

const require = createRequire(import.meta.url);
const migration = require(`${productRecordsDir}/product-migration_v2.6.json`) as Record<string, any>;
const row = async (code: string) =>
  (await pool.query("SELECT record,content_import_revision FROM uc_product_editorial WHERE code=$1", [code])).rows[0];

before(async () => { await ensureProductEditorialSchema(); });
after(async () => { await pool.end(); });

test("v2.6 content import upgrades untouched rows, preserves staff edits and runs once", async () => {
  // Simulate databases seeded before v2.6.
  const old = (await row("FCT")).record;
  old.suitability = migration.FCT.suitability.from;
  for (const key of Object.keys(migration.FCT.additive)) delete old[key];
  await pool.query("UPDATE uc_product_editorial SET record=$1,content_import_revision=0 WHERE code='FCT'", [JSON.stringify(old)]);
  const edited = (await row("SHJ")).record;
  edited.suitability = { ...migration.SHJ.suitability.from, intended_use: "Staff wording" };
  await pool.query("UPDATE uc_product_editorial SET record=$1,content_import_revision=0 WHERE code='SHJ'", [JSON.stringify(edited)]);

  await ensureProductEditorialSchema();

  const fct = await row("FCT");
  assert.deepEqual(fct.record.suitability, migration.FCT.suitability.to);
  assert.equal(fct.record.kind, "product");
  assert.ok(fct.record.compare && fct.record.nav_group);
  const shj = await row("SHJ");
  assert.equal(shj.record.suitability.intended_use, "Staff wording");
  assert.deepEqual(shj.record.suitability.fit_photos, migration.SHJ.suitability.to.fit_photos);
  assert.equal(fct.content_import_revision, 26);

  // A later staff removal of the photos must survive restarts.
  const trimmed = fct.record;
  delete trimmed.suitability.fit_photos;
  await pool.query("UPDATE uc_product_editorial SET record=$1 WHERE code='FCT'", [JSON.stringify(trimmed)]);
  await ensureProductEditorialSchema();
  assert.equal("fit_photos" in (await row("FCT")).record.suitability, false);
});

test("the eleven new v2.6 pages are inserted as unpublished, non-purchasable drafts", async () => {
  const drafts = (await pool.query(
    "SELECT record FROM uc_product_editorial WHERE record->>'status'='draft'")).rows.map(r => r.record);
  assert.equal(drafts.length, 11);
  assert.ok(drafts.every(r => r.publishable === false && r.purchasable === false));
});
