/**
 * Tests for GET /api/payments/config
 *
 * Covers:
 *   (a) Happy path — returns all four method keys.
 *   (b) mpesaMode is "live" when MPESA_SHORTCODE (numeric) + MPESA_PASSKEY are set.
 *   (c) mpesaMode is "demo" when MPESA_SHORTCODE is absent.
 *   (d) mpesaMode is "demo" when MPESA_SHORTCODE is a non-numeric placeholder ("NA").
 *   (e) stripe method is false when STRIPE_ENABLED=false.
 *   (f) stripe method is false when STRIPE_SECRET_KEY is absent (even if STRIPE_ENABLED
 *       is not "false").
 *   (g) paystack and cod are always true regardless of env vars.
 *
 * No DB interaction — the endpoint reads only environment variables.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import app from "../app.js";

// ── Shared state ──────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;

// Env vars we may mutate — snapshot before each test, restore after.
const ENV_KEYS = [
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "STRIPE_ENABLED",
  "STRIPE_SECRET_KEY",
] as const;
let savedEnv: Partial<Record<string, string>> = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getConfig(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/payments/config`);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(
  () =>
    new Promise<void>((resolve, reject) => {
      process.env["SESSION_SECRET"] ??= "test-secret-payments-config";
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("Server did not bind"));
          return;
        }
        base = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    }),
  { timeout: 30_000 },
);

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
  }
  process.env["MPESA_CONSUMER_KEY"] = "config-test-key";
  process.env["MPESA_CONSUMER_SECRET"] = "config-test-secret";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
});

// ── Suites ────────────────────────────────────────────────────────────────────

describe("GET /payments/config — shape", () => {
  it("returns HTTP 200 with all four method keys", async () => {
    const { status, body } = await getConfig();
    assert.equal(status, 200, `expected 200; got ${status}`);

    const methods = body["methods"] as Record<string, unknown>;
    assert.ok(typeof methods === "object" && methods !== null, "body.methods must be an object");

    for (const key of ["paystack", "mpesa", "stripe", "cod"] as const) {
      assert.ok(key in methods, `methods.${key} must be present`);
      assert.ok(
        typeof methods[key] === "boolean",
        `methods.${key} must be a boolean; got ${typeof methods[key]}`,
      );
    }

    assert.ok("mpesaMode" in body, "body.mpesaMode must be present");
    assert.ok(
      body["mpesaMode"] === "live" || body["mpesaMode"] === "demo",
      `mpesaMode must be "live" or "demo"; got ${body["mpesaMode"]}`,
    );
  });
});

describe("GET /payments/config — mpesaMode", () => {
  it('"live" when a numeric MPESA_SHORTCODE and MPESA_PASSKEY are both set', async () => {
    process.env["MPESA_SHORTCODE"] = "174379";
    process.env["MPESA_PASSKEY"]   = "any_passkey_value";

    const { body } = await getConfig();
    assert.equal(body["mpesaMode"], "live", `expected "live"; got ${body["mpesaMode"]}`);
  });

  it('"demo" when MPESA_SHORTCODE is absent', async () => {
    delete process.env["MPESA_SHORTCODE"];
    delete process.env["MPESA_PASSKEY"];

    const { body } = await getConfig();
    assert.equal(body["mpesaMode"], "demo", `expected "demo"; got ${body["mpesaMode"]}`);
  });

  it('"demo" when MPESA_SHORTCODE is a non-numeric placeholder ("NA")', async () => {
    process.env["MPESA_SHORTCODE"] = "NA";
    process.env["MPESA_PASSKEY"]   = "any_passkey_value";

    const { body } = await getConfig();
    assert.equal(
      body["mpesaMode"],
      "demo",
      `non-numeric shortcode "NA" must produce "demo"; got ${body["mpesaMode"]}`,
    );
  });

  it('"demo" when MPESA_PASSKEY is absent (shortcode alone is not enough)', async () => {
    process.env["MPESA_SHORTCODE"] = "174379";
    delete process.env["MPESA_PASSKEY"];

    const { body } = await getConfig();
    assert.equal(
      body["mpesaMode"],
      "demo",
      `missing passkey must produce "demo" even with a valid shortcode; got ${body["mpesaMode"]}`,
    );
  });
});

describe("GET /payments/config — stripe flag", () => {
  it("stripe is false when STRIPE_ENABLED=false", async () => {
    process.env["STRIPE_ENABLED"]    = "false";
    process.env["STRIPE_SECRET_KEY"] = "sk_test_example";

    const { body } = await getConfig();
    const methods = body["methods"] as Record<string, boolean>;
    assert.equal(
      methods["stripe"],
      false,
      `stripe must be false when STRIPE_ENABLED=false; got ${methods["stripe"]}`,
    );
  });

  it("stripe is false when STRIPE_SECRET_KEY is absent", async () => {
    delete process.env["STRIPE_ENABLED"];
    delete process.env["STRIPE_SECRET_KEY"];

    const { body } = await getConfig();
    const methods = body["methods"] as Record<string, boolean>;
    assert.equal(
      methods["stripe"],
      false,
      `stripe must be false when no secret key is configured; got ${methods["stripe"]}`,
    );
  });
});

describe("GET /payments/config — always-on methods", () => {
  it("paystack and cod are true regardless of env vars", async () => {
    // Clear everything that could affect them (there is nothing, but be explicit).
    delete process.env["STRIPE_ENABLED"];
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["MPESA_SHORTCODE"];

    const { body } = await getConfig();
    const methods = body["methods"] as Record<string, boolean>;
    assert.equal(methods["paystack"], true, "paystack must always be true");
    assert.equal(methods["cod"],      true, "cod must always be true");
    assert.equal(methods["mpesa"],    true, "mpesa must always be true (demo mode exists)");
  });
});
