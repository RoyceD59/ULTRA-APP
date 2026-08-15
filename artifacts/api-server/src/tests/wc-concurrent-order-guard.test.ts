/**
 * Test for the WooCommerce concurrent-order guard in POST /api/uc/orders.
 *
 * Covers the race window where two requests with the same paymentReference
 * arrive while WC credentials are present:
 *   – Request A wins the "pending-wc" anchor insert, calls WooCommerce.
 *   – Request B hits the unique-constraint (Postgres 23505, surfaced through
 *     DrizzleQueryError's `.cause`), finds the winner's anchor still
 *     "pending-wc", reconciles against WC, and returns the SAME order.
 *
 * Asserts:
 *   1. Both requests return 200 with the same (WooCommerce) order ID.
 *   2. Exactly ONE WooCommerce order-creation POST is made (fetch stub count).
 *   3. Exactly one anchor row exists in uc_orders for the reference, confirmed
 *      to "processing".
 *   4. Exactly one confirmation email is dispatched (only the confirm winner).
 *
 * Determinism strategy:
 *   The fetch stub holds the WC order-creation POST open until request B has
 *   been fired and has reached its reconciliation lookup. WC "list orders"
 *   lookups made after the POST started block until the WC order exists, so
 *   B's reconciliation cannot observe a not-yet-created order.
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

const PAY_REF = `wc_race_test_${Date.now()}`;
const WC_ORDER_ID = 990_001;

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
  const email = `wc-race-${Date.now()}@uctest.internal`;
  const hash = await bcryptjs.hash("Test1234!", 4);
  const [row] = await db
    .insert(ucUsersTable)
    .values({
      email,
      passwordHash: hash,
      firstName: "Test",
      lastName: "Racer",
      phone: "+254711000042",
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

    process.env["SESSION_SECRET"] ??= "test-secret-wc-race";
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

describe("WooCommerce concurrent-order guard — same paymentReference race", () => {
  it("two racing POSTs both return 200 with the same order ID and create exactly one WC order", { timeout: 30_000 }, async () => {
    const { jwt } = await createTestUser();

    // ── Fetch stub state machine ─────────────────────────────────────────────
    let wcPostCount = 0;
    let wcOrder: Record<string, unknown> | null = null;
    const resendCalls: unknown[] = [];

    let postStarted = false;
    let signalPostStarted!: () => void;
    const postStartedPromise = new Promise<void>((r) => (signalPostStarted = r));

    let releasePost!: () => void;
    const releasePostPromise = new Promise<void>((r) => (releasePost = r));

    let signalOrderCreated!: () => void;
    const orderCreatedPromise = new Promise<void>((r) => (signalOrderCreated = r));

    // Count of WC list-order lookups made AFTER the creation POST started —
    // these are request B's reconciliation queries.
    let lateLookupCount = 0;

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown, init?: RequestInit): Promise<Response> => {
      const u = String(url);

      // Resend email dispatch — count and absorb.
      if (u.includes("resend.com") && u.includes("/emails")) {
        resendCalls.push(JSON.parse((init?.body as string) ?? "{}"));
        return new Response(JSON.stringify({ id: "re_wc_race_stub" }), { status: 200 });
      }

      // WooCommerce REST API.
      if (u.includes("/wp-json/wc/v3/orders")) {
        const method = (init?.method ?? "GET").toUpperCase();

        if (method === "POST") {
          // WC order creation — hold open until the test releases it, so the
          // second request races into the pending-wc window deterministically.
          wcPostCount++;
          postStarted = true;
          signalPostStarted();
          await releasePostPromise;
          wcOrder = {
            id: WC_ORDER_ID,
            status: "processing",
            date_created: new Date().toISOString(),
            total: "3999",
            currency: "KES",
            payment_method: "paystack",
            shipping: { first_name: "Test", last_name: "Racer" },
            line_items: [
              { product_id: 1, name: "Hydra Flux", quantity: 1, total: "3499" },
            ],
            meta_data: [{ key: "payment_reference", value: PAY_REF }],
          };
          signalOrderCreated();
          return new Response(JSON.stringify(wcOrder), { status: 201 });
        }

        // GET — order lookup (pre-flight or reconciliation).
        if (!postStarted) {
          // Winner's pre-flight: WC has no order yet → terminal empty page.
          return new Response(JSON.stringify([]), { status: 200 });
        }
        // Lookup racing the in-flight creation POST: wait until the WC order
        // exists, then return it (a real WC would eventually show it; blocking
        // keeps the test deterministic).
        lateLookupCount++;
        await orderCreatedPromise;
        return new Response(JSON.stringify([wcOrder]), { status: 200 });
      }

      // Push / SMS / anything else — succeed silently.
      return new Response(JSON.stringify({}), { status: 200 });
    };

    // WC credentials present → orders go through the WC idempotency path.
    process.env["WC_CONSUMER_KEY"] = "ck_test_race";
    process.env["WC_CONSUMER_SECRET"] = "cs_test_race";
    process.env["WC_BASE_URL"] = "https://wc-race.test.internal";

    try {
      const payload = {
        lineItems: [{ productId: 1, quantity: 1 }], // Hydra Flux
        paymentMethod: "paystack",
        paymentReference: PAY_REF,
        shippingAddress: {
          firstName: "Test",
          lastName: "Racer",
          address1: "1 Race St",
          city: "Nairobi",
          country: "KE",
          phone: "+254711000042",
        },
      };

      // Fire request A. It claims the pending-wc anchor and blocks inside the
      // WC creation POST (held open by the stub).
      const firstPromise = postOrders(payload, jwt);
      await postStartedPromise;

      // Anchor is committed and still "pending-wc". Fire request B — it must
      // hit the unique constraint (23505) and enter the reconciliation branch.
      const secondPromise = postOrders(payload, jwt);

      // Wait until B has reached its WC reconciliation lookup (it is now
      // blocked on the in-flight order creation) before releasing A's POST.
      const bReachedLookup = await waitFor(() => lateLookupCount > 0, 10_000);
      assert.ok(
        bReachedLookup,
        "second request must hit the 23505 guard and reconcile against WC while the anchor is still pending-wc",
      );
      releasePost();

      const [first, second] = await Promise.all([firstPromise, secondPromise]);

      assert.equal(
        first.status, 200,
        `first request must return 200; got ${first.status}: ${JSON.stringify(first.body)}`,
      );
      assert.equal(
        second.status, 200,
        `second (racing) request must return 200; got ${second.status}: ${JSON.stringify(second.body)}`,
      );
      assert.equal(first.body["id"], WC_ORDER_ID, "first request must return the WC order ID");
      assert.equal(
        second.body["id"], first.body["id"],
        `both racing requests must return the SAME order ID; got ${first.body["id"]} vs ${second.body["id"]}`,
      );

      // Exactly one WooCommerce order was created.
      assert.equal(wcPostCount, 1, `exactly one WC order-creation POST must fire; got ${wcPostCount}`);

      // Exactly one anchor row exists in the DB, confirmed to "processing".
      const anchors = await db
        .select({ id: ucOrdersTable.id, status: ucOrdersTable.status })
        .from(ucOrdersTable)
        .where(eq(ucOrdersTable.paymentReference, PAY_REF));
      assert.equal(anchors.length, 1, `exactly one uc_orders row must exist for the reference; got ${anchors.length}`);
      assert.equal(anchors[0]!.status, "processing", "the surviving anchor must be confirmed to 'processing'");

      // Only the confirm winner sends the confirmation email — exactly one.
      await waitFor(() => resendCalls.length > 0, 4000);
      await new Promise((r) => setTimeout(r, 300)); // allow any stray second email
      assert.equal(
        resendCalls.length, 1,
        `exactly one confirmation email must be sent; got ${resendCalls.length}`,
      );
    } finally {
      delete process.env["WC_CONSUMER_KEY"];
      delete process.env["WC_CONSUMER_SECRET"];
      delete process.env["WC_BASE_URL"];
      globalThis.fetch = savedFetch;
    }
  });
});
