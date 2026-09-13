import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { quotePromotion } from "../lib/reward-promotions.js";

const ids: number[] = [];
async function create(code: string, mode: string, value: number) {
  const r = await pool.query(`INSERT INTO uc_promotions(code,type,effect_mode,effect_value,starts_at,active,created_by,updated_by) VALUES($1,'checkout_discount',$2,$3,now(),true,'test','test') RETURNING id`, [code, mode, value]);
  const id = Number(r.rows[0].id); ids.push(id);
  await pool.query("INSERT INTO uc_promotion_products(promotion_id,product_id) VALUES($1,22)", [id]);
  return code;
}
after(async () => { if (ids.length) { await pool.query("DELETE FROM uc_promotion_products WHERE promotion_id=ANY($1::int[])", [ids]); await pool.query("DELETE FROM uc_promotions WHERE id=ANY($1::int[])", [ids]); } });
describe("restricted checkout promotion eligible subtotal", () => {
  it("never discounts ineligible server-priced lines", async () => {
    const lines = [{ productId: 22, subtotal: 100 }, { productId: 23, subtotal: 900 }];
    let quote = await quotePromotion(await create(`ELIGP${Date.now()}`, "percentage", 50), "checkout", [22, 23], 1000, lines);
    assert.equal(quote!.eligibleSubtotal, 100); assert.equal(quote!.benefit, 50); assert.equal(quote!.finalSubtotal, 950);
    quote = await quotePromotion(await create(`ELIGF${Date.now()}`, "fixed", 500), "checkout", [22, 23], 1000, lines);
    assert.equal(quote!.benefit, 100); assert.equal(quote!.finalSubtotal, 900);
    quote = await quotePromotion(await create(`ELIGX${Date.now()}`, "percentage", 100), "checkout", [22, 23], 1000, lines);
    assert.equal(quote!.benefit, 100); assert.equal(quote!.finalSubtotal, 900);
  });
});