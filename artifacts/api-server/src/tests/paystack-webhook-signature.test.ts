/**
 * Paystack webhook signature-guard tests — POST /api/payments/paystack/webhook
 *
 * Covers:
 *   1. Correct HMAC-SHA512 signature → accepted (200, received: true)
 *   2. Wrong signature → rejected (401)
 *   3. Missing x-paystack-signature header → rejected (401)
 *   4. PAYSTACK_WEBHOOK_REQUIRED_SIGNATURE=true without a key → hard-rejected (403)
 *
 * Strategy:
 *   – We use a non-"charge.success" event type in the accept test so the handler
 *     returns immediately after verifying the signature without hitting the DB.
 *   – PAYSTACK_SECRET_KEY is set / cleared per-test via process.env; the cache
 *     in payments.ts is for the M-Pesa secret, not the Paystack key, so no cache
 *     invalidation is required here.
 *   – The rawBody middleware in app.ts (express.raw for the webhook route) ensures
 *     req.rawBody is always populated, so we don't need to work around it.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";

import app from "../app.js";

// ── Shared state ──────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;

// Preserve env vars so each test can freely mutate and restore them.
let savedPaystackKey: string | undefined;
let savedRequiredSig: string | undefined;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * POST to the Paystack webhook endpoint.
 * `body` is sent as raw JSON bytes so the middleware captures it in req.rawBody.
 * `sig` is placed in x-paystack-signature (omit to test missing-header case).
 */
async function postWebhook(
  body: unknown,
  opts: { sig?: string; omitSigHeader?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const rawBytes = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!opts.omitSigHeader) {
    headers["x-paystack-signature"] = opts.sig ?? "";
  }
  const res = await fetch(`${base}/payments/paystack/webhook`, {
    method: "POST",
    headers,
    body: rawBytes,
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return { status: res.status, body: parsed };
}

/** Compute the correct HMAC-SHA512 hex signature for a given body and secret. */
function sign(body: unknown, secret: string): string {
  return createHmac("sha512", secret).update(JSON.stringify(body)).digest("hex");
}

/** A minimal non-charge.success event that passes the handler's event-type check early. */
const PING_EVENT = { event: "ping", data: {} };

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(
  async () => {
    // Ensure a minimal SESSION_SECRET is present (app may need it for JWT).
    process.env["SESSION_SECRET"] ??= "test-secret-ps-webhook-sig";

    await new Promise<void>((resolve, reject) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("Server did not bind to an address"));
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  // Snapshot env state before each test.
  savedPaystackKey = process.env["PAYSTACK_SECRET_KEY"];
  savedRequiredSig = process.env["PAYSTACK_WEBHOOK_REQUIRED_SIGNATURE"];
});

afterEach(() => {
  // Restore env state after each test.
  if (savedPaystackKey === undefined) {
    delete process.env["PAYSTACK_SECRET_KEY"];
  } else {
    process.env["PAYSTACK_SECRET_KEY"] = savedPaystackKey;
  }
  if (savedRequiredSig === undefined) {
    delete process.env["PAYSTACK_WEBHOOK_REQUIRED_SIGNATURE"];
  } else {
    process.env["PAYSTACK_WEBHOOK_REQUIRED_SIGNATURE"] = savedRequiredSig;
  }
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Paystack webhook — signature guard", () => {
  it("correct HMAC-SHA512 signature is accepted (200)", async () => {
    const secret = "ps_test_secret_correct";
    process.env["PAYSTACK_SECRET_KEY"] = secret;
    delete process.env["PAYSTACK_WEBHOOK_REQUIRED_SIGNATURE"];

    const sig = sign(PING_EVENT, secret);
    const res = await postWebhook(PING_EVENT, { sig });

    assert.equal(
      res.status,
      200,
      `expected 200 for a correctly-signed webhook; got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    // Handler acks unrecognised event types with received:true without hitting the DB.
    assert.equal(
      res.body["received"],
      true,
      `response body must include received:true; got: ${JSON.stringify(res.body)}`,
    );
  });

  it("wrong signature is rejected (401)", async () => {
    const secret = "ps_test_secret_for_wrong_sig";
    process.env["PAYSTACK_SECRET_KEY"] = secret;
    delete process.env["PAYSTACK_WEBHOOK_REQUIRED_SIGNATURE"];

    const wrongSig = "0".repeat(128); // 512-bit hex string, but computed with a different secret
    const res = await postWebhook(PING_EVENT, { sig: wrongSig });

    assert.equal(
      res.status,
      401,
      `expected 401 for a wrong signature; got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  it("missing x-paystack-signature header is rejected (401)", async () => {
    const secret = "ps_test_secret_for_missing_sig";
    process.env["PAYSTACK_SECRET_KEY"] = secret;
    delete process.env["PAYSTACK_WEBHOOK_REQUIRED_SIGNATURE"];

    // Omit the header entirely — handler receives an empty string which won't match.
    const res = await postWebhook(PING_EVENT, { omitSigHeader: true });

    assert.equal(
      res.status,
      401,
      `expected 401 when x-paystack-signature is absent; got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });

  it("PAYSTACK_WEBHOOK_REQUIRED_SIGNATURE=true without a key hard-rejects (403)", async () => {
    delete process.env["PAYSTACK_SECRET_KEY"];
    process.env["PAYSTACK_WEBHOOK_REQUIRED_SIGNATURE"] = "true";

    // No signature header needed — the guard fires before signature verification.
    const res = await postWebhook(PING_EVENT, { omitSigHeader: true });

    assert.equal(
      res.status,
      403,
      `expected 403 when strict mode is on but no secret is configured; got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  });
});
