/**
 * Test: duplicate Paystack delivery when WooCommerce is offline on the retry.
 *
 * Alongside wc-sequential-duplicate.test.ts, which verifies the happy-path
 * (WC reachable on both calls), this suite verifies that a confirmed anchor
 * returns the SAME WooCommerce order ID on the retry even when the live WC
 * lookup fails — because confirmWcAnchor now persists wcOrderId on the anchor.
 *
 * Sequence:
 *   – Request 1: WC reachable → anchor confirmed, wcOrderId stored, WC ID returned.
 *   – Request 2 (duplicate): WC stub throws → live lookup fails → wcOrderId
 *     read from anchor → same WC order ID returned.
 *
 * Asserts:
 *   1. Both calls return 200 with the same WC order ID.
 *   2. Exactly ONE WooCommerce order-creation POST fires.
 *   3. Exactly one anchor row exists, confirmed to "processing".
 *   4. No additional confirmation email on the duplicate.
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

const PAY_REF = `wc_offline_dup_test_${Date.now()}`;
const WC_ORDER_ID = 990_301;

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
  const email = `wc-offline-dup-${Date.now()}@uctest.internal`;
  const hash = await bcryptjs.hash("Test1234!", 4);
  const [row] = await db
    .insert(ucUsersTable)
    .values({
      email,
      passwordHash: hash,
      firstName: "Test",
      lastName: "Offline",
      phone: "+254711000099",
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

    delete process.env["PAYSTACK_SECRET_KEY"];
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];

    process.env["SESSION_SECRET"] ??= "test-secret-wc-offline-dup";
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

describe("WooCommerce path — duplicate delivery when WC is offline on retry", () => {
  it("returns the same WC order ID on retry even when the live WC lookup throws", { timeout: 30_000 }, async () => {
    const { jwt } = await createTestUser();

    // ── Phase 1 fetch stub: WC is reachable ──────────────────────────────────
    let wcPostCount = 0;
    let wcOrder: Record<string, unknown> | null = null;
    const resendCalls: unknown[] = [];

    // We swap fetch stubs between the two phases (online → offline).
    function makeOnlineFetch(): typeof globalThis.fetch {
      return async (url: unknown, init?: RequestInit): Promise<Response> => {
        const u = String(url);

        if (u.includes("resend.com") && u.includes("/emails")) {
          resendCalls.push(JSON.parse((init?.body as string) ?? "{}"));
          return new Response(JSON.stringify({ id: "re_wc_offline_stub" }), { status: 200 });
        }

        if (u.includes("/wp-json/wc/v3/orders")) {
          const method = (init?.method ?? "GET").toUpperCase();
          if (method === "POST") {
            wcPostCount++;
            wcOrder = {
              id: WC_ORDER_ID,
              status: "processing",
              date_created: new Date().toISOString(),
              total: "3999",
              currency: "KES",
              payment_method: "paystack",
              shipping: { first_name: "Test", last_name: "Offline" },
              line_items: [
                { product_id: 1, name: "Hydra Flux", quantity: 1, total: "3499" },
              ],
              meta_data: [{ key: "payment_reference", value: PAY_REF }],
            };
            return new Response(JSON.stringify(wcOrder), { status: 201 });
          }
          // GET — order lookup returns the created order once it exists.
          return new Response(JSON.stringify(wcOrder ? [wcOrder] : []), { status: 200 });
        }

        return new Response(JSON.stringify({}), { status: 200 });
      };
    }

    // Phase 2: WC throws on every request (simulates a brief outage).
    function makeOfflineFetch(): typeof globalThis.fetch {
      return async (url: unknown, init?: RequestInit): Promise<Response> => {
        const u = String(url);

        if (u.includes("resend.com") && u.includes("/emails")) {
          resendCalls.push(JSON.parse((init?.body as string) ?? "{}"));
          return new Response(JSON.stringify({ id: "re_wc_offline_stub2" }), { status: 200 });
        }

        if (u.includes("/wp-json/wc/v3/orders")) {
          throw new Error("WC store offline (simulated)");
        }

        return new Response(JSON.stringify({}), { status: 200 });
      };
    }

    process.env["WC_CONSUMER_KEY"] = "ck_test_offline_dup";
    process.env["WC_CONSUMER_SECRET"] = "cs_test_offline_dup";
    process.env["WC_BASE_URL"] = "https://wc-offline-dup.test.internal";

    try {
      const payload = {
        lineItems: [{ productId: 1, quantity: 1 }],
        paymentMethod: "paystack",
        paymentReference: PAY_REF,
        shippingAddress: {
          firstName: "Test",
          lastName: "Offline",
          address1: "2 Offline Rd",
          city: "Nairobi",
          country: "KE",
          phone: "+254711000099",
        },
      };

      // ── First call: WC online ────────────────────────────────────────────
      globalThis.fetch = makeOnlineFetch();
      const first = await postOrders(payload, jwt);
      assert.equal(
        first.status, 200,
        `first call must return 200; got ${first.status}: ${JSON.stringify(first.body)}`,
      );
      assert.equal(first.body["id"], WC_ORDER_ID, "first call must return the WC order ID");
      assert.equal(wcPostCount, 1, "the first call must create exactly one WC order");

      // Wait for the original confirmation email.
      const emailSent = await waitFor(() => resendCalls.length > 0, 4000);
      assert.ok(emailSent, "confirmation email must be sent after original order creation");
      const emailCountAfterFirst = resendCalls.length;

      // Verify the anchor has the WC order ID stored.
      const anchors = await db
        .select({ id: ucOrdersTable.id, status: ucOrdersTable.status, wcOrderId: ucOrdersTable.wcOrderId })
        .from(ucOrdersTable)
        .where(eq(ucOrdersTable.paymentReference, PAY_REF));
      assert.equal(anchors.length, 1, "exactly one anchor row must exist");
      assert.equal(anchors[0]!.status, "processing", "anchor must be confirmed to 'processing'");
      assert.equal(anchors[0]!.wcOrderId, WC_ORDER_ID, "anchor must have the WC order ID stored");

      // ── Second call: WC offline ──────────────────────────────────────────
      globalThis.fetch = makeOfflineFetch();
      const second = await postOrders(payload, jwt);
      assert.equal(
        second.status, 200,
        `duplicate call must return 200 even when WC is offline; got ${second.status}: ${JSON.stringify(second.body)}`,
      );
      assert.equal(
        second.body["id"], first.body["id"],
        `duplicate call must return the SAME WC order ID (${first.body["id"]}) even when WC is offline; got ${second.body["id"]}`,
      );

      // No second WC order was created.
      assert.equal(wcPostCount, 1, "no additional WC POST must fire on the duplicate");

      // No additional email on the duplicate.
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(
        resendCalls.length, emailCountAfterFirst,
        `no additional emails must be sent on the duplicate; got ${resendCalls.length - emailCountAfterFirst} extra`,
      );
    } finally {
      delete process.env["WC_CONSUMER_KEY"];
      delete process.env["WC_CONSUMER_SECRET"];
      delete process.env["WC_BASE_URL"];
      globalThis.fetch = realFetch;
    }
  });
});
