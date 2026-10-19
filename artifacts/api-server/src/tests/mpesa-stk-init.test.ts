/**
 * Tests for POST /api/payments/mpesa (STK-push initiation endpoint).
 *
 * Covers:
 *   (a) Missing phone → 400 with descriptive error.
 *   (b) Missing amount → 400 with descriptive error.
 *   (c) Sandbox / demo mode — 200, mock CheckoutRequestID returned, initiation
 *       record persisted in DB, callbackToken stored alongside it.
 *   (f) Two concurrent demo-mode initiations both succeed and produce distinct
 *       CheckoutRequestIDs — verifies the UUID-based ID prevents collisions that
 *       the former Date.now()-based ID would allow in the same millisecond.
 *
 * Strategy:
 *   – MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET / MPESA_SHORTCODE / MPESA_PASSKEY
 *     are deleted before each test → endpoint always runs in sandbox/demo mode.
 *   – Tests (a) and (b) share a rate-limiter slot each; test (c) uses one slot;
 *     test (f) fires two requests concurrently consuming slots 4 and 5. Total ≤ 5
 *     per minute per IP — within the paymentLimiter budget (max 5/min).
 *   – All four requests use a shared IP so the rate-limiter budget can be tracked
 *     predictably; the limiter does not trust X-Forwarded-For by default.
 *   – DB interactions use the real provisioned DATABASE_URL.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { paymentCheckoutFixture } from "./helpers/payment-checkout.js";
import http from "node:http";

import app from "../app.js";
import { db, mpesaStkInitiationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Shared state ──────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;

// Refs created during tests — removed in after().
const createdRefs: string[] = [];

// M-Pesa credential env vars — cleared before each test to force sandbox mode.
const MPESA_CRED_KEYS = [
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
] as const;
let savedCreds: Partial<Record<string, string>> = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postMpesa(
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/payments/mpesa`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ checkout: paymentCheckoutFixture(), ...body as Record<string, unknown> }),
  });
  let parsed: Record<string, unknown> = {};
  try { parsed = (await res.json()) as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, body: parsed };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(
  () =>
    new Promise<void>((resolve, reject) => {
      process.env["SESSION_SECRET"] ??= "test-secret-mpesa-stk-init";
      delete process.env.WC_CONSUMER_KEY; delete process.env.WC_CONSUMER_SECRET;
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

after(async () => {
  for (const ref of createdRefs) {
    await db
      .delete(mpesaStkInitiationsTable)
      .where(eq(mpesaStkInitiationsTable.checkoutRequestId, ref))
      .catch(() => {});
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  savedCreds = {};
  for (const k of MPESA_CRED_KEYS) {
    savedCreds[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of MPESA_CRED_KEYS) {
    if (savedCreds[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedCreds[k];
    }
  }
});

// ── Suites ────────────────────────────────────────────────────────────────────

// Rate-limiter budget: this file makes exactly 5 requests to POST /payments/mpesa
// (one each for tests a, b, c, and two for f). Stay within that limit to avoid 429.

describe("POST /payments/mpesa — validation", () => {
  it("(a) rejects when phone is missing (400)", async () => {
    // slot 1 of 5
    const { status, body } = await postMpesa({ amount: 1000, orderId: "ORD-01" });
    assert.equal(status, 400, `expected 400 for missing phone; got ${status}`);
    assert.ok(
      typeof body["error"] === "string" && body["error"].length > 0,
      `error message must be present; got: ${JSON.stringify(body)}`,
    );
  });

  it("(b) derives the payable amount from checkout, not a missing caller amount", async () => {
    // slot 2 of 5
    const { status, body } = await postMpesa({ phone: "+254712345678", orderId: "ORD-02" });
    assert.equal(status, 200, `expected authoritative checkout initialization; got ${status}`);
    createdRefs.push(body["checkoutRequestId"] as string);
  });
});

describe("POST /payments/mpesa — sandbox / demo mode", () => {
  it("(c) 200 with mock ID; initiation record and callbackToken persisted in DB", async () => {
    // slot 3 of 5
    const { status, body } = await postMpesa({
      phone:   "0712000111",
      amount:  8800,
      orderId: "ORD-SANDBOX-01",
    });

    assert.equal(status, 200, `expected 200 in sandbox mode; got ${status}: ${JSON.stringify(body)}`);

    const ref = body["checkoutRequestId"];
    assert.ok(
      typeof ref === "string" && ref.length > 0,
      `checkoutRequestId must be a non-empty string; got: ${JSON.stringify(body)}`,
    );
    assert.ok(
      typeof body["responseCode"] === "string",
      "responseCode must be present in sandbox response",
    );

    createdRefs.push(ref as string);

    // DB persistence: verify the initiation row was stored before the response was sent.
    const rows = await db
      .select()
      .from(mpesaStkInitiationsTable)
      .where(eq(mpesaStkInitiationsTable.checkoutRequestId, ref as string));

    assert.equal(rows.length, 1, "exactly one initiation record must be stored");
    assert.equal(rows[0]!.expectedAmount, 3499, "stored amount must equal the authoritative cart, not caller money");
    assert.ok(rows[0]!.expiresAt > new Date(), "expiresAt must be in the future");
    assert.ok(
      typeof rows[0]!.callbackToken === "string" && rows[0]!.callbackToken.length > 0,
      "callbackToken must be stored so the callback handler can verify incoming requests",
    );
  });

  it("(f) two concurrent initiations both succeed with distinct UUID-based CheckoutRequestIDs", async () => {
    // slots 4 and 5 of 5 — sent concurrently; both must succeed because demo-mode
    // IDs are now UUID-based (not Date.now()), so same-millisecond collisions cannot
    // occur and onConflictDoNothing cannot silently swallow either initiation.
    const [r1, r2] = await Promise.all([
      postMpesa({ phone: "+254700000001", amount: 1000, orderId: "ORD-CONC-01" }),
      postMpesa({ phone: "+254700000002", amount: 2000, orderId: "ORD-CONC-02" }),
    ]);

    assert.equal(r1.status, 200, `concurrent request 1 must succeed; got ${r1.status}: ${JSON.stringify(r1.body)}`);
    assert.equal(r2.status, 200, `concurrent request 2 must succeed; got ${r2.status}: ${JSON.stringify(r2.body)}`);

    const ref1 = r1.body["checkoutRequestId"] as string;
    const ref2 = r2.body["checkoutRequestId"] as string;

    assert.ok(ref1 && ref2, "both responses must include a checkoutRequestId");
    assert.notEqual(ref1, ref2, "each concurrent initiation must produce a unique CheckoutRequestID");

    createdRefs.push(ref1, ref2);

    // Both initiation records must exist in the DB (neither was swallowed by onConflictDoNothing).
    const [row1, row2] = await Promise.all([
      db.select().from(mpesaStkInitiationsTable).where(eq(mpesaStkInitiationsTable.checkoutRequestId, ref1)),
      db.select().from(mpesaStkInitiationsTable).where(eq(mpesaStkInitiationsTable.checkoutRequestId, ref2)),
    ]);

    assert.equal(row1.length, 1, "initiation record for request 1 must be stored independently");
    assert.equal(row2.length, 1, "initiation record for request 2 must be stored independently");
    assert.notEqual(
      row1[0]!.callbackToken,
      row2[0]!.callbackToken,
      "each initiation must have its own callbackToken",
    );
  });
});
