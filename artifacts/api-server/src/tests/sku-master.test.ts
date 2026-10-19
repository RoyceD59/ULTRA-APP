import { before, test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { ensureSkuRegister, skuMaster } from "../lib/sku-master.js";
import { spreadsheetRetail } from "../lib/product-editorial.js";

before(async () => { await ensureSkuRegister(); await ensureSkuRegister(); });

test("the company SKU register is stored once, with retail prices and no trade data", async () => {
  const rows = (await pool.query("SELECT * FROM uc_sku_register")).rows;
  assert.equal(rows.length, 49);
  assert.equal(rows.length, skuMaster.children.length);
  assert.deepEqual(Object.keys(rows[0]).filter(k => /cost|margin|wholesale|corporate|influencer/i.test(k)), []);
  const hydra = rows.find(r => r.sku === "UC-BOG-SSB-008-BL");
  assert.equal(Number(hydra.retail_price_kes), 4199);
  assert.equal(Number(hydra.retail_price_kes), spreadsheetRetail.prices["UC-BOG-SSB-008"]);
  assert.equal(hydra.filter_life_litres, 150);
  for (const child of skuMaster.children) {
    assert.ok(child.stockStatus === "IN_STOCK" || child.qtyOnHand === 0, `${child.sku} FUTURE stock must be zero`);
  }
  assert.ok(JSON.stringify(skuMaster).match(/cost|margin|wholesale/i) === null);
});

test("workbook prices apply to the products that have pages", () => {
  assert.equal(spreadsheetRetail.prices["UC-COM-ROS-002"], 56999);
  assert.equal(spreadsheetRetail.prices["UC-SKW-DFS-024"], 7099);
  assert.equal(Object.keys(spreadsheetRetail.prices).length, 36);
});
