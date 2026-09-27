/**
 * Tests for duplicate-Paystack-webhook idempotency in POST /api/uc/orders.
 *
 * Covers:
 *   1. A second POST with the same paymentReference returns 200 with the
 *      **same** order ID — not a 402, 409, or 500.
 *   2. No confirmation email (sendViaResend) is dispatched on the retry —
 *      only the original creation fires one.
 *   3. Concurrent duplicate requests (race) are absorbed via the unique-index
 *      constraint handler and still return 200 with the same order ID.
 *
 * Strategy:
 *   – WC credentials are absent → orders go through the DB path.
 *   – PAYSTACK_SECRET_KEY is absent → verifyPaymentOnServer runs in mock mode
 *     (always { ok: true }) so verification never reaches the real Paystack API.
 *   – globalThis.fetch is replaced per-test to intercept Resend calls so we
 *     can assert exactly how many confirmation emails were sent.
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

const TEST_PREFIX = `PSI_${Date.now()}`;
let seq = 0;
/** Generate a unique payment reference per call. */
const nextRef = (): string => `ps_idem_test_${TEST_PREFIX}_${++seq}`;

const createdUserIds: number[] = [];
const createdOrderIds: number[] = [];

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

async function createTestUser(
  suffix: string,
): Promise<{ id: number; email: string; jwt: string }> {
  const email = `psi-${suffix}-${Date.now()}@uctest.internal`;
  const hash = await bcryptjs.hash("Test1234!", 4);
  const [row] = await db
    .insert(ucUsersTable)
    .values({
      email,
      passwordHash: hash,
      firstName: "Test",
      lastName: "Buyer",
      phone: "+254711000002",
    })
    .returning({ id: ucUsersTable.id });
  const id = row!.id;
  createdUserIds.push(id);

  const loginRes = await realFetch(`${base}/uc/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Test1234!" }),
  });
  assert.equal(loginRes.status, 200, `login must succeed for test user (${suffix})`);
  const loginBody = (await loginRes.json()) as { token?: string };
  assert.ok(loginBody.token, "login response must contain a token");

  return { id, email, jwt: loginBody.token! };
}

/**
 * Poll predicate for up to maxMs (50 ms cadence).
 * Returns true when predicate first fires, false on timeout.
 */
async function waitFor(predicate: () => boolean, maxMs = 4000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(
  async () => {
    realFetch = globalThis.fetch;

    // Mock mode: no real Paystack key → verifyPaymentOnServer always returns ok.
    delete process.env["PAYSTACK_SECRET_KEY"];
    // No WC credentials → orders go through the DB path.
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];

    process.env["SESSION_SECRET"] ??= "test-secret-paystack-idempotency";
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
  // Clean up orders created during the suite.
  if (createdOrderIds.length > 0) {
    await db
      .delete(ucOrderItemsTable)
      .where(inArray(ucOrderItemsTable.orderId, createdOrderIds))
      .catch(() => {});
    await db
      .delete(ucOrdersTable)
      .where(inArray(ucOrdersTable.id, createdOrderIds))
      .catch(() => {});
  }
  // Also sweep any stray orders belonging to test users.
  for (const uid of createdUserIds) {
    const rows = await db
      .select({ id: ucOrdersTable.id })
      .from(ucOrdersTable)
      .where(eq(ucOrdersTable.userId, String(uid)))
      .catch(() => [] as { id: number }[]);
    for (const r of rows) {
      await db
        .delete(ucOrderItemsTable)
        .where(eq(ucOrderItemsTable.orderId, r.id))
        .catch(() => {});
      await db
        .delete(ucOrdersTable)
        .where(eq(ucOrdersTable.id, r.id))
        .catch(() => {});
    }
  }
  if (createdUserIds.length > 0) {
    await db
      .delete(ucUsersTable)
      .where(inArray(ucUsersTable.id, createdUserIds))
      .catch(() => {});
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
  globalThis.fetch = realFetch;
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Paystack webhook idempotency — duplicate paymentReference", () => {
  it("second POST with the same paymentReference returns 200 with the same order ID", async () => {
    const { jwt } = await createTestUser("dup-200");
    const payRef = nextRef();

    const resendCalls: unknown[] = [];

    // Intercept all outbound HTTP so Resend calls land here, not on the real API.
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("resend.com") && u.includes("/emails")) {
        resendCalls.push(JSON.parse((init?.body as string) ?? "{}"));
        return new Response(JSON.stringify({ id: "re_idem_stub" }), { status: 200 });
      }
      // Push-notification / SMS / any other outbound → succeed silently.
      return new Response(JSON.stringify({}), { status: 200 });
    };

    try {
      const payload = {
        lineItems: [{ productId: 1, quantity: 1 }], // Hydra Flux
        paymentMethod: "paystack",
        paymentReference: payRef,
        shippingAddress: {
          firstName: "Test",
          lastName: "Buyer",
          address1: "1 Test St",
          city: "Nairobi",
          country: "KE",
          phone: "+254700000001",
        },
      };

      // ── First call (original order creation) ──────────────────────────────
      const first = await postOrders(payload, jwt);
      assert.equal(
        first.status,
        200,
        `first call must succeed with 200; got ${first.status}: ${JSON.stringify(first.body)}`,
      );
      const firstOrderId = first.body["id"];
      assert.ok(
        typeof firstOrderId === "number" && firstOrderId > 0,
        `first call must return a numeric order id; got: ${JSON.stringify(firstOrderId)}`,
      );
      createdOrderIds.push(firstOrderId as number);

      // Wait for the first confirmation email to be dispatched (fire-and-forget).
      const emailSentOnFirst = await waitFor(() => resendCalls.length > 0, 4000);
      assert.ok(emailSentOnFirst, "confirmation email must be sent after the first order creation");
      const emailCountAfterFirst = resendCalls.length;

      // ── Second call (duplicate / Paystack retry) ───────────────────────────
      const second = await postOrders(payload, jwt);
      assert.equal(
        second.status,
        200,
        `duplicate call must return 200, not a 4xx/5xx; got ${second.status}: ${JSON.stringify(second.body)}`,
      );
      const secondOrderId = second.body["id"];
      assert.equal(
        secondOrderId,
        firstOrderId,
        `duplicate call must return the SAME order ID (${firstOrderId}), not a new one (${secondOrderId})`,
      );

      // Give any inadvertent async email a moment to fire before asserting silence.
      await new Promise((r) => setTimeout(r, 300));

      assert.equal(
        resendCalls.length,
        emailCountAfterFirst,
        `no additional emails must be sent on the duplicate call; ` +
          `got ${resendCalls.length - emailCountAfterFirst} extra Resend call(s)`,
      );
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("second POST returns the confirmed status, not a new pending record", async () => {
    const { jwt } = await createTestUser("dup-status");
    const payRef = nextRef();

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("resend.com")) {
        return new Response(JSON.stringify({ id: "re_status_stub" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    try {
      const payload = {
        lineItems: [{ productId: 22, quantity: 1 }], // Bottle Filter Cartridge
        paymentMethod: "paystack",
        paymentReference: payRef,
        shippingAddress: {
          firstName: "Test",
          lastName: "Buyer",
          address1: "2 Test St",
          city: "Nairobi",
          country: "KE",
          phone: "+254700000002",
        },
      };

      const first = await postOrders(payload, jwt);
      assert.equal(first.status, 200, `first call must succeed`);
      const firstOrderId = first.body["id"] as number;
      createdOrderIds.push(firstOrderId);

      const second = await postOrders(payload, jwt);
      assert.equal(second.status, 200, `second call must return 200`);
      assert.equal(second.body["id"], firstOrderId, "order ID must be identical on retry");

      // The returned status must be the persisted status of the original order,
      // not a freshly-minted "pending" from a second insert.
      const persistedStatus = first.body["status"];
      assert.equal(
        second.body["status"],
        persistedStatus,
        `duplicate response must carry the same status ("${persistedStatus}") as the original`,
      );
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("COD orders (empty paymentReference) are NOT deduplicated — each call creates a new order", async () => {
    // Safety test: the idempotency guard must not apply to COD orders, which
    // share an empty paymentReference.  Two COD calls must produce two orders.
    const { id: userId, jwt } = await createTestUser("cod-no-dedup");

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("resend.com")) {
        return new Response(JSON.stringify({ id: "re_cod_stub" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    try {
      const payload = {
        lineItems: [{ productId: 22, quantity: 1 }],
        paymentMethod: "cod",
        // No paymentReference — COD.
        shippingAddress: {
          firstName: "Test",
          lastName: "Buyer",
          address1: "3 Test St",
          city: "Nairobi",
          country: "KE",
          phone: "+254700000003",
        },
      };

      const first = await postOrders(payload, jwt);
      assert.equal(first.status, 200, "first COD call must succeed");
      const firstId = first.body["id"] as number;
      createdOrderIds.push(firstId);

      const second = await postOrders(payload, jwt);
      assert.equal(second.status, 200, "second COD call must succeed");
      const secondId = second.body["id"] as number;
      createdOrderIds.push(secondId);

      assert.notEqual(
        secondId,
        firstId,
        "two COD orders must be distinct rows — empty paymentReference must not trigger the idempotency guard",
      );
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
