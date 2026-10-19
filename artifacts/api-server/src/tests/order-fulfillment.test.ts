import { before, after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../app.js";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { processOrderNotificationOutbox } from "../lib/order-status-pipeline.js";
import { orderShippedSms, orderReadyToCollectSms } from "../lib/sms.js";
import { reconcileCanonicalPurchaseDualWrite } from "../lib/canonical-purchase-dual-write.js";

const realFetch = globalThis.fetch;
let server: http.Server;
let base: string;
let customerId: number;
let adminId: number;
let adminToken: string;
const orders: number[] = [];
const envKeys = ["AT_API_KEY", "AT_USERNAME", "RESEND_API_KEY", "RESEND_BASE_URL", "UC_CANONICAL_DUAL_WRITES"] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

async function order(status = "processing", stage = "accepted") {
  const result = await pool.query(
    `INSERT INTO uc_orders(user_id,status,total,payment_method,customer_stage)
     VALUES ($1,$2,'2000','cod',$3) RETURNING id`, [String(customerId), status, stage],
  );
  const id = Number(result.rows[0].id);
  orders.push(id);
  return id;
}
async function patch(id: number, body: unknown, token = adminToken) {
  return realFetch(`${base}/uc/orders/${id}/status`, {
    method: "PATCH", headers: { "Content-Type": "application/json", authorization: token },
    body: JSON.stringify(body),
  });
}
async function outbox(id: number) {
  return (await pool.query("SELECT * FROM uc_order_notification_outbox WHERE order_id=$1 ORDER BY id", [id])).rows;
}

describe("order shipping and collection notifications", { concurrency: false }, () => {
  before(async () => {
    const stamp = `${Date.now()}-${process.pid}`;
    for (const isAdmin of [false, true]) {
      const user = await pool.query(
        `INSERT INTO uc_users(email,password_hash,first_name,is_admin,phone)
         VALUES ($1,'unused','Fulfillment',$2,'+254712345678') RETURNING id`,
        [`fulfillment-${isAdmin}-${stamp}@uctest.internal`, isAdmin],
      );
      if (isAdmin) adminId = Number(user.rows[0].id); else customerId = Number(user.rows[0].id);
    }
    adminToken = `Bearer ${issueToken({ id: adminId, email: "admin@uctest.internal" })}`;
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server");
    base = `http://127.0.0.1:${address.port}/api`;
  });
  afterEach(async () => {
    globalThis.fetch = realFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
    }
    await pool.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[]))", [orders]);
    await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[])", [orders]);
    await pool.query("DELETE FROM uc_orders WHERE id=ANY($1::int[])", [orders]);
    await pool.query("DELETE FROM uc_notif_prefs WHERE user_id=$1", [String(customerId)]);
    await pool.query("DELETE FROM uc_push_tokens WHERE user_id=$1", [String(customerId)]);
    orders.length = 0;
  });
  after(async () => {
    await pool.query("DELETE FROM uc_users WHERE id=ANY($1::int[])", [[customerId, adminId]]);
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it("requires a live admin and validates status, location, tracking, dates, and notes", async () => {
    const id = await order();
    assert.equal((await patch(id, { status: "shipped" }, "")).status, 403);
    const customerToken = `Bearer ${issueToken({ id: customerId, email: "customer@uctest.internal" })}`;
    assert.equal((await patch(id, { status: "shipped" }, customerToken)).status, 403);
    for (const input of [
      { status: "paid" }, { status: "ready-to-collect" }, { status: "ready-to-collect", collectionLocation: " " },
      { status: "shipped", trackingUrl: "javascript:alert(1)" },
      { status: "shipped", trackingUrl: "https://user:password@example.com" },
      { status: "shipped", estimatedDelivery: "2026-02-30" },
      { status: "shipped", note: 5 }, { status: "shipped", note: "x".repeat(501) },
      { status: "shipped", idempotencyKey: "" },
    ]) assert.equal((await patch(id, input)).status, 400);
    assert.equal((await outbox(id)).length, 0);
    assert.equal((await patch(2147483647, { status: "shipped" })).status, 404);
  });

  it("persists shipped status and all details atomically and absorbs concurrent/re-keyed repeats", async () => {
    const id = await order();
    const input = { status: "shipped", trackingNumber: "UC123", trackingUrl: "https://example.com/driver",
      estimatedDelivery: "2026-10-09", note: "Please keep your phone available." };
    const responses = await Promise.all([patch(id, input), patch(id, input)]);
    assert.ok(responses.every(response => response.status === 200));
    const bodies = await Promise.all(responses.map(response => response.json()));
    assert.equal(bodies.filter(body => body.repeated).length, 1);
    assert.equal((await pool.query("SELECT status,customer_stage FROM uc_orders WHERE id=$1", [id])).rows[0].status, "shipped");
    const rows = await outbox(id);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => row.payload.channel ?? "push"), ["push", "sms", "email"]);
    assert.equal(rows[0].payload.fulfillment.trackingNumber, "UC123");
    assert.match(rows[1].payload.message, /Estimated delivery: 2026-10-09/);
    assert.match(rows[1].payload.message, /Track your driver: https:\/\/example.com\/driver/);
    assert.equal((await patch(id, { ...input, idempotencyKey: "another-key" })).status, 200);
    assert.equal((await outbox(id)).length, 3);
  });

  it("uses collection-specific text and does not mark COD cash as collected", async () => {
    const id = await order();
    assert.equal((await patch(id, { status: "ready-to-collect", collectionLocation: "Westlands pickup point", note: "Bring your order number." })).status, 200);
    const saved = (await pool.query("SELECT status,cod_collection_status FROM uc_orders WHERE id=$1", [id])).rows[0];
    assert.equal(saved.status, "ready-to-collect");
    assert.equal(saved.cod_collection_status, null);
    const rows = await outbox(id);
    assert.match(rows[1].payload.message, /ready to collect from Westlands pickup point/);
    assert.doesNotMatch(rows[1].payload.message, /on its way/);
    assert.match(rows[0].payload.message, /Bring your order number/);
  });

  it("rejects terminal orders without changing status or queuing notifications", async () => {
    for (const status of ["refunded", "cancelled", "declined", "completed", "delivered"]) {
      const id = await order(status);
      assert.equal((await patch(id, { status: "shipped" })).status, 409);
      assert.equal((await outbox(id)).length, 0);
      assert.equal((await pool.query("SELECT status FROM uc_orders WHERE id=$1", [id])).rows[0].status, status);
    }
    const id = await order("processing", "delivered");
    assert.equal((await patch(id, { status: "shipped" })).status, 409);
  });

  it("preserves legacy paid classification through shipping and collection without inventing confirmation timestamps", async () => {
    process.env.UC_CANONICAL_DUAL_WRITES = "true";
    for (const previousStatus of ["processing", "paid"]) {
      const id = await order(previousStatus);
      await pool.query("UPDATE uc_orders SET payment_method='paystack' WHERE id=$1", [id]);
      await reconcileCanonicalPurchaseDualWrite(id);
      const before = (await pool.query("SELECT payment_status FROM uc_canonical_purchases WHERE companion_order_id=$1", [id])).rows[0];
      assert.equal(before.payment_status, "paid");
      for (const status of ["shipped", "ready-to-collect"]) {
        assert.equal((await patch(id, { status, collectionLocation: "Westlands" })).status, 200);
        const purchase = (await pool.query("SELECT payment_status,fulfilment_status FROM uc_canonical_purchases WHERE companion_order_id=$1", [id])).rows[0];
        assert.deepEqual(purchase, { payment_status: "paid", fulfilment_status: "processing" });
        const source = (await pool.query("SELECT payment_confirmed_at,fulfillment_payment_status FROM uc_orders WHERE id=$1", [id])).rows[0];
        assert.equal(source.payment_confirmed_at, null);
        assert.equal(source.fulfillment_payment_status, "paid");
      }
    }
  });

  it("keeps uncollected COD orders unpaid and collected COD orders paid during fulfillment", async () => {
    process.env.UC_CANONICAL_DUAL_WRITES = "true";
    for (const collected of [false, true]) {
      const id = await order("processing");
      await pool.query("UPDATE uc_orders SET cod_collection_status=$2 WHERE id=$1",
        [id, collected ? "collected" : "awaiting_collection"]);
      assert.equal((await patch(id, { status: "ready-to-collect", collectionLocation: "Westlands" })).status, 200);
      const purchase = (await pool.query("SELECT payment_status,fulfilment_status FROM uc_canonical_purchases WHERE companion_order_id=$1", [id])).rows[0];
      assert.deepEqual(purchase, { payment_status: collected ? "paid" : "pending", fulfilment_status: "processing" });
    }
  });

  it("delivers SMS and email without a push token and retries only the failed channel", async () => {
    const id = await order();
    process.env.AT_API_KEY = "stub";
    process.env.AT_USERNAME = "stub";
    process.env.RESEND_API_KEY = "stub";
    process.env.RESEND_BASE_URL = "https://resend.test";
    let smsCalls = 0;
    let emailCalls = 0;
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      if (target.includes("africastalking.com")) {
        smsCalls++;
        assert.match(String(init?.body), /on\+its\+way/);
        return new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: smsCalls === 1 ? 502 : 101 }] } }), { status: 200 });
      }
      if (target.includes("resend.test")) {
        emailCalls++;
        assert.match(String(init?.body), /on its way/);
        assert.ok(new Headers(init?.headers).get("Idempotency-Key"));
        return new Response(JSON.stringify({ id: "fulfillment-email" }), { status: 200 });
      }
      throw new Error(`Unexpected outbound request: ${target}`);
    };
    assert.equal((await patch(id, { status: "shipped" })).status, 200);
    const first = await processOrderNotificationOutbox();
    assert.equal(first.sent, 1);
    assert.equal(first.failed, 1);
    assert.equal(first.skipped, 1);
    const failures = (await pool.query(
      "SELECT id,recipient,message_body,template FROM uc_notification_log WHERE order_id=$1 AND channel='sms' AND status='failed'", [id],
    )).rows;
    assert.equal(failures.length, 1, "only the actual provider attempt should be audited");
    assert.equal(failures[0].recipient, "+254712345678");
    assert.match(failures[0].message_body, /on its way/);
    assert.equal(failures[0].template, "order_shipped");
    const retry = await realFetch(`${base}/uc/admin/notification-logs/${failures[0].id}/retry`, {
      method: "POST", headers: { authorization: adminToken },
    });
    assert.equal(retry.status, 200);
    assert.equal(smsCalls, 1, "admin retry must use the same outbox, not send alongside it");
    assert.equal((await processOrderNotificationOutbox()).sent, 1);
    assert.equal(emailCalls, 1);
    assert.equal(smsCalls, 2);
    assert.deepEqual((await outbox(id)).map(row => row.status), ["skipped", "sent", "sent"]);
    const staleRetry = await realFetch(`${base}/uc/admin/notification-logs/${failures[0].id}/retry`, {
      method: "POST", headers: { authorization: adminToken },
    });
    assert.equal(staleRetry.status, 409);
  });

  it("honors order notification opt-out across all channels", async () => {
    const id = await order();
    await pool.query("INSERT INTO uc_notif_prefs(user_id,opt_out_orders) VALUES ($1,true)", [String(customerId)]);
    globalThis.fetch = async () => { throw new Error("Opted-out customer must not trigger a provider"); };
    assert.equal((await patch(id, { status: "shipped" })).status, 200);
    assert.equal((await processOrderNotificationOutbox()).skipped, 3);
  });

  it("queues failed email retries against the original work item with the customer's real address", async () => {
    const id = await order();
    process.env.AT_API_KEY = "stub";
    process.env.AT_USERNAME = "stub";
    process.env.RESEND_API_KEY = "stub";
    process.env.RESEND_BASE_URL = "https://resend.test";
    let emailCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("africastalking.com")) {
        return new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } }), { status: 200 });
      }
      if (String(url).includes("resend.test")) {
        emailCalls++;
        return emailCalls === 1 ? new Response("Unavailable", { status: 503 })
          : new Response(JSON.stringify({ id: "collection-email" }), { status: 200 });
      }
      throw new Error("Unexpected provider");
    };
    assert.equal((await patch(id, { status: "ready-to-collect", collectionLocation: "Westlands" })).status, 200);
    assert.equal((await processOrderNotificationOutbox()).failed, 1);
    const failures = (await pool.query(
      "SELECT id,recipient,message_body FROM uc_notification_log WHERE order_id=$1 AND channel='email' AND status='failed'", [id],
    )).rows;
    assert.equal(failures.length, 1);
    assert.match(failures[0].recipient, /^fulfillment-false-.*@uctest\.internal$/);
    assert.match(failures[0].message_body, /ready to collect from Westlands/);
    const retry = await realFetch(`${base}/uc/admin/notification-logs/${failures[0].id}/retry`, {
      method: "POST", headers: { authorization: adminToken },
    });
    assert.equal(retry.status, 200);
    assert.equal(emailCalls, 1);
    assert.equal((await processOrderNotificationOutbox()).sent, 1);
    assert.equal(emailCalls, 2);
  });

  it("pushes the same collection details to Expo on the same status change", async () => {
    const id = await order();
    await pool.query("INSERT INTO uc_push_tokens(user_id,push_token) VALUES ($1,$2)",
      [String(customerId), "ExponentPushToken[fulfillment-test]"]);
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /exp\.host/);
      const payload = JSON.parse(String(init?.body))[0];
      assert.match(payload.body, /ready to collect from Westlands/);
      assert.equal(payload.data.orderId, id);
      calls++;
      return new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 });
    };
    assert.equal((await patch(id, { status: "ready-to-collect", collectionLocation: "Westlands" })).status, 200);
    assert.equal((await processOrderNotificationOutbox(1)).sent, 1);
    assert.equal(calls, 1);
  });

  it("retains a failed SMS for retry when credentials are absent", async () => {
    delete process.env.AT_API_KEY;
    delete process.env.AT_USERNAME;
    const id = await order();
    assert.equal((await patch(id, { status: "shipped" })).status, 200);
    assert.equal((await processOrderNotificationOutbox(2)).failed, 1);
    const rows = await outbox(id);
    assert.equal(rows[1].status, "failed");
    assert.equal(rows[1].attempt_count, 1);
    assert.equal((await pool.query("SELECT status FROM uc_orders WHERE id=$1", [id])).rows[0].status, "shipped");
  });

  it("omits unavailable details rather than inventing an ETA or tracking link", () => {
    assert.equal(orderShippedSms({ orderId: 123 }), "Your Ultra Clear order #123 is on its way!");
    assert.equal(orderReadyToCollectSms({ orderId: 123, collectionLocation: "Depot" }),
      "Your Ultra Clear order #123 is ready to collect from Depot.");
  });
});