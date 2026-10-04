import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import app from "../app.js";
import { db, pool, ucUsersTable } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
let base = "";
let realFetch: typeof fetch;
let userId = 0;
let token = "";
let promoId = 0;
let remoteId = 880000;
let wcPosts: any[] = [];
let visibleOrders: any[] = [];
let mode: "success" | "accept-throw" | "throw" = "success";
const code = `WCSTATE${Date.now()}`;

function wcOrder(payload: any) {
  const id = ++remoteId;
  return {
    id, status: "processing", date_created: new Date().toISOString(), currency: "KES",
    total: "2999", payment_method: payload.payment_method, shipping: payload.shipping,
    line_items: payload.line_items.map((line: any) => ({ product_id: line.product_id, name: `Product ${line.product_id}`, quantity: line.quantity, total: line.product_id === 22 ? "1099" : "1999" })),
    meta_data: payload.meta_data,
  };
}

async function api(path: string, body?: unknown) {
  const response = await realFetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() as any };
}

const orderBody = (key: string) => ({
  lineItems: [{ productId: 22, quantity: 1 }, { productId: 23, quantity: 1 }],
  paymentMethod: "cod", shippingAddress: { firstName: "Amina", lastName: "Otieno", address1: "1 Test Rd", city: "Nairobi", country: "KE", phone: "0712345678" },
  promoCode: code, idempotencyKey: key,
});

describe("WC configured durable promoted checkout state machine", () => {
  before(async () => {
    realFetch = globalThis.fetch;
    process.env.SESSION_SECRET ??= "wc-promotion-state-test";
    process.env.WC_BASE_URL = "https://wc-promoted.test";
    process.env.WC_CONSUMER_KEY = "ck_test";
    process.env.WC_CONSUMER_SECRET = "cs_test";
    const hash = await bcrypt.hash("Test1234!", 4);
    const [user] = await db.insert(ucUsersTable).values({ email: `${code}@test.invalid`, passwordHash: hash, firstName: "Amina", lastName: "Otieno", phone: "+254712345678", isAdmin: true }).returning();
    userId = user!.id;
    token = issueToken({ id: userId, email: user!.email, firstName: "Amina", lastName: "Otieno" });
    const promotion = await pool.query(`INSERT INTO uc_promotions(code,type,effect_mode,effect_value,starts_at,active,created_by,updated_by) VALUES($1,'checkout_discount','percentage',50,now(),true,'test','test') RETURNING id`, [code]);
    promoId = Number(promotion.rows[0].id);
    await pool.query("INSERT INTO uc_promotion_products(promotion_id,product_id) VALUES($1,22)", [promoId]);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });

  beforeEach(() => {
    wcPosts = [];
    visibleOrders = [];
    mode = "success";
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      const value = String(url);
      if (value.includes("/wp-json/wc/v3/products")) return new Response(JSON.stringify([
        { id: 22, name: "Live filter 22", price: "1099", stock_status: "instock" },
        { id: 23, name: "Live filter 23", price: "1999", stock_status: "instock" },
      ]));
      if (value.includes("/wp-json/wc/v3/orders")) {
        if ((init?.method ?? "GET").toUpperCase() === "POST") {
          const payload = JSON.parse(String(init?.body));
          wcPosts.push(payload);
          const created = wcOrder(payload);
          if (mode === "accept-throw") { visibleOrders.push(created); throw new Error("timeout after acceptance"); }
          if (mode === "throw") throw new Error("timeout");
          visibleOrders.push(created);
          return new Response(JSON.stringify(created), { status: 201 });
        }
        return new Response(JSON.stringify(visibleOrders), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };
  });

  after(async () => {
    globalThis.fetch = realFetch;
    delete process.env.WC_BASE_URL; delete process.env.WC_CONSUMER_KEY; delete process.env.WC_CONSUMER_SECRET;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query("DELETE FROM uc_promotion_uses WHERE promotion_id=$1", [promoId]);
    await pool.query("DELETE FROM uc_order_items WHERE order_id IN (SELECT id FROM uc_orders WHERE user_id=$1)", [String(userId)]);
    await pool.query("DELETE FROM uc_orders WHERE user_id=$1", [String(userId)]);
    await pool.query("DELETE FROM uc_promotion_products WHERE promotion_id=$1", [promoId]);
    await pool.query("DELETE FROM uc_promotions WHERE id=$1", [promoId]);
    await pool.query("DELETE FROM uc_users WHERE id=$1", [userId]);
  });

  it("creates one promoted COD anchor/use and scopes its WC adjustment to eligible subtotal", async () => {
    const result = await api("/uc/orders", orderBody("success"));
    assert.equal(result.status, 200);
    assert.equal(result.body.id, visibleOrders[0].id);
    assert.equal(wcPosts.length, 1);
    const payload = wcPosts[0];
    assert.deepEqual(payload.line_items, [{ product_id: 22, quantity: 1, subtotal: "1099", total: "1099" }, { product_id: 23, quantity: 1, subtotal: "1999", total: "1999" }]);
    assert.equal(payload.fee_lines.length, 1);
    assert.equal(payload.fee_lines[0].total, "-549.5");
    assert.equal(payload.shipping_lines[0].total, "0");
    assert.equal(payload.fee_lines[0].taxable, false);
    assert.ok(payload.meta_data.some((m: any) => m.key === "uc_checkout_claim_id" && m.value));
    const rows = await pool.query("SELECT o.checkout_state,count(u.id)::int AS uses FROM uc_orders o JOIN uc_promotion_uses u ON u.operation_ref LIKE o.checkout_claim_id || ':%' WHERE o.user_id=$1 AND o.checkout_idempotency_key='success' GROUP BY o.checkout_state", [String(userId)]);
    assert.equal(rows.rows[0].checkout_state, "remote_confirmed");
    assert.equal(rows.rows[0].uses, 1);
  });

  it("sequential and concurrent retries make one remote create and one use", async () => {
    const first = await api("/uc/orders", orderBody("repeat"));
    const second = await api("/uc/orders", orderBody("repeat"));
    assert.equal(second.body.id, first.body.id);
    assert.equal(wcPosts.length, 1);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const stub = globalThis.fetch;
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      if (String(url).includes("/wp-json/wc/v3/orders") && init?.method === "POST") await gate;
      return stub(url, init);
    };
    const a = api("/uc/orders", orderBody("race"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const b = api("/uc/orders", orderBody("race"));
    release();
    const raced = await Promise.all([a, b]);
    const resolved = await api("/uc/orders", orderBody("race"));
    assert.equal(resolved.body.id, raced.find((r) => r.status === 200)!.body.id);
    assert.equal(wcPosts.length, 2); // one for repeat, one for race
    const uses = await pool.query("SELECT count(*)::int AS n FROM uc_promotion_uses WHERE promotion_id=$1 AND idempotency_key IN ('repeat','race')", [promoId]);
    assert.equal(uses.rows[0].n, 2);
  });

  it("reconciles timeout-after-acceptance without another POST", async () => {
    mode = "accept-throw";
    const first = await api("/uc/orders", orderBody("accepted-timeout"));
    assert.equal(first.status, 202);
    const retry = await api("/uc/orders", orderBody("accepted-timeout"));
    assert.equal(retry.status, 200);
    assert.equal(retry.body.id, visibleOrders[0].id);
    assert.equal(wcPosts.length, 1);
  });

  it("retains unknown claim when WC has no visible order and never posts twice", async () => {
    mode = "throw";
    const first = await api("/uc/orders", orderBody("unknown"));
    const retry = await api("/uc/orders", orderBody("unknown"));
    assert.equal(first.status, 202);
    assert.equal(retry.status, 202);
    assert.equal(retry.body.reconciliationRequired, true);
    assert.equal(wcPosts.length, 1);
  });

  it("lists one use once even with multiple eligible products", async () => {
    const extraCode = `COUNT${Date.now()}`;
    const inserted = await pool.query(`INSERT INTO uc_promotions(code,type,effect_mode,effect_value,starts_at,active,created_by,updated_by) VALUES($1,'checkout_discount','fixed',10,now(),true,'test','test') RETURNING id`, [extraCode]);
    const extraId = Number(inserted.rows[0].id);
    await pool.query("INSERT INTO uc_promotion_products(promotion_id,product_id) VALUES($1,22),($1,23)", [extraId]);
    await pool.query(`INSERT INTO uc_promotion_uses(promotion_id,user_id,operation,operation_ref,actor,idempotency_key,effect_snapshot,benefit_amount) VALUES($1,$2,'checkout','count-test','test','count-test','{}',10)`, [extraId,userId]);
    const result = await api("/uc/admin/promotions");
    assert.equal(result.status, 200);
    const promotion = result.body.promotions.find((row: any) => Number(row.id) === extraId);
    assert.equal(Number(promotion.use_count), 1);
    assert.equal(promotion.eligible_product_ids.length, 2);
    await pool.query("DELETE FROM uc_promotion_uses WHERE promotion_id=$1", [extraId]);
    await pool.query("DELETE FROM uc_promotion_products WHERE promotion_id=$1", [extraId]);
    await pool.query("DELETE FROM uc_promotions WHERE id=$1", [extraId]);
  });
});