import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { db, ucOrdersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app.js";
import { verifyPaymentOnServer } from "../routes/uc.js";
import { paymentMocksAllowed } from "../lib/payment-configuration.js";
import { paymentCheckoutFixture } from "./helpers/payment-checkout.js";

const providerKeys = [
  "PAYSTACK_SECRET_KEY", "STRIPE_SECRET_KEY", "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY",
] as const;
const methods = ["paystack", "stripe", "mpesa"] as const;
const realFetch = globalThis.fetch;
let server: http.Server;
let base: string;
let outbound: string[] = [];

before(async () => {
  // Only the test runner's isolated database is used. Never contact live providers.
  delete process.env.WC_CONSUMER_KEY;
  delete process.env.WC_CONSUMER_SECRET;
  process.env.SESSION_SECRET = "payment-configuration-test-secret";
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});

beforeEach(() => {
  for (const key of providerKeys) delete process.env[key];
  process.env.NODE_ENV = "production";
  process.env.STRIPE_ENABLED = "true";
  outbound = [];
  globalThis.fetch = async (input) => {
    outbound.push(String(input));
    throw new Error("Unexpected provider request in a fail-closed test");
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function request(path: string, body?: unknown) {
  const response = await realFetch(`${base}${path}`, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe("Unconfigured payment providers fail closed", () => {
  for (const env of ["production", undefined, "staging"]) {
    it(`rejects arbitrary references when NODE_ENV=${env ?? "unset"}`, async () => {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      assert.equal(paymentMocksAllowed(), false);
      for (const method of methods) {
        const result = await verifyPaymentOnServer(method, "invented-payment-reference");
        assert.equal(result.ok, false, method);
        assert.equal(result.retryable, true);
        assert.match(result.reason!, /unavailable/);
      }
      assert.deepEqual(outbound, []);
    });
  }

  for (const env of ["development", "test"]) {
    it(`preserves explicit ${env} demo behavior only`, async () => {
      process.env.NODE_ENV = env;
      for (const method of methods) {
        assert.equal((await verifyPaymentOnServer(method, "demo-reference")).ok, true);
        assert.equal((await verifyPaymentOnServer(method, "")).ok, false);
      }
    });
  }

  it("does not require prepayment for COD or a free checkout", async () => {
    assert.equal((await verifyPaymentOnServer("cod", "")).ok, true);
    assert.equal((await verifyPaymentOnServer("free", "")).ok, true);
    assert.equal((await verifyPaymentOnServer("unknown", "fake")).ok, false);
  });

  it("rejects partially configured M-Pesa and placeholder shortcodes", async () => {
    const configured = {
      MPESA_CONSUMER_KEY: "test-key", MPESA_CONSUMER_SECRET: "test-secret",
      MPESA_SHORTCODE: "174379", MPESA_PASSKEY: "test-passkey",
    };
    for (const missing of Object.keys(configured)) {
      Object.assign(process.env, configured);
      delete process.env[missing];
      assert.equal((await verifyPaymentOnServer("mpesa", "fake")).ok, false, missing);
    }
    Object.assign(process.env, configured, { MPESA_SHORTCODE: "NA" });
    assert.equal((await verifyPaymentOnServer("mpesa", "fake")).ok, false);
    assert.deepEqual(outbound, []);
  });

  for (const method of methods) {
    it(`blocks unauthenticated legacy ${method} orders without writing an order`, async () => {
      const reference = `security-${randomUUID()}`;
      const { fulfillment: _fulfillment, ...checkout } = paymentCheckoutFixture();
      const result = await request("/uc/orders", {
        ...checkout, paymentMethod: method, paymentReference: reference,
      });
      assert.equal(result.status, 503, JSON.stringify(result.body));
      assert.equal(result.body.error, "Payment not verified");
      assert.equal(result.body.retryable, true);
      const rows = await db.select({ id: ucOrdersTable.id }).from(ucOrdersTable)
        .where(eq(ucOrdersTable.paymentReference, reference));
      assert.equal(rows.length, 0);
      assert.deepEqual(outbound, []);
    });
  }

  for (const [method, path] of [
    ["paystack", "/payments/paystack/init"],
    ["stripe", "/payments/stripe/session"],
    ["mpesa", "/payments/mpesa"],
  ]) {
    it(`does not issue a mock ${method} checkout or reserve an order`, async () => {
      const checkout = paymentCheckoutFixture();
      const result = await request(path, { checkout, phone: "0712345678" });
      assert.equal(result.status, 503, JSON.stringify(result.body));
      assert.equal(result.body.retryable, true);
      assert.equal(result.body.reference, undefined);
      assert.equal(result.body.sessionId, undefined);
      assert.equal(result.body.checkoutRequestId, undefined);
      const rows = await db.select({ id: ucOrdersTable.id }).from(ucOrdersTable)
        .where(eq(ucOrdersTable.checkoutIdempotencyKey, checkout.idempotencyKey));
      assert.equal(rows.length, 0);
      assert.deepEqual(outbound, []);
    });
  }

  for (const path of [
    "/payments/paystack/verify/fake", "/payments/stripe/session/fake",
    "/payments/mpesa/status/fake",
  ]) {
    it(`does not report synthetic success at ${path}`, async () => {
      const result = await request(path);
      assert.equal(result.status, 503);
      assert.equal(result.body.retryable, true);
      assert.equal(result.body.success, undefined);
      assert.equal(result.body.paymentStatus, undefined);
      assert.equal(result.body.status, undefined);
      assert.deepEqual(outbound, []);
    });
  }

  it("advertises only configured providers in production; COD remains available", async () => {
    const disabled = await request("/payments/config");
    assert.deepEqual(disabled.body.methods, { paystack: false, stripe: false, mpesa: false, cod: true });
    assert.equal(disabled.body.mpesaMode, "demo");
    Object.assign(process.env, {
      PAYSTACK_SECRET_KEY: "test-key", STRIPE_SECRET_KEY: "test-key",
      MPESA_CONSUMER_KEY: "test-key", MPESA_CONSUMER_SECRET: "test-secret",
      MPESA_SHORTCODE: "174379", MPESA_PASSKEY: "test-passkey",
    });
    const enabled = await request("/payments/config");
    assert.deepEqual(enabled.body.methods, { paystack: true, stripe: true, mpesa: true, cod: true });
    assert.equal(enabled.body.mpesaMode, "live");
  });

  it("configured Paystack still requires the provider to confirm success", async () => {
    process.env.PAYSTACK_SECRET_KEY = "test-key";
    for (const status of ["failed", "success"]) {
      globalThis.fetch = async (input) => {
        assert.match(String(input), /^https:\/\/api\.paystack\.co\/transaction\/verify\//);
        return new Response(JSON.stringify({ status: true, data: { status, amount: 349900, currency: "KES" } }));
      };
      const result = await verifyPaymentOnServer("paystack", "provider-reference");
      assert.equal(result.ok, status === "success");
      if (result.ok) {
        assert.equal(result.amount, 3499);
        assert.equal(result.currency, "KES");
      }
    }
  });

  it("M-Pesa OAuth failure never falls back to a successful demo status, even in development", async () => {
    Object.assign(process.env, {
      MPESA_CONSUMER_KEY: "test-key", MPESA_CONSUMER_SECRET: "test-secret",
      MPESA_SHORTCODE: "174379", MPESA_PASSKEY: "test-passkey",
    });
    for (const env of ["production", "development"]) {
      process.env.NODE_ENV = env;
      globalThis.fetch = async (input) => {
        assert.match(String(input), /safaricom\.co\.ke\/oauth/);
        return new Response(JSON.stringify({ error: "invalid credentials" }), { status: 401 });
      };
      const result = await request("/payments/mpesa/status/fake");
      assert.equal(result.status, 503);
      assert.equal(result.body.status, undefined);
      assert.equal((await verifyPaymentOnServer("mpesa", "fake")).ok, false);
      const checkout = paymentCheckoutFixture();
      try {
        const initialized = await request("/payments/mpesa", { checkout, phone: "0712345678" });
        assert.equal(initialized.status, 503, JSON.stringify(initialized.body));
        assert.equal(initialized.body.checkoutRequestId, undefined);
        const rows = await db.select({ status: ucOrdersTable.status, paidAt: ucOrdersTable.paymentConfirmedAt })
          .from(ucOrdersTable).where(eq(ucOrdersTable.checkoutIdempotencyKey, checkout.idempotencyKey));
        for (const row of rows) {
          assert.notEqual(row.status, "processing");
          assert.equal(row.paidAt, null);
        }
      } finally {
        await db.delete(ucOrdersTable).where(eq(ucOrdersTable.checkoutIdempotencyKey, checkout.idempotencyKey));
      }
    }
  });
});
