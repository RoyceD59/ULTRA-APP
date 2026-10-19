import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import http from "node:http";
import { pool } from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import { hasWCCredentials, wcCreateCheckoutOrder } from "../routes/uc.js";
import { assignmentOrderLines } from "../lib/customer-assignments.js";
import { runLifespanAuditAlert } from "../lib/scheduler.js";

const realFetch = globalThis.fetch, savedEnv = { ...process.env };
let server: http.Server, base: string, userId: number;
const orders: number[] = [];
let remoteCalls = 0;
before(async () => {
  process.env.WC_BASE_URL = "https://retired-woocommerce.invalid";
  process.env.WC_CONSUMER_KEY = "fixture";
  process.env.WC_CONSUMER_SECRET = "fixture";
  process.env.WC_WEBHOOK_SECRET = "retirement-fixture";
  userId = (await pool.query<{ id: number }>(`INSERT INTO uc_users(email,password_hash,first_name)
    VALUES($1,'unused','Fixture') RETURNING id`, [`retired-${randomUUID()}@example.test`])).rows[0]!.id;
  globalThis.fetch = async (input) => {
    if (!String(input).includes("/.well-known/") && !String(input).includes("clerk")) remoteCalls++;
    throw new Error("A retired integration must not make network requests");
  };
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/uc`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = realFetch;
  await pool.query("DELETE FROM uc_orders WHERE id=ANY($1::int[])", [orders]);
  await pool.query("DELETE FROM uc_users WHERE id=$1", [userId]);
  for (const key of ["WC_BASE_URL", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET", "WC_WEBHOOK_SECRET", "UC_CANONICAL_DUAL_WRITES"]) {
    if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  }
});
test("credentials cannot re-enable Woo product/order transport or create a remote checkout", async () => {
  assert.equal(hasWCCredentials(), false);
  assert.equal(await wcCreateCheckoutOrder({ payment_method: "cod", line_items: [{ product_id: 1 }] }), null);
  assert.equal(remoteCalls, 0);
});
test("signed, unsigned, repeated and out-of-order Woo webhooks return 410 without any ledger/event/outbox writes", async () => {
  const wooId = 900000000 + Math.floor(Math.random() * 10000000);
  const id = (await pool.query<{ id: number }>(`INSERT INTO uc_orders
    (user_id,status,total,currency,payment_method,wc_order_id)
    VALUES($1,'pending','100','KES','cod',$2) RETURNING id`, [String(userId), wooId])).rows[0]!.id;
  orders.push(id);
  const before = (await pool.query("SELECT * FROM uc_orders WHERE id=$1", [id])).rows[0];
  for (const flag of ["false", "true"]) {
    process.env.UC_CANONICAL_DUAL_WRITES = flag;
    for (const status of ["processing", "completed", "processing", "cancelled"]) {
      const raw = JSON.stringify({ id: wooId, status, date_paid: "2026-10-17T12:00:00" });
      for (const signed of [false, true]) {
        const response = await realFetch(`${base}/webhooks/woocommerce`, {
          method: "POST", headers: { "content-type": "application/json",
            ...(signed ? { "x-wc-webhook-signature": createHmac("sha256", "retirement-fixture").update(raw).digest("base64") } : {}) },
          body: raw,
        });
        assert.equal(response.status, 410);
        assert.match((await response.json()).error, /retired/i);
      }
    }
  }
  assert.deepEqual((await pool.query("SELECT * FROM uc_orders WHERE id=$1", [id])).rows[0], before);
  for (const [table, column, value] of [
    ["uc_canonical_purchases", "companion_order_id", id],
    ["uc_customer_stage_events", "resource_id", String(id)],
    ["uc_order_notification_outbox", "order_id", id],
  ] as const) {
    assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [value])).rowCount, 0);
  }
  assert.equal(remoteCalls, 0);
});
test("legacy order payloads never create, release, promote or confirm pending-Woo anchors", async () => {
  const reference = `retired-${randomUUID()}`, key = randomUUID();
  const id = (await pool.query<{ id: number }>(`INSERT INTO uc_orders
    (user_id,status,total,currency,payment_method,payment_reference,checkout_idempotency_key,date_created)
    VALUES($1,'pending-wc','100','KES','paystack',$2,$3,now()-interval '2 days') RETURNING id`,
    [String(userId), reference, key])).rows[0]!.id;
  orders.push(id);
  const before = (await pool.query("SELECT * FROM uc_orders WHERE id=$1", [id])).rows[0];
  for (const promoCode of [undefined, "RETIRED-PROMO"]) {
    for (const method of ["paystack", "mpesa", "cod"]) {
      const payload = { paymentMethod: method, paymentReference: reference, idempotencyKey: key, promoCode,
        lineItems: [{ productId: 1, quantity: 1 }], shippingAddress: { firstName: "Amina", phone: "+254712345678" } };
      const responses = await Promise.all([1, 2].map(() => realFetch(`${base}/orders`, {
        method: "POST", headers: { authorization: `Bearer ${issueToken({ id: userId })}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      })));
      for (const response of responses) {
        assert.equal(response.status, 202);
        const body = await response.json();
        assert.equal(body.id, id);
        assert.equal(body.reconciliationRequired, true);
        assert.notEqual(body.paymentStatus, "paid");
      }
      const denied = await realFetch(`${base}/orders`, {
        method: "POST", headers: { authorization: `Bearer ${issueToken({ id: userId + 100000 })}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(denied.status, 409);
      const denial = await denied.json();
      assert.equal(denial.code, "APP_CHECKOUT_REFRESH_REQUIRED");
      assert.equal(denial.retryable, false);
      assert.equal(denial.id, undefined);
    }
  }
  assert.deepEqual((await pool.query("SELECT * FROM uc_orders WHERE id=$1", [id])).rows[0], before);
  assert.equal((await pool.query("SELECT id FROM uc_orders WHERE payment_reference=$1", [reference])).rowCount, 1);
  assert.equal(remoteCalls, 0);
});
test("unimported Woo assignments fail explicitly instead of mirroring a sale or claiming ownership", async () => {
  const reference = 980000000 + Math.floor(Math.random() * 10000000);
  await assert.rejects(() => assignmentOrderLines(`woo:${reference}`),
    (error: any) => error.code === "SOURCE_UNAVAILABLE" && error.status === 503);
  assert.equal((await pool.query("SELECT id FROM uc_orders WHERE wc_order_id=$1", [reference])).rowCount, 0);
  assert.equal(remoteCalls, 0);
});
test("retired lifespan audit does not fetch products, send messages or change alert history", async () => {
  const before = (await pool.query("SELECT * FROM uc_lifespan_alerts ORDER BY product_id")).rows;
  let fetched = false, sent = false;
  assert.deepEqual(await runLifespanAuditAlert({
    fetchProducts: async () => { fetched = true; return []; },
    sendEmail: async () => { sent = true; return true; },
  }), { flagged: 0, newlyAlerted: 0, emailed: false });
  assert.equal(fetched, false); assert.equal(sent, false);
  assert.deepEqual((await pool.query("SELECT * FROM uc_lifespan_alerts ORDER BY product_id")).rows, before);
  assert.equal(remoteCalls, 0);
});
