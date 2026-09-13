import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import app from "../app.js";
import { db, pool, ucUsersTable, ucOrdersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";

let server: http.Server, base: string, promotionId: number, a: any, b: any;
const ids: number[] = [];
const shipping = { firstName: "Amina", lastName: "Otieno", address1: "1 Test Rd", city: "Nairobi", country: "KE", phone: "0712345678" };
async function request(path: string, body: unknown, token?: string) {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* Express 404 HTML is expected for removed routes. */ }
  return { status: r.status, body: parsed };
}
const checkout = (key: string, code = "DURABLE_TEST") => ({ lineItems: [{ productId: 22, quantity: 1 }], paymentMethod: "cod", shippingAddress: shipping, promoCode: code, idempotencyKey: key });

describe("durable promoted local checkout idempotency", () => {
  before(async () => {
    delete process.env.WC_CONSUMER_KEY; delete process.env.WC_CONSUMER_SECRET;
    process.env.SESSION_SECRET ??= "durable-checkout-test";
    const hash = await bcrypt.hash("Test1234!", 4), stamp = Date.now();
    for (const suffix of ["a", "b"]) {
      const [u] = await db.insert(ucUsersTable).values({ email: `durable-${suffix}-${stamp}@test.invalid`, passwordHash: hash, firstName: "Amina", lastName: "Test" }).returning();
      const value = { id: u!.id, token: issueToken({ id: u!.id, email: u!.email, firstName: "Amina", lastName: "Test" }) }; if (suffix === "a") a = value; else b = value;
    }
    const promo = await pool.query(`INSERT INTO uc_promotions(code,type,effect_mode,effect_value,starts_at,active,created_by,updated_by) VALUES ('DURABLE_TEST','checkout_discount','fixed',100,now(),true,'test','test') RETURNING id`);
    promotionId = Number(promo.rows[0].id);
    server = http.createServer(app); await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port: number }; base = `http://127.0.0.1:${addr.port}/api`;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query("DELETE FROM uc_promotion_uses WHERE promotion_id=$1", [promotionId]);
    await pool.query("DELETE FROM uc_promotions WHERE id=$1", [promotionId]);
    if (ids.length) await pool.query("DELETE FROM uc_orders WHERE id=ANY($1::int[])", [ids]);
    await db.delete(ucUsersTable).where(eq(ucUsersTable.id, a.id)); await db.delete(ucUsersTable).where(eq(ucUsersTable.id, b.id));
  });
  it("replays sequential and concurrent keys once, while another account has its own key namespace", async () => {
    const one = await request("/uc/orders", checkout("same"), a.token); const two = await request("/uc/orders", checkout("same"), a.token);
    assert.equal(one.status, 200); assert.equal(two.status, 200); assert.equal(one.body.id, two.body.id); ids.push(one.body.id);
    const concurrent = await Promise.all([request("/uc/orders", checkout("race"), a.token), request("/uc/orders", checkout("race"), a.token)]);
    assert.equal(concurrent[0].body.id, concurrent[1].body.id); ids.push(concurrent[0].body.id);
    const separate = await request("/uc/orders", checkout("same"), b.token); assert.equal(separate.status, 200); assert.notEqual(separate.body.id, one.body.id); ids.push(separate.body.id);
    const orders = await pool.query("SELECT id FROM uc_orders WHERE id=ANY($1::int[])", [ids]); const uses = await pool.query("SELECT id FROM uc_promotion_uses WHERE promotion_id=$1", [promotionId]);
    assert.equal(orders.rows.length, 3); assert.equal(uses.rows.length, 3);
  });
  it("has no detached customer apply endpoint and leaves promotion usage unchanged", async () => {
    const before = await pool.query("SELECT count(*)::int AS n FROM uc_promotion_uses WHERE promotion_id=$1", [promotionId]);
    const response = await request("/uc/customer/promotions/checkout/apply", { code: "DURABLE_TEST", idempotencyKey: "cannot-spend" }, a.token);
    assert.ok([404, 405].includes(response.status));
    const after = await pool.query("SELECT count(*)::int AS n FROM uc_promotion_uses WHERE promotion_id=$1", [promotionId]);
    assert.equal(after.rows[0].n, before.rows[0].n);
  });
});