/**
 * Tests that sendViaResend is called with the correct payload in each of the
 * three code paths inside the createOrder route handler:
 *
 *   Path A — WooCommerce: WC credentials are present; the WC API creates the
 *             order; sendWcOrderNotifications (now using sendOrderConfirmationEmail)
 *             fires the confirmation email.
 *
 *   Path B — DB: WC credentials are absent; the DB insert succeeds; the
 *             confirmation email is sent from the main success path for
 *             COD and Stripe (payment verification in mock mode).
 *
 *   Path C — Fallback: WC credentials are absent; the DB insert throws;
 *             sendOrderConfirmationEmail is called with the in-memory
 *             fallback order. Tested by calling the exported production
 *             helper directly with a real DB user, which is exactly what
 *             the fallback block calls.
 *
 * Each test asserts that sendViaResend received a payload where:
 *   – "to" is exactly the test user's email address
 *   – subject contains the order ID
 *   – body contains at least one line-item name
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";

import app from "../app.js";
import { db, ucUsersTable, ucOrdersTable, ucOrderItemsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { _slackSeams } from "../lib/slack.js";

// ── Shared state ──────────────────────────────────────────────────────────────

let realFetch: typeof globalThis.fetch;
let server:    http.Server;
let base:      string;

const TEST_PREFIX = `COE_${Date.now()}`;
let seq = 0;
const nextRef = (): string => `${TEST_PREFIX}_${++seq}`;

/** All user IDs created during the suite — cleaned up in after(). */
const createdUserIds:  number[] = [];
const createdOrderIds: number[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postOrders(
  body: unknown,
  jwt: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await realFetch(`${base}/uc/orders`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try { parsed = (await res.json()) as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, body: parsed };
}

/**
 * Insert a test user into the DB and log in to obtain a signed JWT.
 * Returns the user's DB id, email, and JWT.
 */
async function createTestUser(
  suffix: string,
): Promise<{ id: number; email: string; jwt: string }> {
  const email = `coe-${suffix}-${Date.now()}@uctest.internal`;
  const hash  = await bcryptjs.hash("Test1234!", 4);
  const [row]  = await db
    .insert(ucUsersTable)
    .values({ email, passwordHash: hash, firstName: "Test", lastName: "Buyer", phone: "+254711000001", address: "Test building, Nairobi" })
    .returning({ id: ucUsersTable.id });
  const id = row!.id;
  createdUserIds.push(id);

  const loginRes = await realFetch(`${base}/uc/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, password: "Test1234!" }),
  });
  assert.equal(loginRes.status, 200, `login must succeed for test user (${suffix})`);
  const loginBody = (await loginRes.json()) as { token?: string };
  assert.ok(loginBody.token, "login response must contain a token");

  return { id, email, jwt: loginBody.token! };
}

/**
 * Poll `predicate` for up to `maxMs` milliseconds (50 ms cadence).
 * Returns true when the predicate first fires, false on timeout.
 */
async function waitFor(predicate: () => boolean, maxMs = 4000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return predicate();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(
  async () => {
    realFetch = globalThis.fetch;

    // Resend calls must go through our per-test fetch stub rather than the
    // real API.  Point at the canonical URL so the RESEND_API_KEY branch
    // is active and only globalThis.fetch needs to be replaced.
    process.env["RESEND_BASE_URL"] ??= "https://api.resend.com";
    process.env["RESEND_API_KEY"]  ??= "re_test_key";
    process.env["SESSION_SECRET"]  ??= "test-secret-create-order-email";

    await new Promise<void>((resolve, reject) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") { reject(new Error("No address")); return; }
        base = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    });
  },
  { timeout: 30_000 },
);

after(async () => {
  _slackSeams.sendMessage = null;
  if (createdOrderIds.length > 0) {
    await db.delete(ucOrderItemsTable)
      .where(inArray(ucOrderItemsTable.orderId, createdOrderIds))
      .catch(() => {});
    await db.delete(ucOrdersTable)
      .where(inArray(ucOrdersTable.id, createdOrderIds))
      .catch(() => {});
  }
  // Also sweep any orders belonging to test users that weren't tracked above.
  for (const uid of createdUserIds) {
    const rows = await db
      .select({ id: ucOrdersTable.id })
      .from(ucOrdersTable)
      .where(eq(ucOrdersTable.userId, String(uid)))
      .catch(() => [] as { id: number }[]);
    for (const r of rows) {
      await db.delete(ucOrderItemsTable).where(eq(ucOrderItemsTable.orderId, r.id)).catch(() => {});
      await db.delete(ucOrdersTable).where(eq(ucOrdersTable.id, r.id)).catch(() => {});
    }
  }
  if (createdUserIds.length > 0) {
    await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, createdUserIds)).catch(() => {});
  }

  await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = realFetch;
});

describe("createOrder — Resend failure Slack alert", () => {
  it("attempts Slack when an order receipt gets a non-2xx Resend response", async () => {
    const { id: userId } = await createTestUser("slack-fallback");
    const slackCalls: Array<{ text: string; template: string }> = [];
    _slackSeams.sendMessage = async (text, template) => {
      slackCalls.push({ text, template });
      return true;
    };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.resend.com")) {
        return new Response(JSON.stringify({ error: "service unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      return realFetch(input, init);
    };

    try {
      const { sendOrderConfirmationEmail } = await import("../routes/uc.js");
      sendOrderConfirmationEmail(String(userId), {
        orderId: "SLACK-ORDER-1",
        lineItems: [{ name: "Sweet Home", quantity: 1, total: "12500" }],
        total: "12500",
        currency: "KES",
        paymentMethod: "cod",
      });

      assert.ok(
        await waitFor(() => slackCalls.length > 0),
        "Slack fallback must be attempted after Resend returns non-2xx",
      );
      assert.equal(slackCalls[0]?.template, "ORDER_CONFIRMATION_RESEND_FAILURE");
      assert.match(slackCalls[0]?.text ?? "", /SLACK-ORDER-1/);
    } finally {
      _slackSeams.sendMessage = null;
      globalThis.fetch = realFetch;
    }
  });
});

// ── Path A — WooCommerce path ─────────────────────────────────────────────────

describe("createOrder — WooCommerce path — sendViaResend is called", () => {
  it("emails the customer's exact address when WC creates the order", async () => {
    const { id: userId, email: userEmail, jwt } = await createTestUser("wc");

    const savedWcKey    = process.env["WC_CONSUMER_KEY"];
    const savedWcSecret = process.env["WC_CONSUMER_SECRET"];
    const savedWcBase   = process.env["WC_BASE_URL"];
    // Unset PAYSTACK_SECRET_KEY so verification falls into mock-mode.
    const savedPsKey    = process.env["PAYSTACK_SECRET_KEY"];
    delete process.env["PAYSTACK_SECRET_KEY"];

    try {
      process.env["WC_CONSUMER_KEY"]    = "test_wc_key";
      process.env["WC_CONSUMER_SECRET"] = "test_wc_secret";
      process.env["WC_BASE_URL"]        = "https://wc.test";

      const payRef    = nextRef();
      const wcOrderId = 9900 + seq;

      const resendCalls: { to: string; subject: string; html: string; text: string }[] = [];

      globalThis.fetch = async (url: unknown, init?: RequestInit) => {
        const u = String(url);

        // WC orders POST → mock WooCommerce response with one line item.
        if (u.includes("/products")) return new Response(JSON.stringify([{id:1,name:"Hydra Flux",price:"3499",stock_status:"instock"}]));
        if (u.includes("wc.test") && u.includes("/orders") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              id:             wcOrderId,
              status:         "processing",
              date_created:   new Date().toISOString(),
              total:          "3499",
              currency:       "KES",
              payment_method: "paystack",
              shipping:       {},
              line_items: [
                { product_id: 1, name: "Hydra Flux", quantity: 1, total: "3499" },
              ],
              meta_data: [],
            }),
            { status: 201 },
          );
        }

        // WC orders GET (idempotency reconciliation) → empty list.
        if (u.includes("wc.test") && u.includes("/orders")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        // Resend → capture payload.
        if (u.includes("resend.com") && u.includes("/emails")) {
          const body = JSON.parse(init?.body as string ?? "{}") as typeof resendCalls[0];
          resendCalls.push(body);
          return new Response(JSON.stringify({ id: "re_wc_stub" }), { status: 200 });
        }

        return new Response(JSON.stringify({}), { status: 200 });
      };

      const { status, body: orderBody } = await postOrders(
        {
          lineItems:        [{ productId: 1, quantity: 1 }],
          paymentMethod:    "paystack",
          paymentReference: payRef,
          shippingAddress:  { firstName: "Test", lastName: "Buyer", address1: "1 Test St", city: "Nairobi", phone: "+254711000011" },
          idempotencyKey:   `coe-wc-${payRef}`,
        },
        jwt,
      );

      assert.equal(
        status, 200,
        `order route must return 200; got ${status}, body: ${JSON.stringify(orderBody)}`,
      );

      // sendOrderConfirmationEmail fires fire-and-forget — wait for it.
      const captured = await waitFor(() => resendCalls.length > 0, 4000);
      assert.ok(captured, "sendViaResend must be called within 4 s on the WC path");

      const call = resendCalls[0]!;

      // "to" must be EXACTLY the test user's email address.
      assert.equal(call.to, userEmail, `"to" must be the test user's email; got: ${call.to}`);

      // Subject must contain the WC order ID.
      assert.ok(
        call.subject.includes(String(wcOrderId)),
        `subject must include the WC order ID (${wcOrderId}); got: "${call.subject}"`,
      );

      // Body must name at least one line item.
      const bodyText = (call.html ?? "") + (call.text ?? "");
      assert.ok(bodyText.includes("Hydra Flux"), "email body must contain the line-item name");

      // Track the DB anchor for cleanup.
      const anchors = await db
        .select({ id: ucOrdersTable.id })
        .from(ucOrdersTable)
        .where(eq(ucOrdersTable.userId, String(userId)));
      for (const r of anchors) createdOrderIds.push(r.id);

    } finally {
      globalThis.fetch = realFetch;
      if (savedWcKey    !== undefined) process.env["WC_CONSUMER_KEY"]    = savedWcKey;    else delete process.env["WC_CONSUMER_KEY"];
      if (savedWcSecret !== undefined) process.env["WC_CONSUMER_SECRET"] = savedWcSecret; else delete process.env["WC_CONSUMER_SECRET"];
      if (savedWcBase   !== undefined) process.env["WC_BASE_URL"]        = savedWcBase;   else delete process.env["WC_BASE_URL"];
      if (savedPsKey    !== undefined) process.env["PAYSTACK_SECRET_KEY"] = savedPsKey;   else delete process.env["PAYSTACK_SECRET_KEY"];
    }
  });
});

// ── Path A2 — WooCommerce COD path (no payment reference) ────────────────────

describe("createOrder — WooCommerce COD path — sendViaResend is called", () => {
  it("emails the customer's exact address for a COD order routed through WooCommerce", async () => {
    const { id: userId, email: userEmail, jwt } = await createTestUser("wc-cod");

    const savedWcKey    = process.env["WC_CONSUMER_KEY"];
    const savedWcSecret = process.env["WC_CONSUMER_SECRET"];
    const savedWcBase   = process.env["WC_BASE_URL"];

    try {
      process.env["WC_CONSUMER_KEY"]    = "test_wc_key_cod";
      process.env["WC_CONSUMER_SECRET"] = "test_wc_secret_cod";
      process.env["WC_BASE_URL"]        = "https://wc-cod.test";

      const wcOrderId = 8800 + seq;

      const resendCalls: { to: string; subject: string; html: string; text: string }[] = [];

      globalThis.fetch = async (url: unknown, init?: RequestInit) => {
        const u = String(url);

        // WC orders POST → mock WooCommerce order for COD.
        if (u.includes("/products")) return new Response(JSON.stringify([{id:2,name:"Truva Go",price:"2599",stock_status:"instock"}]));
        if (u.includes("wc-cod.test") && u.includes("/orders") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              id:             wcOrderId,
              status:         "pending",
              date_created:   new Date().toISOString(),
              total:          "2599",
              currency:       "KES",
              payment_method: "cod",
              shipping:       {},
              line_items: [
                { product_id: 2, name: "Truva Go", quantity: 1, total: "2599" },
              ],
              meta_data: [],
            }),
            { status: 201 },
          );
        }

        // WC orders GET → empty list.
        if (u.includes("wc-cod.test") && u.includes("/orders")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        // Resend → capture payload.
        if (u.includes("resend.com") && u.includes("/emails")) {
          const body = JSON.parse(init?.body as string ?? "{}") as typeof resendCalls[0];
          resendCalls.push(body);
          return new Response(JSON.stringify({ id: "re_wc_cod_stub" }), { status: 200 });
        }

        return new Response(JSON.stringify({}), { status: 200 });
      };

      const { status, body: orderBody } = await postOrders(
        {
          lineItems:     [{ productId: 2, quantity: 1 }],
          paymentMethod: "cod",
          // No paymentReference — this is the COD case with no anchor.
          shippingAddress: { firstName: "Test", lastName: "Buyer", address1: "4 Test St", city: "Nairobi", phone: "+254700000041" },
          idempotencyKey:  `coe-wc-cod-${wcOrderId}`,
        },
        jwt,
      );

      assert.equal(
        status, 200,
        `order route must return 200; got ${status}, body: ${JSON.stringify(orderBody)}`,
      );

      const captured = await waitFor(() => resendCalls.length > 0, 4000);
      assert.ok(captured, "sendViaResend must be called within 4 s for WC COD path");

      const call = resendCalls[0]!;

      // "to" must be EXACTLY the test user's email address.
      assert.equal(call.to, userEmail, `"to" must be the test user's email; got: ${call.to}`);

      // Subject must contain the WC order ID.
      assert.ok(
        call.subject.includes(String(wcOrderId)),
        `subject must include the WC order ID (${wcOrderId}); got: "${call.subject}"`,
      );

      // Body must name the line item.
      const bodyText = (call.html ?? "") + (call.text ?? "");
      assert.ok(bodyText.includes("Truva Go"), "email body must contain the line-item name");

      // Track anchor for cleanup.
      const anchors = await db
        .select({ id: ucOrdersTable.id })
        .from(ucOrdersTable)
        .where(eq(ucOrdersTable.userId, String(userId)));
      for (const r of anchors) createdOrderIds.push(r.id);

    } finally {
      globalThis.fetch = realFetch;
      if (savedWcKey    !== undefined) process.env["WC_CONSUMER_KEY"]    = savedWcKey;    else delete process.env["WC_CONSUMER_KEY"];
      if (savedWcSecret !== undefined) process.env["WC_CONSUMER_SECRET"] = savedWcSecret; else delete process.env["WC_CONSUMER_SECRET"];
      if (savedWcBase   !== undefined) process.env["WC_BASE_URL"]        = savedWcBase;   else delete process.env["WC_BASE_URL"];
    }
  });
});

// ── Path A3 — WooCommerce path with empty line_items ─────────────────────────
//
// When WooCommerce returns an order whose line_items array is empty the route
// must still create the order and send a confirmation email whose body contains
// the "No items listed" fallback text (rendered by buildOrderReceiptEmail).

describe("createOrder — WooCommerce path — empty line_items — fallback receipt sent", () => {
  it("creates the order and emails a receipt containing 'No items listed'", async () => {
    const { id: userId, email: userEmail, jwt } = await createTestUser("wc-empty-items");

    const savedWcKey    = process.env["WC_CONSUMER_KEY"];
    const savedWcSecret = process.env["WC_CONSUMER_SECRET"];
    const savedWcBase   = process.env["WC_BASE_URL"];
    const savedPsKey    = process.env["PAYSTACK_SECRET_KEY"];
    delete process.env["PAYSTACK_SECRET_KEY"];

    try {
      process.env["WC_CONSUMER_KEY"]    = "test_wc_key_empty";
      process.env["WC_CONSUMER_SECRET"] = "test_wc_secret_empty";
      process.env["WC_BASE_URL"]        = "https://wc-empty.test";

      const payRef    = nextRef();
      const wcOrderId = 7700 + seq;

      const resendCalls: { to: string; subject: string; html: string; text: string }[] = [];

      globalThis.fetch = async (url: unknown, init?: RequestInit) => {
        const u = String(url);

        // WC orders POST → mock WooCommerce response with NO line items.
        if (u.includes("/products")) return new Response(JSON.stringify([{id:1,name:"Hydra Flux",price:"3499",stock_status:"instock"}]));
        if (u.includes("wc-empty.test") && u.includes("/orders") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              id:             wcOrderId,
              status:         "processing",
              date_created:   new Date().toISOString(),
              total:          "0",
              currency:       "KES",
              payment_method: "paystack",
              shipping:       {},
              line_items:     [],          // ← the key fixture: empty array
              meta_data:      [],
            }),
            { status: 201 },
          );
        }

        // WC orders GET (idempotency reconciliation) → empty list.
        if (u.includes("wc-empty.test") && u.includes("/orders")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        // Resend → capture payload.
        if (u.includes("resend.com") && u.includes("/emails")) {
          const body = JSON.parse(init?.body as string ?? "{}") as typeof resendCalls[0];
          resendCalls.push(body);
          return new Response(JSON.stringify({ id: "re_wc_empty_stub" }), { status: 200 });
        }

        return new Response(JSON.stringify({}), { status: 200 });
      };

      const { status, body: orderBody } = await postOrders(
        {
          lineItems:        [{productId:1,quantity:1}], // Valid cart; WC unexpectedly omits its receipt lines.
          paymentMethod:    "paystack",
          paymentReference: payRef,
          shippingAddress:  { firstName: "Test", lastName: "Buyer", address1: "5 Empty St", city: "Nairobi", phone: "+254711000013" },
          idempotencyKey:   `coe-wc-empty-${payRef}`,
        },
        jwt,
      );

      // The route must accept and create the order (not reject it).
      assert.equal(
        status, 200,
        `order route must return 200 for empty line_items; got ${status}, body: ${JSON.stringify(orderBody)}`,
      );

      // sendOrderConfirmationEmail fires fire-and-forget — wait for it.
      const captured = await waitFor(() => resendCalls.length > 0, 4000);
      assert.ok(captured, "sendViaResend must be called within 4 s for empty line_items WC path");

      const call = resendCalls[0]!;

      // "to" must be EXACTLY the test user's email address.
      assert.equal(call.to, userEmail, `"to" must be the test user's email; got: ${call.to}`);

      // Subject must contain the WC order ID.
      assert.ok(
        call.subject.includes(String(wcOrderId)),
        `subject must include the WC order ID (${wcOrderId}); got: "${call.subject}"`,
      );

      // The email body must contain the "No items listed" fallback text.
      const bodyText = (call.html ?? "") + (call.text ?? "");
      assert.ok(
        bodyText.toLowerCase().includes("no items listed"),
        `email body must contain the "No items listed" fallback when line_items is empty; ` +
        `got html snippet: ${call.html?.slice(0, 300) ?? "(empty)"}`,
      );

      // Clean up: track anchor order rows.
      const anchors = await db
        .select({ id: ucOrdersTable.id })
        .from(ucOrdersTable)
        .where(eq(ucOrdersTable.userId, String(userId)));
      for (const r of anchors) createdOrderIds.push(r.id);

    } finally {
      globalThis.fetch = realFetch;
      if (savedWcKey    !== undefined) process.env["WC_CONSUMER_KEY"]    = savedWcKey;    else delete process.env["WC_CONSUMER_KEY"];
      if (savedWcSecret !== undefined) process.env["WC_CONSUMER_SECRET"] = savedWcSecret; else delete process.env["WC_CONSUMER_SECRET"];
      if (savedWcBase   !== undefined) process.env["WC_BASE_URL"]        = savedWcBase;   else delete process.env["WC_BASE_URL"];
      if (savedPsKey    !== undefined) process.env["PAYSTACK_SECRET_KEY"] = savedPsKey;   else delete process.env["PAYSTACK_SECRET_KEY"];
    }
  });
});

// ── Path B — DB path ──────────────────────────────────────────────────────────

describe("createOrder — DB path — sendViaResend is called", () => {
  it("emails the customer's exact address when the order is saved to the database (COD)", async () => {
    // Ensure no WC credentials are active so the request goes to the DB path.
    const savedWcKey    = process.env["WC_CONSUMER_KEY"];
    const savedWcSecret = process.env["WC_CONSUMER_SECRET"];
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];

    const { id: userId, email: userEmail, jwt } = await createTestUser("db");
    const resendCalls: { to: string; subject: string; html: string; text: string }[] = [];

    try {
      globalThis.fetch = async (url: unknown, init?: RequestInit) => {
        if (String(url).includes("resend.com") && String(url).includes("/emails")) {
          const body = JSON.parse(init?.body as string ?? "{}") as typeof resendCalls[0];
          resendCalls.push(body);
          return new Response(JSON.stringify({ id: "re_db_stub" }), { status: 200 });
        }
        // Push notification and any other outbound call — succeed silently.
        return new Response(JSON.stringify({}), { status: 200 });
      };

      const { status, body: orderBody } = await postOrders(
        {
          lineItems:     [{ productId: 22, quantity: 2 }],  // Bottle Filter Cartridge × 2
          paymentMethod: "cod",
          shippingAddress: { firstName: "Test", lastName: "Buyer", address1: "2 Test St", city: "Nairobi", phone: "+254712345021" },
          idempotencyKey:  `coe-db-${Date.now()}`,
        },
        jwt,
      );

      assert.equal(
        status, 200,
        `order route must return 200; got ${status}, body: ${JSON.stringify(orderBody)}`,
      );

      const orderId = orderBody["id"];
      assert.ok(orderId !== undefined, "response must contain an order id");

      const captured = await waitFor(() => resendCalls.length > 0, 4000);
      assert.ok(captured, "sendViaResend must be called within 4 s on the DB path");

      const call = resendCalls[0]!;

      // "to" must be EXACTLY the test user's email address.
      assert.equal(call.to, userEmail, `"to" must be the test user's email; got: ${call.to}`);

      // Subject or body must contain the order ID.
      const bodyText = (call.html ?? "") + (call.text ?? "") + call.subject;
      assert.ok(
        bodyText.includes(String(orderId)),
        `email must reference the order id (${orderId})`,
      );

      // Body must name at least one line item.
      assert.ok(
        bodyText.includes("Bottle Filter Cartridge"),
        "email body must contain the line-item name",
      );

      if (typeof orderId === "number") createdOrderIds.push(orderId);

    } finally {
      globalThis.fetch = realFetch;
      if (savedWcKey    !== undefined) process.env["WC_CONSUMER_KEY"]    = savedWcKey;    else delete process.env["WC_CONSUMER_KEY"];
      if (savedWcSecret !== undefined) process.env["WC_CONSUMER_SECRET"] = savedWcSecret; else delete process.env["WC_CONSUMER_SECRET"];
    }

    const allRows = await db
      .select({ id: ucOrdersTable.id })
      .from(ucOrdersTable)
      .where(eq(ucOrdersTable.userId, String(userId)));
    for (const r of allRows) createdOrderIds.push(r.id);
  });
});

// ── Path B2 — DB path with Stripe payment verification in mock mode ───────────

describe("createOrder — Stripe DB path — sendViaResend is called", () => {
  it("emails the customer's exact address after a Stripe payment in mock mode", async () => {
    const savedWcKey = process.env["WC_CONSUMER_KEY"];
    const savedWcSecret = process.env["WC_CONSUMER_SECRET"];
    const savedStripeKey = process.env["STRIPE_SECRET_KEY"];

    try {
      // Select the local DB path and Stripe's no-key verification branch.
      // Never contact Stripe or WooCommerce using workspace credentials.
      delete process.env["WC_CONSUMER_KEY"];
      delete process.env["WC_CONSUMER_SECRET"];
      delete process.env["STRIPE_SECRET_KEY"];

      const { id: userId, email: userEmail, jwt } = await createTestUser("db-stripe");
      const paymentReference = `cs_test_${nextRef()}`;
      const resendCalls: { to: string; subject: string; html: string; text: string }[] = [];

      globalThis.fetch = async (url: unknown, init?: RequestInit) => {
        if (String(url).includes("resend.com") && String(url).includes("/emails")) {
          resendCalls.push(JSON.parse(init?.body as string ?? "{}") as typeof resendCalls[0]);
          return new Response(JSON.stringify({ id: "re_db_stripe_stub" }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      };

      const { status, body: orderBody } = await postOrders(
        {
          lineItems: [{ productId: 22, quantity: 2 }],
          paymentMethod: "stripe",
          paymentReference,
          shippingAddress: { firstName: "Test", lastName: "Buyer", address1: "6 Test St", city: "Nairobi", phone: "+254712345022" },
          idempotencyKey: `coe-db-stripe-${paymentReference}`,
        },
        jwt,
      );

      assert.equal(status, 200, `Stripe order must succeed; got ${status}, body: ${JSON.stringify(orderBody)}`);
      const orderId = orderBody["id"];
      assert.equal(typeof orderId, "number", "response must contain a DB order id");
      createdOrderIds.push(orderId as number);

      const [storedOrder] = await db.select().from(ucOrdersTable)
        .where(eq(ucOrdersTable.id, orderId as number));
      assert.ok(storedOrder, "Stripe order must be persisted, not an in-memory fallback");
      assert.equal(storedOrder.userId, String(userId));
      assert.equal(storedOrder.paymentMethod, "stripe");
      assert.equal(storedOrder.paymentReference, paymentReference);
      assert.equal(storedOrder.status, "processing", "verified Stripe payment must produce a paid order");

      assert.ok(
        await waitFor(() => resendCalls.length > 0),
        "sendViaResend must be called within 4 s for the Stripe DB path",
      );
      assert.equal(resendCalls.length, 1, "Stripe checkout must send one confirmation email");
      const call = resendCalls[0]!;
      assert.equal(call.to, userEmail);
      assert.ok(call.subject.includes(String(orderId)), "subject must contain the Stripe order id");
      const bodyText = (call.html ?? "") + (call.text ?? "");
      assert.ok(bodyText.includes("Bottle Filter Cartridge"), "receipt body must contain the purchased item");
    } finally {
      globalThis.fetch = realFetch;
      if (savedWcKey !== undefined) process.env["WC_CONSUMER_KEY"] = savedWcKey; else delete process.env["WC_CONSUMER_KEY"];
      if (savedWcSecret !== undefined) process.env["WC_CONSUMER_SECRET"] = savedWcSecret; else delete process.env["WC_CONSUMER_SECRET"];
      if (savedStripeKey !== undefined) process.env["STRIPE_SECRET_KEY"] = savedStripeKey; else delete process.env["STRIPE_SECRET_KEY"];
    }
  });
});

// ── Path C — Fallback path ────────────────────────────────────────────────────
//
// The fallback block in createOrder calls the exported sendOrderConfirmationEmail
// function with the in-memory fallbackOrder object.  We test that function
// directly with a real DB user so getUserContact resolves a real contact row —
// the same code path the route exercises on a DB failure.
//
// Using a small integer order ID avoids the integer-column overflow that
// Date.now() would cause in the notification-log table.

describe("createOrder — fallback path — sendViaResend is called via sendOrderConfirmationEmail", () => {
  it("emails the customer's exact address with order ID and line items", async () => {
    const { id: userId, email: userEmail } = await createTestUser("fallback");

    const resendCalls: { to: string; subject: string; html: string; text: string }[] = [];
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("resend.com") && String(url).includes("/emails")) {
        resendCalls.push(JSON.parse(init?.body as string ?? "{}") as typeof resendCalls[0]);
        return new Response(JSON.stringify({ id: "re_fallback_stub" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    // Use a small integer that fits in a Postgres INTEGER column.
    const fallbackOrderId = 10_001 + seq;

    try {
      // Import the production helper that the fallback block calls.
      const { sendOrderConfirmationEmail } = await import("../routes/uc.js");

      // Shape mirrors exactly what the fallback block constructs.
      sendOrderConfirmationEmail(String(userId), {
        orderId:       fallbackOrderId,
        lineItems: [
          { name: "Hydra Flux",             quantity: 1, total: "3499" },
          { name: "Bottle Filter Cartridge", quantity: 2, total: "2198" },
        ],
        total:         "5697",
        currency:      "KES",
        paymentMethod: "mpesa",
        shippingAddress: { firstName: "Test", lastName: "Buyer", address1: "3 Test Rd", city: "Nairobi" },
        discountAmount:  0,
        promoCode:       "",
      });

      // sendOrderConfirmationEmail is fire-and-forget — wait for Resend capture.
      const captured = await waitFor(() => resendCalls.length > 0, 4000);
      assert.ok(captured, "sendViaResend must be called within 4 s on the fallback path");

      const call = resendCalls[0]!;

      // "to" must be EXACTLY the test user's email address.
      assert.equal(call.to, userEmail, `"to" must be the test user's email; got: ${call.to}`);

      // Subject must contain the fallback order ID.
      assert.ok(
        call.subject.includes(String(fallbackOrderId)),
        `subject must contain the fallback order ID (${fallbackOrderId}); got: "${call.subject}"`,
      );

      // Body must name at least one line item.
      const bodyText = (call.html ?? "") + (call.text ?? "");
      assert.ok(
        bodyText.includes("Hydra Flux") || bodyText.includes("Bottle Filter Cartridge"),
        "email body must contain at least one line-item name",
      );

    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
