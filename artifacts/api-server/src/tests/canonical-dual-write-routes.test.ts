import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createHmac } from "node:crypto";
import http from "node:http";
import bcryptjs from "bcryptjs";
import app from "../app.js";
import { pool } from "@workspace/db";

describe("canonical dual-write HTTP integration", { concurrency: false }, () => {
  let server: http.Server;
  let base: string;
  let realFetch: typeof globalThis.fetch;
  let userId: number;
  const orderIds: number[] = [];
  const previousFlag = process.env["UC_CANONICAL_DUAL_WRITES"];
  const secret = "canonical-dual-write-route-secret";

  async function createOrder(total = "100.00") {
    const user = await pool.query(
      `INSERT INTO uc_users (email,password_hash,first_name) VALUES ($1,'unused','Dual') RETURNING id`,
      [`dual-route-${Date.now()}-${Math.random()}@test.invalid`],
    );
    userId = Number(user.rows[0].id);
    const order = await pool.query(
      `INSERT INTO uc_orders (user_id,status,total,currency,payment_method,payment_reference,wc_order_id)
       VALUES ($1,'pending',$2,'KES','cod','',$3) RETURNING id`,
      [String(userId), total, 97000 + orderIds.length],
    );
    const id = Number(order.rows[0].id);
    orderIds.push(id);
    await pool.query(
      `INSERT INTO uc_order_items (order_id,product_id,name,quantity,total)
       VALUES ($1,1,'Hydra Flux',1,'100.00')`, [id],
    );
    return id;
  }

  async function signedWebhook(orderId: number, status = "processing") {
    const source = await pool.query("SELECT wc_order_id FROM uc_orders WHERE id=$1", [orderId]);
    const body = JSON.stringify({ id: source.rows[0].wc_order_id, status, date_modified_gmt: new Date().toISOString() });
    return fetch(`${base}/uc/webhooks/woocommerce`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wc-webhook-secret": secret,
        "x-wc-webhook-signature": createHmac("sha256", secret).update(body).digest("base64"),
        "x-wc-webhook-delivery-id": `dual-${orderId}-${status}`,
      },
      body,
    });
  }

  async function createTestUser(suffix: string) {
    const email = `dual-cod-${suffix}-${Date.now()}@test.invalid`;
    const user = await pool.query(
      "INSERT INTO uc_users (email,password_hash,first_name,last_name,phone,address) VALUES ($1,$2,'Amina','Buyer','+254712345678','12 Riverside Dr, Nairobi') RETURNING id",
      [email, await bcryptjs.hash("Test1234!", 4)],
    );
    const login = await realFetch(`${base}/uc/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "Test1234!" }),
    });
    const body = await login.json() as { token?: string };
    if (!body.token) throw new Error("test user login did not return a token");
    return { id: Number(user.rows[0].id), email, jwt: body.token };
  }

  async function deleteRewardsForUsers(ids: number[]) {
    if (ids.length) {
      await pool.query("DELETE FROM uc_rewards_ledger WHERE user_id=ANY($1::int[])", [ids]);
    }
  }

  async function postOrders(body: unknown, jwt?: string) {
    const response = await realFetch(`${base}/uc/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() as Record<string, unknown> };
  }

  function codPayload(idempotencyKey: string) {
    return {
      lineItems: [{ productId: 22, quantity: 1 }],
      paymentMethod: "cod",
      shippingAddress: {
        firstName: "Amina", lastName: "Otieno", address1: "12 Riverside Dr",
        city: "Nairobi", country: "KE", phone: "0712345678",
      },
      idempotencyKey,
    };
  }

  before(async () => {
    realFetch = globalThis.fetch;
    process.env["WC_WEBHOOK_SECRET"] = secret;
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server");
    base = `http://127.0.0.1:${address.port}/api`;
  });
  beforeEach(async () => {
    process.env["UC_CANONICAL_DUAL_WRITES"] = "false";
  });
  after(async () => {
    process.env["UC_CANONICAL_DUAL_WRITES"] = previousFlag;
    if (orderIds.length) {
      await pool.query(
        "DELETE FROM uc_reconciliation_conflicts WHERE source_reference LIKE ANY($1::text[])",
        [orderIds.map((id) => `order:${id}:%`)],
      );
      await pool.query(
        "DELETE FROM uc_canonical_purchase_lines WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[]))",
        [orderIds],
      );
      await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[])", [orderIds]);
    }
    if (orderIds.length) await pool.query("DELETE FROM uc_order_items WHERE order_id=ANY($1::int[])", [orderIds]);
    if (orderIds.length) await pool.query("DELETE FROM uc_orders WHERE id=ANY($1::int[])", [orderIds]);
    if (userId) {
      await deleteRewardsForUsers([userId]);
      await pool.query("DELETE FROM uc_users WHERE id=$1", [userId]);
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("flag off preserves status mutation and creates no canonical purchase", async () => {
    const orderId = await createOrder();
    const response = await signedWebhook(orderId);
    assert.equal(response.status, 200);
    const count = await pool.query("SELECT count(*)::int AS count FROM uc_canonical_purchases WHERE companion_order_id=$1", [orderId]);
    assert.equal(count.rows[0].count, 0);
  });

  it("flag on Woo status creates one canonical purchase and correct lines", async () => {
    process.env["UC_CANONICAL_DUAL_WRITES"] = "true";
    const orderId = await createOrder();
    const response = await signedWebhook(orderId);
    assert.equal(response.status, 200);
    const canonical = await pool.query("SELECT id,payment_status,fulfilment_status FROM uc_canonical_purchases WHERE companion_order_id=$1", [orderId]);
    const lines = await pool.query("SELECT count(*)::int AS count FROM uc_canonical_purchase_lines WHERE purchase_id=$1", [canonical.rows[0].id]);
    assert.equal(canonical.rows.length, 1);
    assert.equal(canonical.rows[0].payment_status, "paid");
    assert.equal(lines.rows[0].count, 1);
  });

  it("existing-order retry heals a missing canonical projection", async () => {
    process.env["UC_CANONICAL_DUAL_WRITES"] = "true";
    const orderId = await createOrder();
    await signedWebhook(orderId);
    await pool.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id=(SELECT id FROM uc_canonical_purchases WHERE companion_order_id=$1)", [orderId]);
    await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id=$1", [orderId]);
    const response = await signedWebhook(orderId, "completed");
    assert.equal(response.status, 200);
    const canonical = await pool.query("SELECT id FROM uc_canonical_purchases WHERE companion_order_id=$1", [orderId]);
    assert.equal(canonical.rows.length, 1);
  });

  it("status transaction rollback leaves no event or outbox on canonical failure", async () => {
    process.env["UC_CANONICAL_DUAL_WRITES"] = "true";
    const orderId = await createOrder("100.00");
    await pool.query(
      `INSERT INTO uc_canonical_purchases (customer_id,companion_order_id,currency,total,total_minor,payment_status,fulfilment_status)
       VALUES ($1,$2,'KES','999.99',99999,'pending','pending')`, [userId, orderId],
    );
    const response = await signedWebhook(orderId);
    assert.notEqual(response.status, 200);
    const events = await pool.query("SELECT count(*)::int AS count FROM uc_customer_stage_events WHERE resource_id=$1", [String(orderId)]);
    const outbox = await pool.query("SELECT count(*)::int AS count FROM uc_order_notification_outbox WHERE order_id=$1", [orderId]);
    assert.equal(events.rows[0].count, 0);
    assert.equal(outbox.rows[0].count, 0);
  });

  it("Woo COD missing checkout key rejects before any remote call", async () => {
    const oldKey = process.env["WC_CONSUMER_KEY"];
    const oldSecret = process.env["WC_CONSUMER_SECRET"];
    const oldFetch = globalThis.fetch;
    let remoteCalls = 0;
    const shippingSentinel = `missing-key-${Date.now()}-${Math.random()}`;
    process.env["UC_CANONICAL_DUAL_WRITES"] = "true";
    process.env["WC_CONSUMER_KEY"] = "test-key";
    process.env["WC_CONSUMER_SECRET"] = "test-secret";
    globalThis.fetch = (async () => {
      remoteCalls++;
      return new Response(JSON.stringify({ id: 99999 }), { status: 201 });
    }) as typeof fetch;
    try {
      const response = await oldFetch(`${base}/uc/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lineItems: [{ productId: 22, quantity: 1 }],
          paymentMethod: "cod",
          shippingAddress: {
            firstName: "Amina", lastName: "Otieno", address1: shippingSentinel,
            city: "Nairobi", country: "KE", phone: "0712345678",
          },
        }),
      });
      assert.equal(response.status, 400);
      assert.equal(remoteCalls, 0);
      const rows = await pool.query(
        "SELECT count(*)::int AS count FROM uc_orders WHERE shipping_address->>'address1'=$1",
        [shippingSentinel],
      );
      assert.equal(rows.rows[0].count, 0);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env["WC_CONSUMER_KEY"]; else process.env["WC_CONSUMER_KEY"] = oldKey;
      if (oldSecret === undefined) delete process.env["WC_CONSUMER_SECRET"]; else process.env["WC_CONSUMER_SECRET"] = oldSecret;
    }
  });

  it("Woo COD keyed checkout confirms one durable order and canonical projection across retries", async () => {
    const previousFlag = process.env["UC_CANONICAL_DUAL_WRITES"];
    const oldKey = process.env["WC_CONSUMER_KEY"];
    const oldSecret = process.env["WC_CONSUMER_SECRET"];
    const oldBase = process.env["WC_BASE_URL"];
    const oldResendBase = process.env["RESEND_BASE_URL"];
    const oldResendKey = process.env["RESEND_API_KEY"];
    const oldFetch = globalThis.fetch;
    const user = await createTestUser(`e2e-${Date.now()}`);
    const checkoutKey = `cod-dual-${Date.now()}-${Math.random()}`;
    const wcOrderId = 120000 + orderIds.length;
    let wcPostCalls = 0;
    const notificationBodies: Record<string, unknown>[] = [];

    process.env["UC_CANONICAL_DUAL_WRITES"] = "true";
    process.env["WC_CONSUMER_KEY"] = "test-cod-key";
    process.env["WC_CONSUMER_SECRET"] = "test-cod-secret";
    process.env["WC_BASE_URL"] = "https://canonical-cod.test";
    process.env["RESEND_BASE_URL"] = "https://api.resend.com";
    process.env["RESEND_API_KEY"] = "test-resend-key";

    const remoteOrder = {
      id: wcOrderId,
      status: "processing",
      date_created: new Date().toISOString(),
      total: "2850",
      currency: "KES",
      payment_method: "cod",
      shipping: {},
      line_items: [{ product_id: 22, name: "Bottle Filter Cartridge", quantity: 1, total: "2350" }],
      meta_data: [{ key: "payment_reference", value: checkoutKey }, { key: "uc_checkout_key", value: checkoutKey }],
    };
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("canonical-cod.test") && target.includes("/products")) return new Response(JSON.stringify([{id:22,name:"Bottle Filter Cartridge",price:"2350",stock_status:"instock",status:"publish"}]));
      if (target.includes("canonical-cod.test") && target.includes("/orders") && init?.method === "POST") {
        wcPostCalls++;
        return new Response(JSON.stringify(remoteOrder), { status: 201 });
      }
      if (target.includes("canonical-cod.test") && target.includes("/orders")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (target.includes("resend.com") && target.includes("/emails")) {
        notificationBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: "cod-notification" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    try {
      // Authentication and validation must fail closed before any remote call.
      const unauthenticated = await postOrders({
        ...codPayload(checkoutKey),
        shippingAddress: { ...codPayload(checkoutKey).shippingAddress, phone: "0712" },
      });
      assert.equal(unauthenticated.response.status, 400);
      assert.equal(wcPostCalls, 0);

      const first = await postOrders(codPayload(checkoutKey), user.jwt);
      assert.equal(first.response.status, 200, JSON.stringify(first.body));
      assert.equal(wcPostCalls, 1, "the first confirmed checkout makes one Woo order call");

      const primary = await pool.query(
        "SELECT id,wc_order_id,status FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2",
        [user.id, checkoutKey],
      );
      assert.equal(primary.rows.length, 1);
      assert.equal(Number(primary.rows[0].wc_order_id), wcOrderId);
      assert.equal(primary.rows[0].status, "processing");
      const items = await pool.query(
        "SELECT product_id,quantity FROM uc_order_items WHERE order_id=$1",
        [primary.rows[0].id],
      );
      assert.equal(items.rows.length, 1);
      assert.equal(items.rows[0].product_id, 22);
      assert.equal(items.rows[0].quantity, 1);

      const canonical = await pool.query(
        "SELECT id,companion_order_id FROM uc_canonical_purchases WHERE companion_order_id=$1",
        [primary.rows[0].id],
      );
      assert.equal(canonical.rows.length, 1);
      const lines = await pool.query(
        "SELECT count(*)::int AS count FROM uc_canonical_purchase_lines WHERE purchase_id=$1",
        [canonical.rows[0].id],
      );
      assert.equal(lines.rows[0].count, 1);
      assert.equal(Number(canonical.rows[0].companion_order_id), Number(primary.rows[0].id));

      const repeat = await postOrders(codPayload(checkoutKey), user.jwt);
      assert.equal(repeat.response.status, 200, JSON.stringify(repeat.body));
      assert.ok(
        Number(repeat.body.id) === wcOrderId || Number(repeat.body.id) === Number(primary.rows[0].id),
        "repeat must identify the same confirmed Woo/primary order",
      );
      assert.equal(wcPostCalls, 1, "same checkout key must not create a second Woo order");
      const primaryAgain = await pool.query(
        "SELECT count(*)::int AS count FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2",
        [user.id, checkoutKey],
      );
      assert.equal(primaryAgain.rows[0].count, 1);
      const canonicalAgain = await pool.query(
        "SELECT count(*)::int AS count FROM uc_canonical_purchases WHERE companion_order_id=$1",
        [primary.rows[0].id],
      );
      assert.equal(canonicalAgain.rows[0].count, 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(notificationBodies.length, 1, "repeat must not publish a second notification");
    } finally {
      globalThis.fetch = oldFetch;
      if (previousFlag === undefined) delete process.env["UC_CANONICAL_DUAL_WRITES"];
      else process.env["UC_CANONICAL_DUAL_WRITES"] = previousFlag;
      if (oldKey === undefined) delete process.env["WC_CONSUMER_KEY"]; else process.env["WC_CONSUMER_KEY"] = oldKey;
      if (oldSecret === undefined) delete process.env["WC_CONSUMER_SECRET"]; else process.env["WC_CONSUMER_SECRET"] = oldSecret;
      if (oldBase === undefined) delete process.env["WC_BASE_URL"]; else process.env["WC_BASE_URL"] = oldBase;
      if (oldResendBase === undefined) delete process.env["RESEND_BASE_URL"]; else process.env["RESEND_BASE_URL"] = oldResendBase;
      if (oldResendKey === undefined) delete process.env["RESEND_API_KEY"]; else process.env["RESEND_API_KEY"] = oldResendKey;
      const owned = await pool.query<{ id: number }>(
        "SELECT id FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2",
        [user.id, checkoutKey],
      );
      if (owned.rows.length) {
        const ids = owned.rows.map((row) => row.id);
        await pool.query(
          "DELETE FROM uc_reconciliation_conflicts WHERE canonical_purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[])) OR source_reference LIKE ANY($2::text[])",
          [ids, ids.map((id) => `order:${id}:%`)],
        );
        await pool.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[]))", [ids]);
        await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[])", [ids]);
        await pool.query("DELETE FROM uc_order_items WHERE order_id=ANY($1::int[])", [ids]);
        await pool.query("DELETE FROM uc_orders WHERE id=ANY($1::int[])", [ids]);
      }
      await deleteRewardsForUsers([user.id]);
      await pool.query("DELETE FROM uc_users WHERE id=$1", [user.id]);
    }
  });

  it("rejects cross-customer replay of a confirmed Woo COD checkout key without disclosure or remote side effects", async () => {
    const previousFlag = process.env["UC_CANONICAL_DUAL_WRITES"];
    const oldKey = process.env["WC_CONSUMER_KEY"];
    const oldSecret = process.env["WC_CONSUMER_SECRET"];
    const oldBase = process.env["WC_BASE_URL"];
    const oldResendBase = process.env["RESEND_BASE_URL"];
    const oldResendKey = process.env["RESEND_API_KEY"];
    const oldFetch = globalThis.fetch;
    const userA = await createTestUser(`replay-a-${Date.now()}`);
    const userB = await createTestUser(`replay-b-${Date.now()}`);
    const checkoutKey = `cod-cross-customer-${Date.now()}-${Math.random()}`;
    const wcOrderId = 130000 + orderIds.length;
    let wcPostCalls = 0;
    const notificationBodies: Record<string, unknown>[] = [];

    process.env["UC_CANONICAL_DUAL_WRITES"] = "true";
    process.env["WC_CONSUMER_KEY"] = "test-cross-customer-key";
    process.env["WC_CONSUMER_SECRET"] = "test-cross-customer-secret";
    process.env["WC_BASE_URL"] = "https://canonical-cross-customer.test";
    process.env["RESEND_BASE_URL"] = "https://api.resend.com";
    process.env["RESEND_API_KEY"] = "test-resend-key";

    const remoteOrder = {
      id: wcOrderId,
      status: "processing",
      date_created: new Date().toISOString(),
      total: "2850",
      currency: "KES",
      payment_method: "cod",
      shipping: { address_1: "A-PRIVATE-SENTINEL" },
      line_items: [{ product_id: 22, name: "Bottle Filter Cartridge", quantity: 1, total: "2350" }],
      meta_data: [{ key: "payment_reference", value: checkoutKey }, { key: "uc_checkout_key", value: checkoutKey }],
    };
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("canonical-cross-customer.test") && target.includes("/products")) return new Response(JSON.stringify([{id:22,name:"Bottle Filter Cartridge",price:"2350",stock_status:"instock",status:"publish"}]));
      if (target.includes("canonical-cross-customer.test") && target.includes("/orders") && init?.method === "POST") {
        wcPostCalls++;
        return new Response(JSON.stringify(remoteOrder), { status: 201 });
      }
      if (target.includes("canonical-cross-customer.test") && target.includes("/orders")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (target.includes("resend.com") && target.includes("/emails")) {
        notificationBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: "cross-customer-notification" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const payload = {
      ...codPayload(checkoutKey),
      shippingAddress: {
        firstName: "Amina", lastName: "Owner", address1: "A-PRIVATE-SENTINEL",
        city: "Nairobi", country: "KE", phone: "0712345678",
      },
    };

    try {
      const first = await postOrders(payload, userA.jwt);
      assert.equal(first.response.status, 200, JSON.stringify(first.body));
      const aOrder = await pool.query(
        "SELECT id,total,status,user_id,wc_order_id FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2",
        [userA.id, checkoutKey],
      );
      assert.equal(aOrder.rows.length, 1);
      const aId = Number(aOrder.rows[0].id);
      const aCanonical = await pool.query(
        "SELECT id,companion_order_id FROM uc_canonical_purchases WHERE companion_order_id=$1",
        [aId],
      );
      assert.equal(aCanonical.rows.length, 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const postCountAfterA = wcPostCalls;
      const notificationCountAfterA = notificationBodies.length;

      const replay = await postOrders(payload, userB.jwt);
      assert.equal(replay.response.status, 409, JSON.stringify(replay.body));
      const replayText = JSON.stringify(replay.body);
      for (const secret of [
        String(aId),
        String(aOrder.rows[0].total),
        "A-PRIVATE-SENTINEL",
        "Bottle Filter Cartridge",
      ]) {
        assert.ok(!replayText.includes(secret), `cross-customer response must not disclose ${secret}`);
      }
      assert.equal(wcPostCalls, postCountAfterA, "cross-customer replay must not POST to Woo");
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(notificationBodies.length, notificationCountAfterA, "cross-customer replay must not notify");

      const aUnchanged = await pool.query(
        "SELECT id,total,status,user_id,wc_order_id FROM uc_orders WHERE id=$1",
        [aId],
      );
      assert.deepEqual(aUnchanged.rows[0], aOrder.rows[0], "A's primary order must remain unchanged");
      const aCanonicalAgain = await pool.query(
        "SELECT count(*)::int AS count FROM uc_canonical_purchases WHERE companion_order_id=$1",
        [aId],
      );
      assert.equal(aCanonicalAgain.rows[0].count, 1);
      const bOrder = await pool.query(
        "SELECT count(*)::int AS count FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2",
        [userB.id, checkoutKey],
      );
      assert.equal(bOrder.rows[0].count, 0);
      const bCanonical = await pool.query(
        "SELECT count(*)::int AS count FROM uc_canonical_purchases WHERE customer_id=$1",
        [userB.id],
      );
      assert.equal(bCanonical.rows[0].count, 0);

      const retry = await postOrders(payload, userA.jwt);
      assert.equal(retry.response.status, 200, JSON.stringify(retry.body));
      assert.ok(
        Number(retry.body.id) === wcOrderId || Number(retry.body.id) === aId,
        "A retry must identify A's confirmed order",
      );
      assert.equal(wcPostCalls, postCountAfterA, "A retry must not create a second Woo order");
    } finally {
      globalThis.fetch = oldFetch;
      if (previousFlag === undefined) delete process.env["UC_CANONICAL_DUAL_WRITES"];
      else process.env["UC_CANONICAL_DUAL_WRITES"] = previousFlag;
      if (oldKey === undefined) delete process.env["WC_CONSUMER_KEY"]; else process.env["WC_CONSUMER_KEY"] = oldKey;
      if (oldSecret === undefined) delete process.env["WC_CONSUMER_SECRET"]; else process.env["WC_CONSUMER_SECRET"] = oldSecret;
      if (oldBase === undefined) delete process.env["WC_BASE_URL"]; else process.env["WC_BASE_URL"] = oldBase;
      if (oldResendBase === undefined) delete process.env["RESEND_BASE_URL"]; else process.env["RESEND_BASE_URL"] = oldResendBase;
      if (oldResendKey === undefined) delete process.env["RESEND_API_KEY"]; else process.env["RESEND_API_KEY"] = oldResendKey;
      const owned = await pool.query<{ id: number }>(
        "SELECT id FROM uc_orders WHERE checkout_idempotency_key=$1 AND user_id=ANY($2::text[])",
        [checkoutKey, [String(userA.id), String(userB.id)]],
      );
      if (owned.rows.length) {
        const ids = owned.rows.map((row) => row.id);
        await pool.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[]))", [ids]);
        await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[])", [ids]);
        await pool.query("DELETE FROM uc_order_items WHERE order_id=ANY($1::int[])", [ids]);
        await pool.query("DELETE FROM uc_orders WHERE id=ANY($1::int[])", [ids]);
      }
      await deleteRewardsForUsers([userA.id, userB.id]);
      await pool.query("DELETE FROM uc_users WHERE id=ANY($1::int[])", [[userA.id, userB.id]]);
    }
  });

  it("concurrent same-owner keyed COD requests create one Woo order and one canonical projection", async () => {
    const previousFlag = process.env["UC_CANONICAL_DUAL_WRITES"];
    const oldKey = process.env["WC_CONSUMER_KEY"];
    const oldSecret = process.env["WC_CONSUMER_SECRET"];
    const oldBase = process.env["WC_BASE_URL"];
    const oldFetch = globalThis.fetch;
    const user = await createTestUser(`concurrent-${Date.now()}`);
    const checkoutKey = `cod-concurrent-${Date.now()}-${Math.random()}`;
    const wcOrderId = 140000 + orderIds.length;
    let wcPostCalls = 0;
    let notificationCount = 0;
    process.env["UC_CANONICAL_DUAL_WRITES"] = "true";
    process.env["WC_CONSUMER_KEY"] = "test-concurrent-key";
    process.env["WC_CONSUMER_SECRET"] = "test-concurrent-secret";
    process.env["WC_BASE_URL"] = "https://canonical-concurrent.test";
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("canonical-concurrent.test") && target.includes("/products")) return new Response(JSON.stringify([{id:22,name:"Bottle Filter Cartridge",price:"2350",stock_status:"instock",status:"publish"}]));
      if (target.includes("canonical-concurrent.test") && target.includes("/orders") && init?.method === "POST") {
        wcPostCalls++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return new Response(JSON.stringify({
          id: wcOrderId, status: "processing", date_created: new Date().toISOString(),
          total: "2850", currency: "KES", payment_method: "cod", shipping: {},
          line_items: [{ product_id: 22, name: "Bottle Filter Cartridge", quantity: 1, total: "2350" }],
          meta_data: [{ key: "uc_checkout_key", value: checkoutKey }],
        }), { status: 201 });
      }
      if (target.includes("canonical-concurrent.test") && target.includes("/orders")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (target.includes("resend.com") && target.includes("/emails")) {
        notificationCount++;
        return new Response(JSON.stringify({ id: "concurrent-notification" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };
    try {
      const payload = codPayload(checkoutKey);
      const [creator, follower] = await Promise.all([
        postOrders(payload, user.jwt),
        postOrders(payload, user.jwt),
      ]);
      assert.equal(wcPostCalls, 1);
      // Either request can win the server-side lock, regardless of Promise order.
      assert.ok([creator, follower].some((result) => result.response.status === 200));
      assert.ok([creator, follower].every((result) => result.response.status === 200 || result.response.status === 503));
      for (const result of [creator, follower].filter((entry) => entry.response.status === 503)) {
        const text = JSON.stringify(result.body);
        assert.ok(!text.includes(String(wcOrderId)));
      }
      const primary = await pool.query(
        "SELECT id FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2",
        [user.id, checkoutKey],
      );
      assert.equal(primary.rows.length, 1);
      const canonical = await pool.query(
        "SELECT id FROM uc_canonical_purchases WHERE companion_order_id=$1",
        [primary.rows[0].id],
      );
      assert.equal(canonical.rows.length, 1);
      const lines = await pool.query(
        "SELECT count(*)::int AS count FROM uc_canonical_purchase_lines WHERE purchase_id=$1",
        [canonical.rows[0].id],
      );
      assert.equal(lines.rows[0].count, 1);
    } finally {
      globalThis.fetch = oldFetch;
      if (previousFlag === undefined) delete process.env["UC_CANONICAL_DUAL_WRITES"];
      else process.env["UC_CANONICAL_DUAL_WRITES"] = previousFlag;
      if (oldKey === undefined) delete process.env["WC_CONSUMER_KEY"]; else process.env["WC_CONSUMER_KEY"] = oldKey;
      if (oldSecret === undefined) delete process.env["WC_CONSUMER_SECRET"]; else process.env["WC_CONSUMER_SECRET"] = oldSecret;
      if (oldBase === undefined) delete process.env["WC_BASE_URL"]; else process.env["WC_BASE_URL"] = oldBase;
      const owned = await pool.query<{ id: number }>(
        "SELECT id FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2",
        [user.id, checkoutKey],
      );
      if (owned.rows.length) {
        const ids = owned.rows.map((row) => row.id);
        await pool.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[]))", [ids]);
        await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[])", [ids]);
        await pool.query("DELETE FROM uc_order_items WHERE order_id=ANY($1::int[])", [ids]);
        await pool.query("DELETE FROM uc_orders WHERE id=ANY($1::int[])", [ids]);
      }
      await deleteRewardsForUsers([user.id]);
      await pool.query("DELETE FROM uc_users WHERE id=$1", [user.id]);
    }
  });

  it("does not POST or notify when a young same-owner pending-Woo anchor is retried", async () => {
    const previousFlag = process.env["UC_CANONICAL_DUAL_WRITES"];
    const oldKey = process.env["WC_CONSUMER_KEY"];
    const oldSecret = process.env["WC_CONSUMER_SECRET"];
    const oldBase = process.env["WC_BASE_URL"];
    const oldFetch = globalThis.fetch;
    const user = await createTestUser(`pending-anchor-${Date.now()}`);
    const checkoutKey = `cod-pending-anchor-${Date.now()}-${Math.random()}`;
    let wcPostCalls = 0;
    let notificationCount = 0;
    process.env["UC_CANONICAL_DUAL_WRITES"] = "true";
    process.env["WC_CONSUMER_KEY"] = "test-pending-key";
    process.env["WC_CONSUMER_SECRET"] = "test-pending-secret";
    process.env["WC_BASE_URL"] = "https://canonical-pending.test";
    const anchor = await pool.query(
      `INSERT INTO uc_orders
       (user_id,status,total,currency,payment_method,payment_reference,shipping_address,checkout_idempotency_key,checkout_state,cod_collection_status)
       VALUES ($1,'pending-wc','2850','KES','cod','','{}'::jsonb,$2,'remote_pending','awaiting_collection') RETURNING id`,
      [String(user.id), checkoutKey],
    );
    const anchorId = Number(anchor.rows[0].id);
    await pool.query(
      "INSERT INTO uc_order_items (order_id,product_id,name,quantity,total) VALUES ($1,22,'Bottle Filter Cartridge',1,'2350')",
      [anchorId],
    );
    const before = await pool.query(
      "SELECT status,total,shipping_address,checkout_state FROM uc_orders WHERE id=$1",
      [anchorId],
    );
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("canonical-pending.test") && target.includes("/orders") && init?.method === "POST") wcPostCalls++;
      if (target.includes("resend.com") && target.includes("/emails")) notificationCount++;
      return new Response(JSON.stringify([]), { status: 200 });
    };
    try {
      const response = await postOrders(codPayload(checkoutKey), user.jwt);
      assert.equal(response.response.status, 503);
      assert.equal(response.body["retryable"], true);
      assert.equal(wcPostCalls, 0);
      assert.equal(notificationCount, 0);
      const after = await pool.query(
        "SELECT status,total,shipping_address,checkout_state FROM uc_orders WHERE id=$1",
        [anchorId],
      );
      assert.deepEqual(after.rows[0], before.rows[0]);
      const items = await pool.query("SELECT count(*)::int AS count FROM uc_order_items WHERE order_id=$1", [anchorId]);
      assert.equal(items.rows[0].count, 1);
      const canonical = await pool.query("SELECT count(*)::int AS count FROM uc_canonical_purchases WHERE companion_order_id=$1", [anchorId]);
      assert.equal(canonical.rows[0].count, 0);
    } finally {
      globalThis.fetch = oldFetch;
      if (previousFlag === undefined) delete process.env["UC_CANONICAL_DUAL_WRITES"];
      else process.env["UC_CANONICAL_DUAL_WRITES"] = previousFlag;
      if (oldKey === undefined) delete process.env["WC_CONSUMER_KEY"]; else process.env["WC_CONSUMER_KEY"] = oldKey;
      if (oldSecret === undefined) delete process.env["WC_CONSUMER_SECRET"]; else process.env["WC_CONSUMER_SECRET"] = oldSecret;
      if (oldBase === undefined) delete process.env["WC_BASE_URL"]; else process.env["WC_BASE_URL"] = oldBase;
      await pool.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE companion_order_id=$1)", [anchorId]);
      await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id=$1", [anchorId]);
      await pool.query("DELETE FROM uc_order_items WHERE order_id=$1", [anchorId]);
      await pool.query("DELETE FROM uc_orders WHERE id=$1", [anchorId]);
      await deleteRewardsForUsers([user.id]);
      await pool.query("DELETE FROM uc_users WHERE id=$1", [user.id]);
    }
  });
});