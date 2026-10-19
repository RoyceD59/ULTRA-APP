/**
 * Tests for Paystack retryable-error signalling.
 *
 * Covers:
 *   1. Init outage — Paystack API throws a network error →
 *        server returns 500 with { retryable: true }
 *   2. Verify outage — Paystack verify endpoint throws →
 *        server returns 500 with { retryable: true }
 *   3. Verified decline — Paystack returns { status: true, data: { status: "failed" } } →
 *        server returns 200 with { success: false, status: "failed" }
 *        (retryable is absent / false — permanent failure)
 *   4. Init upstream 5xx JSON → 500 with retryable: true
 *   5. Verify upstream 5xx JSON → 500 with retryable: true
 *   6. Paystack outage during POST /api/uc/orders (upstream 5xx) →
 *        server returns 503 with { retryable: true } so client can offer retry/COD
 *   7. Paystack outage during order creation (thrown exception) → 503 + retryable: true
 *   8. Checkout-level: ApiError classification — 503/5xx body → retryable; 402 decline → not retryable
 *      (Mirrors the contract consumed by uc-companion checkout.tsx.
 *       Tested here because the uc-companion test runner is blocked by an Expo module resolution issue.)
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pool } from "@workspace/db";
import { paymentCheckoutFixture } from "./helpers/payment-checkout.js";
import { prepareCheckoutOrder, bindCheckoutPayment } from "../lib/checkout-orders.js";

async function pendingCheckout(reference: string) {
  const checkout = paymentCheckoutFixture();
  const order = await prepareCheckoutOrder(checkout,"anonymous","paystack");
  await bindCheckoutPayment(order.id,reference,{ reference });
  return {...checkout,paymentMethod:"paystack",paymentReference:reference};
}

// ── Real fetch reference — saved before any mock can replace it ───────────────
// Typed explicitly so TypeScript does not widen the cast.
let realFetch: typeof globalThis.fetch;

// ── Minimal fetch wrapper ─────────────────────────────────────────────────────
async function apiFetch(
  path: string,
  init: RequestInit & { server: http.Server },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { server, ...options } = init;
  const addr = server.address() as { port: number };
  const res = await realFetch(`http://localhost:${addr.port}${path}`, options);
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // leave as {}
  }
  return { status: res.status, body };
}

// ── Server lifecycle ──────────────────────────────────────────────────────────
let server: http.Server;

before(async () => {
  // Capture the real fetch before any test mock replaces it, so apiFetch can
  // always reach the local test server regardless of what the current test patches.
  realFetch = globalThis.fetch;

  // A non-empty secret makes the route take the real Paystack branch
  // (rather than the mock-response short-circuit).
  process.env["PAYSTACK_SECRET_KEY"] ??= "sk_test_fake_key_for_testing";
  process.env["SESSION_SECRET"] ??= "test-secret-paystack-retryable";
  for (const key of ["WC_BASE_URL", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET"]) delete process.env[key];

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) =>
      err ? reject(err) : resolve(),
    );
  });
});

after(
  async () => {
    await pool.query("DELETE FROM uc_orders WHERE checkout_idempotency_key LIKE 'retryable-init-%'");
    return new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  },
);

// ── Helper: make Paystack init request ───────────────────────────────────────
async function postPaystackInit(srv: http.Server) {
  return apiFetch("/api/payments/paystack/init", {
    server: srv,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email:"test@example.com",amount:1000,checkout:paymentCheckoutFixture(),
      callbackUrl:"https://checkout.test/paystack/callback" }),
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────
describe("Paystack retryable error signalling", () => {
  it("init outage → 500 with retryable: true", async () => {
    // Simulate a network-level failure reaching Paystack
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      throw new Error("ECONNREFUSED — Paystack unreachable (simulated)");
    });

    try {
      const { status, body } = await postPaystackInit(server);
      assert.equal(status, 500, "should be HTTP 500 for a transient outage");
      assert.equal(
        body["retryable"],
        true,
        "retryable must be true so the client can offer a retry path",
      );
      assert.ok(
        typeof body["error"] === "string" && body["error"].length > 0,
        "error message should be present",
      );
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("verify outage → 500 with retryable: true", async () => {
    // Simulate a network-level failure when verifying a reference
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      throw new Error("ETIMEDOUT — Paystack verify unreachable (simulated)");
    });

    try {
      const { status, body } = await apiFetch(
        "/api/payments/paystack/verify/ps_ref_outage_test",
        { server, method: "GET", headers: {} },
      );
      assert.equal(status, 500, "should be HTTP 500 for a transient verify outage");
      assert.equal(
        body["retryable"],
        true,
        "retryable must be true so the client does not show 'Payment Declined'",
      );
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("verified decline → 200 with success: false and status: 'failed'", async () => {
    // Paystack returns a successful HTTP 200 but with a declined transaction status
    const failedPaystackResponse = {
      status: true,
      data: { status: "failed" },
    };
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(JSON.stringify(failedPaystackResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    try {
      const { status, body } = await apiFetch(
        "/api/payments/paystack/verify/ps_ref_declined_test",
        { server, method: "GET", headers: {} },
      );
      assert.equal(
        status,
        200,
        "a decline is a normal Paystack response — should be HTTP 200",
      );
      assert.equal(
        body["success"],
        false,
        "success must be false for a declined transaction",
      );
      assert.equal(
        body["status"],
        "failed",
        "status must be 'failed' so the client can show decline-specific advice",
      );
      // A decline is permanent — retryable must NOT be true
      assert.notEqual(
        body["retryable"],
        true,
        "retryable must not be true for a genuine card decline",
      );
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("init upstream 5xx JSON → 500 with retryable: true", async () => {
    // Paystack itself responds with 500 — this is distinct from a thrown exception
    // and is the more common outage pattern.
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(JSON.stringify({ message: "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    );

    try {
      const { status, body } = await postPaystackInit(server);
      assert.equal(status, 500, "should be HTTP 500 for an upstream Paystack 5xx");
      assert.equal(
        body["retryable"],
        true,
        "retryable must be true for a Paystack upstream 5xx so client offers retry/COD",
      );
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("verify upstream 5xx JSON → 500 with retryable: true", async () => {
    // Paystack verify endpoint returns 5xx (not a thrown exception)
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(JSON.stringify({ message: "Service Unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );

    try {
      const { status, body } = await apiFetch(
        "/api/payments/paystack/verify/ps_ref_upstream_5xx_test",
        { server, method: "GET", headers: {} },
      );
      assert.equal(status, 500, "should be HTTP 500 for an upstream Paystack verify 5xx");
      assert.equal(
        body["retryable"],
        true,
        "retryable must be true so client does not show 'Payment Declined'",
      );
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("Paystack outage during order creation (upstream 5xx) → 503 with retryable: true", async () => {
    // Paystack verify returns 5xx during the server-side verification inside
    // POST /api/uc/orders — must propagate as retryable to the client.
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(JSON.stringify({ message: "Gateway Timeout" }), {
          status: 504,
          headers: { "Content-Type": "application/json" },
        }),
    );

    try {
      const { status, body } = await apiFetch("/api/uc/orders", {
        server,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await pendingCheckout("ps_ref_upstream_5xx_order_test")),
      });
      assert.equal(status, 503, "should be HTTP 503 for a retryable Paystack verify 5xx during order creation");
      assert.equal(body["retryable"], true, "retryable must be true");
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("Paystack outage during order creation (thrown exception) → 503 with retryable: true", async () => {
    // Simulate a network failure when verifyPaymentOnServer calls Paystack during
    // POST /api/uc/orders.  The client must receive retryable:true so it can
    // offer "Try again or pay with COD" rather than "Payment Declined".
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      throw new Error("ECONNRESET — Paystack unreachable during order creation (simulated)");
    });

    try {
      const { status, body } = await apiFetch("/api/uc/orders", {
        server,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await pendingCheckout("ps_ref_order_outage_test")),
      });

      // 503 signals a transient failure (not 402 which would look like a decline)
      assert.equal(
        status,
        503,
        "should be HTTP 503 (not 402) for a transient Paystack outage during order creation",
      );
      assert.equal(
        body["retryable"],
        true,
        "retryable must be true so ApiError>=500 triggers the retry/COD path, not 'Payment Declined'",
      );
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("a retired WooCommerce outage cannot block verified app-order confirmation or duplicate its retry", async () => {
    const previousKey = process.env["WC_CONSUMER_KEY"];
    const previousSecret = process.env["WC_CONSUMER_SECRET"];
    process.env["WC_CONSUMER_KEY"] = "ck_paystack_wc_outage_test";
    process.env["WC_CONSUMER_SECRET"] = "cs_paystack_wc_outage_test";

    const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/wp-json/wc/v3/products")) return new Response(JSON.stringify([
        {id:1,name:"Filter fixture",price:"1000",stock_status:"instock",status:"publish"},
        {id:22,name:"Bottle Filter Cartridge",price:"1099",stock_status:"instock",status:"publish"},
      ]));
      if (url.includes("api.paystack.co/transaction/verify/")) {
        return new Response(JSON.stringify({
          status: true,
          data: { status: "success", amount: 349900, currency:"KES" },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/wp-json/wc/v3/orders") && (init?.method ?? "GET").toUpperCase() === "GET") {
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/wp-json/wc/v3/orders")) {
        return new Response(JSON.stringify({ message: "Service Unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const payload = await pendingCheckout("ps_ref_wc_outage_retry_test");

    try {
      let orderId: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { status, body } = await apiFetch("/api/uc/orders", {
          server,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        assert.equal(status, 200,JSON.stringify(body));
        if (orderId !== undefined) assert.equal(body.id,orderId);
        orderId=body.id;
      }
    } finally {
      fetchMock.mock.restore();
      if (previousKey === undefined) delete process.env["WC_CONSUMER_KEY"];
      else process.env["WC_CONSUMER_KEY"] = previousKey;
      if (previousSecret === undefined) delete process.env["WC_CONSUMER_SECRET"];
      else process.env["WC_CONSUMER_SECRET"] = previousSecret;
    }
  });
});

// ── Checkout-level: ApiError classification tests ─────────────────────────────
// These replicate the ApiError class contract from
// uc-companion/hooks/useApi.ts and the payment-decline classification.
// They are placed here because the uc-companion test runner is blocked by an
// Expo module-resolution issue.  Any change to ApiError or the checkout
// retryable-handling logic must keep these contracts.
//
// Contract:
//   - A 5xx response body with retryable:true → ApiError.retryable === true → retry/COD path
//   - A 402 response body with no retryable flag → ApiError.retryable === false → decline path
//   - A thrown non-ApiError (network error) → treated as retryable by checkout

class ApiError extends Error {
  status: number;
  retryable: boolean;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = body["retryable"] === true || status >= 500;
    this.body = body;
  }
}

function classifyCheckoutError(e: unknown): "retryable" | "declined" {
  // Mirrors handlePaystack catch block in checkout.tsx
  if (e instanceof ApiError) return e.retryable ? "retryable" : "declined";
  return "retryable"; // unknown / network errors default to retryable
}

describe("Checkout-level: ApiError classification", () => {
  it("503 + retryable:true body → classified as retryable (retry/COD path)", () => {
    const e = new ApiError("Payment not verified", 503, { retryable: true });
    assert.equal(classifyCheckoutError(e), "retryable");
  });

  it("500 + no retryable flag → still retryable (status >= 500 fallback)", () => {
    const e = new ApiError("Internal Server Error", 500, {});
    assert.equal(classifyCheckoutError(e), "retryable");
  });

  it("402 + no retryable flag → classified as declined (check card path)", () => {
    const e = new ApiError("Payment not verified", 402, {});
    assert.equal(classifyCheckoutError(e), "declined");
  });

  it("402 + retryable:false → classified as declined", () => {
    const e = new ApiError("Payment Declined", 402, { retryable: false });
    assert.equal(classifyCheckoutError(e), "declined");
  });

  it("non-ApiError (network error thrown) → classified as retryable", () => {
    const e = new Error("ECONNRESET");
    assert.equal(classifyCheckoutError(e), "retryable");
  });

});
