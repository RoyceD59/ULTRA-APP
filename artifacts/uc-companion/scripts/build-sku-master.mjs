// Extracts the company SKU register and retail prices from the owner's master
// workbook. Costs, margins, wholesale tiers and stock-ledger analysis are
// deliberately NOT extracted: only the public identity, retail price, filter
// life and the sheet's stock snapshot reach the repository.
//
//   node scripts/build-sku-master.mjs          write the two JSON records
//   node scripts/build-sku-master.mjs --check  fail if the records drift from the workbook
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const recordDir = resolve(root, "artifacts/uc-companion/server/records");
const SOURCE = "UC_MASTER_v7_FINAL_7Oct2026_1791660568177.xlsx";
const REVISION = 2;
const XLSX = createRequire(resolve(root, "artifacts/projecthub/package.json"))("@e965/xlsx");

const book = XLSX.readFile(resolve(root, "attached_assets", SOURCE));
const rows = (name) => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null });

const header = (sheet, first) => {
  const all = rows(sheet);
  const at = all.findIndex(r => r[0] === first);
  assert.ok(at >= 0, `${sheet} header ${first} not found`);
  return all.slice(at + 1);
};

const prices = {};
for (const r of header("03_PRICING", "PARENT_SKU")) {
  if (!String(r[0] ?? "").startsWith("UC-")) continue;
  assert.ok(typeof r[5] === "number" && r[5] > 0, `Missing retail price for ${r[0]}`);
  assert.ok(!(r[0] in prices), `Duplicate pricing row ${r[0]}`);
  prices[r[0]] = r[5];
}

const stockStates = new Set(["IN_STOCK", "FUTURE"]);
const children = [];
for (const r of header("02_SKU_MASTER", "CHILD_SKU")) {
  if (!String(r[0] ?? "").startsWith("UC-") || !r[1]) continue;
  assert.ok(stockStates.has(r[8]), `Unexpected stock status ${r[8]} for ${r[0]}`);
  assert.ok(Number.isInteger(r[9]) && r[9] >= 0, `Invalid quantity for ${r[0]}`);
  assert.ok(r[8] === "IN_STOCK" || r[9] === 0, `${r[0]} is FUTURE but has stock`);
  children.push({
    sku: r[0], parentSku: r[1], model: String(r[2]).trim().replace(/\s+/g, " "),
    variant: r[3] || null, colour: r[4] || null,
    filterLifeLitres: typeof r[5] === "number" ? r[5] : null,
    lifeSource: r[6] || null, lifecycle: r[7], stockStatus: r[8], qtyOnHand: r[9],
  });
}
assert.equal(new Set(children.map(c => c.sku)).size, children.length, "Duplicate child SKU");

const retail = { source: SOURCE, sheet: "03_PRICING", column: "RETAIL", revision: REVISION, prices };
const register = {
  source: SOURCE, sheet: "02_SKU_MASTER", revision: REVISION,
  note: "Sheet snapshot of 7 Oct 2026. Quantities are applied to app stock only by an explicit operator action.",
  children: children.map(c => ({ ...c, retailKes: prices[c.parentSku] ?? null })),
};

const files = { "retail-prices_v7.json": retail, "sku-master_v7.json": register };
for (const [name, value] of Object.entries(files)) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const path = resolve(recordDir, name);
  if (process.argv.includes("--check")) {
    assert.equal(readFileSync(path, "utf8"), text, `${name} differs from the workbook; regenerate it`);
  } else writeFileSync(path, text);
}
console.log(`${process.argv.includes("--check") ? "Verified" : "Wrote"} ${Object.keys(prices).length} retail prices and ${children.length} child SKUs.`);
