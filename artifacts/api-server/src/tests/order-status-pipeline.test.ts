import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import {
  processOrderNotificationOutbox,
  transitionOrderStatus,
} from "../lib/order-status-pipeline.js";
import { pool } from "@workspace/db";

let server: http.Server;
let base: string;
let userId: number;
let userEmail: string;
const orderIds: number[] = [];
const originalFetch = globalThis.fetch;
const wooSecret = "order-status-test-secret";

async function createOrder(wcOrderId: number): Promise<number> {
  const result = await pool.query(
    `INSERT INTO uc_orders
       (user_id,status,total,currency,payment_method,wc_order_id)
     VALUES ($1,'pending','1000','KES','cod',$2) RETURNING id`,
    [String(userId), wcOrderId],
  );
  const id = Number(result.rows[0].id);
  orderIds.push(id);
  return id;
}

async function reconcileHistoricalStatus(body: Record<string, unknown>, deliveryId: string) {
  // Historical ordering/deduplication remains an internal reconciliation
  // contract, not a live webhook. HTTP retirement is covered in woo-retirement.
  const order = (await pool.query("SELECT id FROM uc_orders WHERE wc_order_id=$1", [body.id])).rows[0];
  await transitionOrderStatus({
    orderId: order.id, status: String(body.status),
    modifiedAt: body.date_modified_gmt as string | undefined,
    deliveryId, source: "reconciliation",
  });
  return { status: 200 };
}

async function outboxFor(orderId: number) {
  return pool.query(
    "SELECT * FROM uc_order_notification_outbox WHERE order_id=$1 ORDER BY id",
    [orderId],
  );
}

describe("reliable customer order-status pipeline", { concurrency: false }, () => {
  before(async () => {
    process.env["SESSION_SECRET"] = process.env["SESSION_SECRET"] || "order-status-session-secret";
    process.env["WC_WEBHOOK_SECRET"] = wooSecret;
    userEmail = `order-status-${Date.now()}@uctest.internal`;
    const user = await pool.query(
      `INSERT INTO uc_users (email,password_hash,first_name,last_name,is_admin)
       VALUES ($1,'unused','Order','Status',false) RETURNING id`,
      [userEmail],
    );
    userId = Number(user.rows[0].id);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server address");
    base = `http://127.0.0.1:${address.port}/api`;
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await pool.query("DELETE FROM uc_orders WHERE id = ANY($1::int[])", [orderIds]);
    await pool.query("DELETE FROM uc_users WHERE id=$1", [userId]);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  });

  afterEach(async () => {
    await pool.query("DELETE FROM uc_orders WHERE id = ANY($1::int[])", [orderIds]);
    await pool.query("DELETE FROM uc_push_tokens WHERE user_id=$1", [String(userId)]);
    await pool.query("DELETE FROM uc_notif_prefs WHERE user_id=$1", [String(userId)]);
    orderIds.length = 0;
  });

  it("reconciles a retained historical transition and exposes the account projection", async () => {
    const orderId = await createOrder(41001);
    await pool.query("UPDATE uc_orders SET shipping_address=$2::jsonb WHERE id=$1", [
      orderId, JSON.stringify({ name: "Order Status", address: "Nairobi", city: "Nairobi", country: "KE" }),
    ]);
    await pool.query(
      `INSERT INTO uc_order_items (order_id,product_id,name,quantity,total)
       VALUES ($1,1,'Hydra Flux',2,'6998')`,
      [orderId],
    );
    const modified = "2026-04-01T10:00:00";
    const response = await reconcileHistoricalStatus(
      { id: 41001, status: "processing", date_modified_gmt: modified },
      "delivery-accepted-1",
    );
    assert.equal(response.status, 200);

    const order = await pool.query(
      "SELECT status,customer_stage FROM uc_orders WHERE id=$1",
      [orderId],
    );
    assert.deepEqual(order.rows[0], { status: "processing", customer_stage: "accepted" });
    assert.equal((await pool.query(
      "SELECT count(*)::int AS count FROM uc_customer_stage_events WHERE resource_type='order' AND resource_id=$1",
      [String(orderId)],
    )).rows[0].count, 1);
    assert.equal((await outboxFor(orderId)).rows.length, 1);

    const token = `Bearer ${issueToken({ id: userId, email: userEmail })}`;
    const detail = await fetch(`${base}/uc/orders/${orderId}`, {
      headers: { authorization: token },
    });
    assert.equal(detail.status, 200);
    const projection = await detail.json() as {
      customerStage: string;
      statusEvents: Array<{ stage: string; status: string; eventKey: string }>;
    };
    assert.equal(projection.customerStage, "accepted");
    assert.equal(projection.statusEvents.length, 1);
    assert.equal(projection.statusEvents[0]?.stage, "accepted");
    assert.equal(projection.statusEvents[0]?.status, "processing");
    assert.ok(projection.statusEvents[0]?.eventKey);

    // The Woo-facing route parameter resolves to the local order first.
    const wooDetail = await fetch(`${base}/uc/orders/41001`, {
      headers: { authorization: token },
    });
    assert.equal(wooDetail.status, 200);
    const contract = await wooDetail.json() as {
      id: number;
      lineItems: Array<{ name: string; quantity: number; total: string }>;
      shippingAddress: { city: string };
      paymentMethod: string;
      dateCreated: string;
      total: string;
      statusEvents: unknown[];
    };
    assert.equal(contract.id, orderId);
    assert.deepEqual(contract.lineItems, [{ productId: 1, name: "Hydra Flux", quantity: 2, total: "6998" }]);
    assert.equal(contract.shippingAddress.city, "Nairobi");
    assert.equal(contract.paymentMethod, "cod");
    assert.ok(contract.dateCreated);
    assert.equal(contract.total, "1000");
    assert.equal(contract.statusEvents.length, 1);
  });

  it("deduplicates a retained historical delivery and deterministic reconciliation key", async () => {
    const orderId = await createOrder(41002);
    const body = { id: 41002, status: "processing", date_modified_gmt: "2026-04-01T11:00:00" };
    assert.equal((await reconcileHistoricalStatus(body, "delivery-replay-1")).status, 200);
    assert.equal((await reconcileHistoricalStatus(body, "delivery-replay-1")).status, 200);
    const replay = await transitionOrderStatus({
      orderId,
      status: "processing",
      modifiedAt: body.date_modified_gmt,
      source: "reconciliation",
    });
    assert.equal(replay.repeated, true);
    assert.equal((await pool.query(
      "SELECT count(*)::int AS count FROM uc_customer_stage_events WHERE resource_type='order' AND resource_id=$1",
      [String(orderId)],
    )).rows[0].count, 1);
    assert.equal((await outboxFor(orderId)).rows.length, 1);
  });

  it("rejects a staff stage regression after the order advances", async () => {
    const orderId = await createOrder(41003);
    await transitionOrderStatus({
      orderId,
      status: "processing",
      customerStage: "accepted",
      eventKey: "staff:41003:accepted",
      source: "staff",
    });
    await transitionOrderStatus({
      orderId,
      status: "shipped",
      customerStage: "shipped",
      eventKey: "staff:41003:shipped",
      source: "staff",
    });
    await assert.rejects(
      transitionOrderStatus({
        orderId,
        status: "processing",
        customerStage: "accepted",
        eventKey: "staff:41003:regression",
        source: "staff",
      }),
      (error: Error & { code?: string }) => error.code === "INVALID_STAGE_TRANSITION",
    );
    assert.equal((await pool.query(
      "SELECT customer_stage FROM uc_orders WHERE id=$1",
      [orderId],
    )).rows[0].customer_stage, "shipped");
  });

  it("rejects an out-of-order historical update without overwriting the newer projection", async () => {
    const orderId = await createOrder(41007);
    assert.equal((await reconcileHistoricalStatus(
      { id: 41007, status: "processing", date_modified_gmt: "2026-04-01T12:00:00" },
      "delivery-order-1",
    )).status, 200);
    assert.equal((await reconcileHistoricalStatus(
      { id: 41007, status: "shipped", date_modified_gmt: "2026-04-01T13:00:00" },
      "delivery-order-2",
    )).status, 200);
    assert.equal((await reconcileHistoricalStatus(
      { id: 41007, status: "cancelled", date_modified_gmt: "2026-04-01T12:30:00" },
      "delivery-order-old",
    )).status, 200);
    const order = await pool.query(
      "SELECT status,customer_stage,woo_status_modified_at FROM uc_orders WHERE id=$1",
      [orderId],
    );
    assert.equal(order.rows[0]?.status, "shipped");
    assert.equal(order.rows[0]?.customer_stage, "shipped");
    assert.equal(new Date(order.rows[0]?.woo_status_modified_at).toISOString(), "2026-04-01T13:00:00.000Z");
    assert.deepEqual((await pool.query(
      "SELECT status FROM uc_customer_stage_events WHERE resource_id=$1 ORDER BY id",
      [String(orderId)],
    )).rows.map(row => row.status), ["processing", "shipped", "cancelled"]);
  });

  it("records a timestamp-less historical update without changing the projection", async () => {
    const orderId = await createOrder(41010);
    assert.equal((await reconcileHistoricalStatus(
      { id: 41010, status: "processing", date_modified_gmt: "2026-04-01T15:00:00" },
      "delivery-timestamped-1",
    )).status, 200);
    assert.equal((await reconcileHistoricalStatus(
      { id: 41010, status: "shipped", date_modified_gmt: "2026-04-01T16:00:00" },
      "delivery-timestamped-2",
    )).status, 200);
    assert.equal((await reconcileHistoricalStatus(
      { id: 41010, status: "cancelled" },
      "delivery-timestampless-stale",
    )).status, 200);
    const order = await pool.query(
      "SELECT status,customer_stage FROM uc_orders WHERE id=$1",
      [orderId],
    );
    assert.deepEqual(order.rows[0], { status: "shipped", customer_stage: "shipped" });
    assert.equal((await outboxFor(orderId)).rows.length, 2);
    assert.deepEqual((await pool.query(
      "SELECT status,stage,source_modified_at FROM uc_customer_stage_events WHERE resource_id=$1 ORDER BY id",
      [String(orderId)],
    )).rows, [
      { status: "processing", stage: "accepted", source_modified_at: new Date("2026-04-01T15:00:00.000Z") },
      { status: "shipped", stage: "shipped", source_modified_at: new Date("2026-04-01T16:00:00.000Z") },
      { status: "cancelled", stage: "shipped", source_modified_at: null },
    ]);
  });

  it("keeps provider failures retryable and succeeds on a later attempt", async () => {
    const orderId = await createOrder(41004);
    await transitionOrderStatus({
      orderId,
      status: "processing",
      customerStage: "accepted",
      eventKey: "provider-failure-1",
      source: "staff",
    });
    await pool.query("INSERT INTO uc_push_tokens (user_id,push_token) VALUES ($1,$2)", [
      String(userId), "ExponentPushToken[retryable]",
    ]);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ data: [{ status: "error", details: { error: "MessageRateExceeded" } }] }), { status: 200 });
      return new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 });
    }) as typeof fetch;
    const first = await processOrderNotificationOutbox();
    assert.equal(first.failed, 1);
    assert.equal((await outboxFor(orderId)).rows[0]?.status, "failed");
    await pool.query(
      "UPDATE uc_order_notification_outbox SET next_attempt_at=now() WHERE order_id=$1",
      [orderId],
    );
    const second = await processOrderNotificationOutbox();
    assert.equal(second.sent, 1);
    assert.equal((await outboxFor(orderId)).rows[0]?.status, "sent");
  });

  it("retains the account event but suppresses opted-out push delivery", async () => {
    const orderId = await createOrder(41005);
    await transitionOrderStatus({
      orderId,
      status: "processing",
      customerStage: "accepted",
      eventKey: "opt-out-1",
      source: "staff",
    });
    await pool.query(
      "INSERT INTO uc_notif_prefs (user_id,opt_out_orders) VALUES ($1,true)",
      [String(userId)],
    );
    globalThis.fetch = (async () => {
      throw new Error("Expo must not be called for opted-out users");
    }) as typeof fetch;
    const result = await processOrderNotificationOutbox();
    assert.equal(result.skipped, 1);
    assert.equal((await outboxFor(orderId)).rows[0]?.status, "skipped");
    assert.equal((await pool.query(
      "SELECT count(*)::int AS count FROM uc_customer_stage_events WHERE resource_id=$1",
      [String(orderId)],
    )).rows[0].count, 1);
  });

  it("removes a stale Expo token without losing the account event", async () => {
    const orderId = await createOrder(41006);
    await transitionOrderStatus({
      orderId,
      status: "processing",
      customerStage: "accepted",
      eventKey: "stale-token-1",
      source: "staff",
    });
    await pool.query("DELETE FROM uc_notif_prefs WHERE user_id=$1", [String(userId)]);
    await pool.query("INSERT INTO uc_push_tokens (user_id,push_token) VALUES ($1,$2)", [
      String(userId), "ExponentPushToken[stale]",
    ]);
    globalThis.fetch = (async () => {
      await pool.query("UPDATE uc_push_tokens SET push_token=$2 WHERE user_id=$1", [
        String(userId), "ExponentPushToken[newly-rotated]",
      ]);
      return new Response(
        JSON.stringify({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const result = await processOrderNotificationOutbox();
    assert.equal(result.skipped, 1);
    assert.deepEqual((await pool.query(
      "SELECT push_token FROM uc_push_tokens WHERE user_id=$1",
      [String(userId)],
    )).rows[0], { push_token: "ExponentPushToken[newly-rotated]" });
    assert.equal((await pool.query(
      "SELECT count(*)::int AS count FROM uc_customer_stage_events WHERE resource_id=$1",
      [String(orderId)],
    )).rows[0].count, 1);
  });

  it("fences reclaimed outbox completion to the active claim", async () => {
    const orderId = await createOrder(41008);
    await transitionOrderStatus({
      orderId,
      status: "processing",
      customerStage: "accepted",
      eventKey: "claim-fence-1",
      source: "staff",
    });
    await pool.query("INSERT INTO uc_push_tokens (user_id,push_token) VALUES ($1,$2)", [
      String(userId), "ExponentPushToken[fence]",
    ]);
    await pool.query(
      `UPDATE uc_order_notification_outbox
       SET status='sending',claim_token='old-claim',locked_at=now()-interval '1 hour',
           lease_expires_at=now()-interval '1 second'
       WHERE order_id=$1`,
      [orderId],
    );
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 },
    )) as typeof fetch;
    assert.equal((await processOrderNotificationOutbox()).sent, 1);
    const row = (await outboxFor(orderId)).rows[0];
    assert.equal(row.status, "sent");
    assert.equal(row.claim_token, null);
    const staleCompletion = await pool.query(
      `UPDATE uc_order_notification_outbox SET status='failed'
       WHERE id=$1 AND status='sending' AND claim_token='old-claim'`,
      [row.id],
    );
    assert.equal(staleCompletion.rowCount, 0);
    assert.equal((await outboxFor(orderId)).rows[0]?.status, "sent");
  });

  it("renews a reclaimed lease before delivery and only the active owner calls Expo", async () => {
    const orderId = await createOrder(41011);
    await transitionOrderStatus({
      orderId,
      status: "processing",
      customerStage: "accepted",
      eventKey: "lease-renewal-1",
      source: "staff",
    });
    await pool.query("INSERT INTO uc_push_tokens (user_id,push_token) VALUES ($1,$2)", [
      String(userId), "ExponentPushToken[lease-renewal]",
    ]);
    await pool.query(
      `UPDATE uc_order_notification_outbox
       SET status='sending',claim_token='expired-owner',locked_at=now()-interval '1 second',
           lease_expires_at=now()-interval '1 millisecond'
       WHERE order_id=$1`,
      [orderId],
    );
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 30));
      return new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 });
    }) as typeof fetch;
    const [first, second] = await Promise.all([
      processOrderNotificationOutbox(),
      processOrderNotificationOutbox(),
    ]);
    assert.equal(calls, 1);
    assert.equal(first.sent + second.sent, 1);
    assert.equal((await outboxFor(orderId)).rows[0]?.status, "sent");
  });

  it("bounds a hung Expo request and leaves the work retryable", async () => {
    const orderId = await createOrder(41009);
    await transitionOrderStatus({
      orderId,
      status: "processing",
      customerStage: "accepted",
      eventKey: "timeout-1",
      source: "staff",
    });
    await pool.query("INSERT INTO uc_push_tokens (user_id,push_token) VALUES ($1,$2)", [
      String(userId), "ExponentPushToken[timeout]",
    ]);
    const previousTimeout = process.env["EXPO_PUSH_TIMEOUT_MS"];
    process.env["EXPO_PUSH_TIMEOUT_MS"] = "25";
    globalThis.fetch = (async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("timed out")));
    })) as typeof fetch;
    const started = Date.now();
    const result = await processOrderNotificationOutbox();
    const elapsed = Date.now() - started;
    if (previousTimeout === undefined) delete process.env["EXPO_PUSH_TIMEOUT_MS"];
    else process.env["EXPO_PUSH_TIMEOUT_MS"] = previousTimeout;
    assert.equal(result.failed, 1);
    assert.ok(elapsed < 2_000, `hung provider exceeded test bound (${elapsed}ms)`);
    assert.equal((await outboxFor(orderId)).rows[0]?.status, "failed");
  });

  it("has the projection, event, and fenced-outbox columns on a clean schema", async () => {
    const columns = await pool.query(
      `SELECT table_name,column_name FROM information_schema.columns
       WHERE (table_name='uc_orders' AND column_name IN ('customer_stage','woo_status_modified_at','woo_status_version'))
          OR (table_name='uc_customer_stage_events' AND column_name IN ('source_modified_at','source_version'))
          OR (table_name='uc_order_notification_outbox' AND column_name IN ('claim_token','lease_expires_at'))`,
    );
    assert.equal(columns.rows.length, 7);
    const indexes = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE indexname IN ('uc_customer_stage_events_resource_key_unique',
                           'uc_order_notification_outbox_event_key_unique',
                           'uc_order_notification_outbox_pending_idx')`,
    );
    assert.equal(indexes.rows.length, 3);
  });
});