/**
 * Test for duplicate-Paystack-webhook idempotency in POST /api/uc/orders when
 * WooCommerce credentials are PRESENT (the WC path).
 *
 * paystack-idempotency.test.ts covers the DB path (no WC credentials); this
 * suite covers a sequential retry through the WooCommerce path:
 *   – Request 1 claims the pending-wc anchor, POSTs the order to WC, confirms
 *     the anchor to "processing", and returns the WC order ID.
 *   – Request 2 (the duplicate delivery) hits the confirmed-anchor pre-check,
 *     reconciles against WC, and returns the SAME WC order — without a second
 *     WooCommerce order-creation POST.
 *
 * Asserts:
 *   1. Both calls return 200 with the same (WooCommerce) order ID.
 *   2. Exactly ONE WooCommerce order-creation POST fires.
 *   3. Exactly one anchor row exists in uc_orders, confirmed to "processing".
 *   4. Exactly one confirmation email is dispatched (original only).
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

// ── Shared state ──────────────────────────────────────────────────────────────

let realFetch: typeof globalThis.fetch;
let server: http.Server;
let base: string;

const PAY_REF = `wc_seq_dup_test_${Date.now()}`;
const WC_ORDER_ID = 990_201;

const createdUserIds: number[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postOrders(
  body: unknown,
  jwt: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await realFetch(`${base}/uc/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty */
  }
  return { status: res.status, body: parsed };
}

async function createTestUser(): Promise<{ id: number; jwt: string }> {
  const email = `wc-seq-dup-${Date.now()}@uctest.internal`;
  const hash = await bcryptjs.hash("Test1234!", 4);
  const [row] = await db
    .insert(ucUsersTable)
    .values({
      email,
      passwordHash: hash,
      firstName: "Test",
      lastName: "Duper",
      phone: "+254711000043",
    })
    .returning({ id: ucUsersTable.id });
  const id = row!.id;
  createdUserIds.push(id);

  const loginRes = await realFetch(`${base}/uc/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Test1234!" }),
  });
  assert.equal(loginRes.status, 200, "login must succeed for test user");
  const loginBody = (await loginRes.json()) as { token?: string };
  assert.ok(loginBody.token, "login response must contain a token");
  return { id, jwt: loginBody.token! };
}

/** Poll predicate for up to maxMs (25 ms cadence). */
async function waitFor(predicate: () => boolean, maxMs = 5000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(
  async () => {
    realFetch = globalThis.fetch;

    // Mock payment verification: no Paystack key → verifyPaymentOnServer ok.
    delete process.env["PAYSTACK_SECRET_KEY"];
    // WC credentials are set inside the test itself (after user login) so the
    // stubbed fetch is guaranteed to be in place before any WC call fires.
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];

    process.env["SESSION_SECRET"] ??= "test-secret-wc-seq-dup";
    process.env["RESEND_BASE_URL"] ??= "https://api.resend.com";
    process.env["RESEND_API_KEY"] ??= "re_test_key";

    await new Promise<void>((resolve, reject) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("No address"));
          return;
        }
        base = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    });
  },
  { timeout: 30_000 },
);

after(async () => {
  // Remove any orders carrying the test payment reference.
  const rows = await db
    .select({ id: ucOrdersTable.id })
    .from(ucOrdersTable)
    .where(eq(ucOrdersTable.paymentReference, PAY_REF))
    .catch(() => [] as { id: number }[]);
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(ucOrderItemsTable).where(inArray(ucOrderItemsTable.orderId, ids)).catch(() => {});
    await db.delete(ucOrdersTable).where(inArray(ucOrdersTable.id, ids)).catch(() => {});
  }
  if (createdUserIds.length > 0) {
    await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, createdUserIds)).catch(() => {});
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
  globalThis.fetch = realFetch;
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("WooCommerce path — sequential duplicate Paystack delivery", () => {
  it("a retry with the same paymentReference returns the same WC order without a second WC POST", { timeout: 30_000 }, async () => {
    const { jwt } = await createTestUser();

    // ── Fetch stub ───────────────────────────────────────────────────────────
    let wcPostCount = 0;
    let wcOrder: Record<string, unknown> | null = null;
    const resendCalls: unknown[] = [];

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown, init?: RequestInit): Promise<Response> => {
      const u = String(url);

      // Resend email dispatch — count and absorb.
      if (u.includes("resend.com") && u.includes("/emails")) {
        resendCalls.push(JSON.parse((init?.body as string) ?? "{}"));
        return new Response(JSON.stringify({ id: "re_wc_seq_stub" }), { status: 200 });
      }

      // WooCommerce REST API.
      if (u.includes("/wp-json/wc/v3/orders")) {
        const method = (init?.method ?? "GET").toUpperCase();

        if (method === "POST") {
          // WC order creation — every extra call here is a duplicate order.
          wcPostCount++;
          wcOrder = {
            id: WC_ORDER_ID,
            status: "processing",
            date_created: new Date().toISOString(),
            total: "3999",
            currency: "KES",
            payment_method: "paystack",
            shipping: { first_name: "Test", last_name: "Duper" },
            line_items: [
              { product_id: 1, name: "Hydra Flux", quantity: 1, total: "3499" },
            ],
            meta_data: [{ key: "payment_reference", value: PAY_REF }],
          };
          return new Response(JSON.stringify(wcOrder), { status: 201 });
        }

        // GET — order lookup (pre-flight before creation returns an empty
        // terminal page; after creation the order is visible).
        return new Response(JSON.stringify(wcOrder ? [wcOrder] : []), { status: 200 });
      }

      // Push / SMS / anything else — succeed silently.
      return new Response(JSON.stringify({}), { status: 200 });
    };

    // WC credentials present → orders go through the WC idempotency path.
    process.env["WC_CONSUMER_KEY"] = "ck_test_seq_dup";
    process.env["WC_CONSUMER_SECRET"] = "cs_test_seq_dup";
    process.env["WC_BASE_URL"] = "https://wc-seq-dup.test.internal";

    try {
      const payload = {
        lineItems: [{ productId: 1, quantity: 1 }], // Hydra Flux
        paymentMethod: "paystack",
        paymentReference: PAY_REF,
        shippingAddress: {
          firstName: "Test",
          lastName: "Duper",
          address1: "1 Dup St",
          city: "Nairobi",
          country: "KE",
          phone: "+254711000043",
        },
      };

      // ── First call (original order creation through WC) ───────────────────
      const first = await postOrders(payload, jwt);
      assert.equal(
        first.status, 200,
        `first call must return 200; got ${first.status}: ${JSON.stringify(first.body)}`,
      );
      assert.equal(first.body["id"], WC_ORDER_ID, "first call must return the WC order ID");
      assert.equal(wcPostCount, 1, "the first call must create exactly one WC order");

      // Wait for the original confirmation email before firing the duplicate.
      const emailSent = await waitFor(() => resendCalls.length > 0, 4000);
      assert.ok(emailSent, "confirmation email must be sent after the original order creation");
      const emailCountAfterFirst = resendCalls.length;

      // ── Second call (duplicate Paystack delivery / retry) ──────────────────
      const second = await postOrders(payload, jwt);
      assert.equal(
        second.status, 200,
        `duplicate call must return 200, not a 4xx/5xx; got ${second.status}: ${JSON.stringify(second.body)}`,
      );
      assert.equal(
        second.body["id"], first.body["id"],
        `duplicate call must return the SAME order ID (${first.body["id"]}); got ${second.body["id"]}`,
      );

      // WooCommerce was only called once — no duplicate order upstream.
      assert.equal(
        wcPostCount, 1,
        `exactly one WC order-creation POST must fire across both calls; got ${wcPostCount}`,
      );

      // Exactly one anchor row exists in the DB, confirmed to "processing".
      const anchors = await db
        .select({ id: ucOrdersTable.id, status: ucOrdersTable.status })
        .from(ucOrdersTable)
        .where(eq(ucOrdersTable.paymentReference, PAY_REF));
      assert.equal(anchors.length, 1, `exactly one uc_orders row must exist for the reference; got ${anchors.length}`);
      assert.equal(anchors[0]!.status, "processing", "the anchor must be confirmed to 'processing'");

      // No additional email on the duplicate.
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(
        resendCalls.length, emailCountAfterFirst,
        `no additional emails must be sent on the duplicate call; got ${resendCalls.length - emailCountAfterFirst} extra`,
      );
    } finally {
      delete process.env["WC_CONSUMER_KEY"];
      delete process.env["WC_CONSUMER_SECRET"];
      delete process.env["WC_BASE_URL"];
      globalThis.fetch = savedFetch;
    }
  });
});
