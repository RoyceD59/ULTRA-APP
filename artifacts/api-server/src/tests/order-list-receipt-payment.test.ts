import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { before, after, describe, it } from "node:test";
import { pool } from "@workspace/db";
import {
  buildCustomerReceipt, receiptOrderPaymentStatus, customerReceiptHtml,
  customerReceiptText, type ReceiptOrder,
} from "@workspace/api-zod/order-receipt";
import { buildOrderReceiptEmail } from "../lib/email.js";
import { issueToken } from "../lib/jwt.js";

const realFetch = globalThis.fetch;
const originalEnv = {
  WC_BASE_URL: process.env["WC_BASE_URL"],
  WC_CONSUMER_KEY: process.env["WC_CONSUMER_KEY"],
  WC_CONSUMER_SECRET: process.env["WC_CONSUMER_SECRET"],
};
const email = `order-list-receipt-${randomUUID()}@test.internal`;
const wooId = 900_000_000 + Math.floor(Math.random() * 100_000_000);
let userId: number;
let orderId: number;
let bearer: string;
let server: http.Server;
let datePaid: string | null = "2026-10-07T09:00:00";

before(async () => {
  process.env["SESSION_SECRET"] ??= "order-list-receipt-test-only";
  process.env["WC_BASE_URL"] = "https://order-list-receipt.test";
  process.env["WC_CONSUMER_KEY"] = "receipt-test-key";
  process.env["WC_CONSUMER_SECRET"] = "receipt-test-secret";
  userId = (await pool.query<{ id: number }>(
    `INSERT INTO uc_users(email,password_hash,first_name) VALUES ($1,'x','Receipt') RETURNING id`,
    [email],
  )).rows[0]!.id;
  orderId = (await pool.query<{ id: number }>(
    `INSERT INTO uc_orders(user_id,status,total,currency,payment_method,wc_order_id,cod_collection_status)
     VALUES ($1,'processing','4100.50','KES','cod',$2,'awaiting_collection') RETURNING id`,
    [String(userId), wooId],
  )).rows[0]!.id;
  bearer = `Bearer ${issueToken({ id: userId, email })}`;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://order-list-receipt.test/")) {
      return new Response(JSON.stringify([{
        id: wooId, number: `WC-${wooId}`, status: "processing",
        date_created: "2026-10-07T08:00:00", date_paid: datePaid,
        total: "4100.50", currency: "KES", payment_method: "cod",
        billing: { email }, shipping: { city: "Nairobi" },
        line_items: [{ product_id: 1, name: "Hydra Flux", quantity: 1, total: "4100.50" }],
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, init);
  };
  const { default: app } = await import("../app.js");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await pool.query("DELETE FROM uc_orders WHERE id=$1", [orderId]);
  await pool.query("DELETE FROM uc_users WHERE id=$1", [userId]);
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

async function listedOrder() {
  const { port } = server.address() as { port: number };
  const response = await realFetch(`http://127.0.0.1:${port}/api/uc/orders`, {
    headers: { authorization: bearer },
  });
  assert.equal(response.status, 200);
  const orders = await response.json() as (ReceiptOrder & {
    status: string; paymentStatus: string; codCollectionStatus?: string | null;
  })[];
  assert.equal(orders.length, 1);
  assert.equal(orders[0]!.id, orderId);
  return orders[0]!;
}

describe("app-owned order-list projection to customer receipts", () => {
  it("uses explicit local payment evidence even when COD collection is not reconciled", async () => {
    await pool.query("UPDATE uc_orders SET payment_confirmed_at=now() WHERE id=$1", [orderId]);
    const order = await listedOrder();
    assert.equal(order.paymentStatus, "paid");
    const local = (await pool.query(
      "SELECT cod_collection_status,payment_confirmed_at FROM uc_orders WHERE id=$1", [orderId],
    )).rows[0];
    assert.equal(local.cod_collection_status, "awaiting_collection");
    assert.ok(local.payment_confirmed_at);
    const receipt = buildCustomerReceipt({
      ...order, paymentStatus: receiptOrderPaymentStatus(order),
    });
    const emailReceipt = buildOrderReceiptEmail({
      ...order, orderId: order.id, firstName: "Receipt", email,
      paymentStatus: receiptOrderPaymentStatus(order),
    });
    assert.equal(receipt.paymentState, "Paid");
    assert.equal(receipt.codPaymentDue, false);
    for (const output of [
      emailReceipt.html, emailReceipt.text, customerReceiptHtml(receipt), customerReceiptText(receipt),
    ]) {
      assert.ok(output.includes("Paid"));
      assert.ok(!output.includes("Payment due on delivery"));
      assert.ok(!output.includes("How to pay"));
      assert.ok(!output.includes("not proof of payment"));
    }
  });

  it("does not infer paid from fulfillment status without payment evidence", async () => {
    datePaid = null;
    await pool.query("UPDATE uc_orders SET payment_confirmed_at=null WHERE id=$1", [orderId]);
    const order = await listedOrder();
    assert.equal(order.paymentStatus, "awaiting_collection");
    const receipt = buildCustomerReceipt({ ...order, paymentStatus: receiptOrderPaymentStatus(order) });
    assert.equal(receipt.codPaymentDue, true);
    assert.notEqual(receipt.paymentState, "Paid");
  });

  it("keeps staff-confirmed local collection authoritative over a stale unpaid Woo mirror", async () => {
    datePaid = null;
    await pool.query("UPDATE uc_orders SET cod_collection_status='collected' WHERE id=$1", [orderId]);
    const order = await listedOrder();
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.codCollectionStatus, "collected");
    assert.equal(buildCustomerReceipt(order).codPaymentDue, false);
  });
});
