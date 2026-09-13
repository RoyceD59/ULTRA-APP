/**
 * Cash collection is an explicit, admin-authorized operation. It must leave an
 * immutable actor/time audit row and retries with the same key must be safe.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcryptjs from "bcryptjs";
import http from "node:http";

import app from "../app.js";
import { pool } from "@workspace/db";

let server: http.Server;
let base: string;
let token: string;
let orderId: number;
let userId: number;
let actorEmail: string;
const extraOrderIds: number[] = [];

describe("COD collection confirmation", () => {
  before(async () => {
    // Test runners import app rather than the production entry point, so ensure
    // the additive deployment DDL exists before exercising the route.
    await pool.query(`
      ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS cod_collection_status text;
      ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS cod_collected_by text;
      ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS cod_collected_at timestamptz;
       ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS cod_wc_sync_status text;
       ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS cod_wc_sync_error text;
       ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS cod_wc_sync_attempted_at timestamptz;
       ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS cod_wc_sync_attempt_count integer NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS uc_cod_collection_events (
        id serial PRIMARY KEY,
        order_id integer NOT NULL REFERENCES uc_orders(id) ON DELETE CASCADE,
        idempotency_key text NOT NULL,
        actor text NOT NULL,
        collected_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uc_cod_collection_events_order_unique UNIQUE (order_id),
        CONSTRAINT uc_cod_collection_events_order_idempotency_unique UNIQUE (order_id, idempotency_key)
      );
    `);
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server address");
    base = `http://127.0.0.1:${address.port}/api`;

    const email = `cod-collector-${Date.now()}@uctest.internal`;
    actorEmail = email;
    const hash = await bcryptjs.hash("Test1234!", 4);
    const user = await pool.query(
      "INSERT INTO uc_users (email,password_hash,first_name,last_name,is_admin) VALUES ($1,$2,'Cash','Collector',true) RETURNING id",
      [email, hash],
    );
    userId = user.rows[0].id;
    const login = await fetch(`${base}/uc/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Test1234!" }),
    });
    token = (await login.json() as { token: string }).token;
    const order = await pool.query(
      `INSERT INTO uc_orders (user_id,status,total,currency,payment_method,cod_collection_status)
       VALUES ($1,'pending','1000','KES','cod','awaiting_collection') RETURNING id`,
      [String(userId)],
    );
    orderId = order.rows[0].id;
  });

  after(async () => {
    if (extraOrderIds.length) await pool.query("DELETE FROM uc_orders WHERE id = ANY($1::int[])", [extraOrderIds]);
    await pool.query("DELETE FROM uc_orders WHERE id=$1", [orderId]);
    await pool.query("DELETE FROM uc_users WHERE id=$1", [userId]);
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  });

  it("requires an authorized admin", async () => {
    const response = await fetch(`${base}/uc/admin/orders/${orderId}/cod-collection`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "unauthorized" }),
    });
    assert.equal(response.status, 403);
  });

  it("records collection actor/time once and repeats safely", async () => {
    const before = await pool.query("SELECT status, cod_collection_status FROM uc_orders WHERE id=$1", [orderId]);
    assert.equal(before.rows[0].status, "pending");
    assert.equal(before.rows[0].cod_collection_status, "awaiting_collection");
    const key = `cash-${Date.now()}`;
    const request = () => fetch(`${base}/uc/admin/orders/${orderId}/cod-collection`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: key }),
    });
    const first = await request();
    assert.equal(first.status, 200);
    const firstBody = await first.json() as Record<string, unknown>;
    assert.equal(firstBody.codCollectionStatus, "collected");
    assert.equal(firstBody.repeated, false);
    assert.equal(firstBody.codCollectedBy, actorEmail);
    assert.ok(firstBody.codCollectedAt);

    const second = await request();
    assert.equal(second.status, 200);
    const secondBody = await second.json() as Record<string, unknown>;
    assert.equal(secondBody.repeated, true);
    assert.equal(secondBody.codCollectedAt, firstBody.codCollectedAt);
    const events = await pool.query("SELECT count(*)::int AS count FROM uc_cod_collection_events WHERE order_id=$1", [orderId]);
    assert.equal(events.rows[0].count, 1);
    const order = await pool.query(
      "SELECT status, cod_collection_status, cod_collected_by, cod_collected_at FROM uc_orders WHERE id=$1",
      [orderId],
    );
    assert.deepEqual(order.rows[0].cod_collection_status, "collected");
    assert.equal(order.rows[0].status, "paid");
    assert.equal(order.rows[0].cod_collected_by, actorEmail);
    assert.ok(order.rows[0].cod_collected_at);
    const previousKey = process.env["WC_CONSUMER_KEY"];
    const previousSecret = process.env["WC_CONSUMER_SECRET"];
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];
    try {
      const customerOrders = await fetch(`${base}/uc/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(customerOrders.status, 200);
      const customerOrder = (await customerOrders.json() as Array<{ id: number; status: string }>)
        .find(candidate => candidate.id === orderId);
      assert.equal(customerOrder?.status, "paid");
    } finally {
      if (previousKey === undefined) delete process.env["WC_CONSUMER_KEY"]; else process.env["WC_CONSUMER_KEY"] = previousKey;
      if (previousSecret === undefined) delete process.env["WC_CONSUMER_SECRET"]; else process.env["WC_CONSUMER_SECRET"] = previousSecret;
    }
  });

  it("rejects collection confirmation for non-COD orders", async () => {
    const inserted = await pool.query(
      "INSERT INTO uc_orders (user_id,status,total,currency,payment_method) VALUES ($1,'processing','1000','KES','mpesa') RETURNING id",
      [String(userId)],
    );
    const id = inserted.rows[0].id as number;
    extraOrderIds.push(id);
    const response = await fetch(`${base}/uc/admin/orders/${id}/cod-collection`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: `not-cod-${Date.now()}` }),
    });
    assert.equal(response.status, 409);
    const persisted = await pool.query("SELECT status FROM uc_orders WHERE id=$1", [id]);
    assert.equal(persisted.rows[0].status, "processing");
  });

  it("keeps committed cash paid and records a Woo mirror failure", async () => {
    const inserted = await pool.query(
      `INSERT INTO uc_orders (user_id,status,total,currency,payment_method,cod_collection_status,wc_order_id)
       VALUES ($1,'pending','1000','KES','cod','awaiting_collection',987654) RETURNING id`,
      [String(userId)],
    );
    const id = inserted.rows[0].id as number;
    extraOrderIds.push(id);
    const previousFetch = globalThis.fetch;
    const previousKey = process.env["WC_CONSUMER_KEY"];
    const previousSecret = process.env["WC_CONSUMER_SECRET"];
    const previousBase = process.env["WC_BASE_URL"];
    process.env["WC_CONSUMER_KEY"] = "test-key";
    process.env["WC_CONSUMER_SECRET"] = "test-secret";
    process.env["WC_BASE_URL"] = "https://woo.test";
    globalThis.fetch = async () => new Response(JSON.stringify({ message: "down" }), { status: 503 });
    try {
      const response = await previousFetch(`${base}/uc/admin/orders/${id}/cod-collection`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `woo-failure-${Date.now()}` }),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as { status: string; wcSync?: { status: string; attemptCount: number } };
      assert.equal(body.status, "paid");
      assert.equal(body.wcSync?.status, "failed");
      assert.equal(body.wcSync?.attemptCount, 1);
      const persisted = await pool.query("SELECT status,cod_wc_sync_status,cod_wc_sync_attempt_count FROM uc_orders WHERE id=$1", [id]);
      assert.equal(persisted.rows[0].status, "paid");
      assert.equal(persisted.rows[0].cod_wc_sync_status, "failed");
      assert.equal(persisted.rows[0].cod_wc_sync_attempt_count, 1);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env["WC_CONSUMER_KEY"]; else process.env["WC_CONSUMER_KEY"] = previousKey;
      if (previousSecret === undefined) delete process.env["WC_CONSUMER_SECRET"]; else process.env["WC_CONSUMER_SECRET"] = previousSecret;
      if (previousBase === undefined) delete process.env["WC_BASE_URL"]; else process.env["WC_BASE_URL"] = previousBase;
    }
  });
});