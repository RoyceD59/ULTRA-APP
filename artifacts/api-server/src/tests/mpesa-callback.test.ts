/**
 * Tests for the M-Pesa STK-push callback handler.
 *
 * Covers:
 *   (a) Non-zero ResultCode → acked without any DB action.
 *   (b) Missing CheckoutRequestID → acked without any DB action.
 *   (c) Daraja rejects (non-0 from query API) → acked without any DB action.
 *   (d) Unknown CheckoutRequestID (no initiation record) → rejected even when
 *       Daraja confirms payment.  This is the critical anti-fraud test: a valid
 *       payment to our shortcode that we did not initiate cannot trigger an order.
 *   (e) Expired initiation record → rejected.
 *   (f) Daraja unavailable + initiation present → order stored as "pending"
 *       (NOT "processing"); proves an unverifiable callback cannot produce
 *       a fulfillment-ready record even when the push is ours.
 *   (g) Daraja unavailable + no initiation → rejected.
 *   (h) Daraja confirms + initiation present, no existing order → "processing" recovery.
 *   (i) Daraja confirms + initiation present, duplicate concurrent callbacks →
 *       exactly one recovery order (Promise.all concurrency).
 *   (j) Existing pending order advanced atomically (two concurrent → advance once).
 *   (k) Already-processing order with duplicate callback → safe no-op.
 *   (l) Malformed / empty body → acked gracefully.
 *
 * The Daraja token and query endpoints are stubbed via globalThis.fetch.
 * DB interactions use the real provisioned DATABASE_URL (same as other API tests).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { db, ucOrdersTable, mpesaStkInitiationsTable } from "@workspace/db";
import { invalidateMpesaSecretCache } from "../routes/payments.js";
import { eq } from "drizzle-orm";

// ── Shared state ──────────────────────────────────────────────────────────────
let realFetch: typeof globalThis.fetch;
let server: http.Server;
let savedWebhookSecret: string | undefined;   // cleared in before(), restored in after()

// Unique prefix so parallel/repeated test runs don't collide on payment refs.
const TEST_PREFIX = `CB_${Date.now()}`;
let seq = 0;
const nextRef = () => `${TEST_PREFIX}_${++seq}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postCallback(
  body: unknown,
  srv: http.Server = server,
  opts: { headers?: Record<string, string>; urlSuffix?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = srv.address() as { port: number };
  const url  = `http://localhost:${addr.port}/api/payments/mpesa/callback${opts.urlSuffix ?? ""}`;
  const res  = await realFetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body:    JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try { parsed = (await res.json()) as Record<string, unknown>; } catch { /* leave empty */ }
  return { status: res.status, body: parsed };
}

function stkPayload(
  checkoutRequestId: string,
  resultCode = 0,
  amount    = 5000,
  phone     = "254712345678",
  receipt   = "LGR7TEST001",
): unknown {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: `MR-${checkoutRequestId}`,
        CheckoutRequestID: checkoutRequestId,
        ResultCode:        resultCode,
        ResultDesc:        resultCode === 0
          ? "The service request is processed successfully."
          : "Request cancelled by user",
        ...(resultCode === 0
          ? {
              CallbackMetadata: {
                Item: [
                  { Name: "Amount",             Value: amount },
                  { Name: "MpesaReceiptNumber", Value: receipt },
                  { Name: "Balance" },
                  { Name: "TransactionDate",    Value: 20260811120000 },
                  { Name: "PhoneNumber",        Value: Number(phone) },
                ],
              },
            }
          : {}),
      },
    },
  };
}

/**
 * Stubs globalThis.fetch for Daraja endpoints.
 * @param queryResultCode  "0" = confirmed, any other string = rejected,
 *                         null = throw ECONNREFUSED (Daraja unavailable)
 * Returns a restore function.
 */
function stubDaraja(queryResultCode: string | null): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url: unknown, _init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/oauth/v1/generate")) {
      if (queryResultCode === null) throw new Error("ECONNREFUSED (stub token)");
      return new Response(JSON.stringify({ access_token: "stub_token" }), { status: 200 });
    }
    if (u.includes("/stkpushquery")) {
      if (queryResultCode === null) throw new Error("ECONNREFUSED (stub query)");
      const body = queryResultCode === "0"
        ? { ResultCode: "0", ResultDesc: "The service request is processed successfully." }
        : { errorCode: "404.001.04", errorMessage: "Transaction not found" };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    // Resend or any other HTTP call — accept silently
    return new Response(JSON.stringify({ id: "stub_resend" }), { status: 200 });
  };
  return () => { globalThis.fetch = orig; };
}

/** Insert a valid initiation record for a given ref. */
async function insertInitiation(
  checkoutRequestId: string,
  expectedAmount = 5000,
  phone = "254712345678",
  expiresInMs = 15 * 60 * 1000,
): Promise<void> {
  await db.insert(mpesaStkInitiationsTable).values({
    checkoutRequestId,
    expectedAmount,
    phone,
    expiresAt: new Date(Date.now() + expiresInMs),
  }).onConflictDoNothing();
}

/** Remove test rows by prefix so tests are idempotent on re-runs. */
async function cleanTestRows(): Promise<void> {
  const orderRows = await db
    .select({ id: ucOrdersTable.id, ref: ucOrdersTable.paymentReference })
    .from(ucOrdersTable);
  for (const r of orderRows.filter((x) => x.ref?.startsWith(TEST_PREFIX))) {
    await db.delete(ucOrdersTable).where(eq(ucOrdersTable.id, r.id));
  }
  const initiationRows = await db
    .select({ id: mpesaStkInitiationsTable.id, ref: mpesaStkInitiationsTable.checkoutRequestId })
    .from(mpesaStkInitiationsTable);
  for (const r of initiationRows.filter((x) => x.ref.startsWith(TEST_PREFIX))) {
    await db.delete(mpesaStkInitiationsTable).where(eq(mpesaStkInitiationsTable.id, r.id));
  }
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

before(async () => {
  realFetch = globalThis.fetch;

  // Clear MPESA_WEBHOOK_SECRET for the main test suite so the bulk of tests
  // run without the bearer-token guard.  The token-specific describe blocks
  // set and restore the value themselves around each test.
  savedWebhookSecret = process.env["MPESA_WEBHOOK_SECRET"];
  delete process.env["MPESA_WEBHOOK_SECRET"];
  invalidateMpesaSecretCache();

  // Fake Daraja credentials activate the verification branch.
  process.env["MPESA_SHORTCODE"]       ??= "174379";
  process.env["MPESA_PASSKEY"]         ??= "test_passkey";
  process.env["MPESA_CONSUMER_KEY"]    ??= "test_key";
  process.env["MPESA_CONSUMER_SECRET"] ??= "test_secret";
  process.env["SESSION_SECRET"]        ??= "test-secret-mpesa-callback";
  process.env["RESEND_BASE_URL"]       ??= "https://api.resend.com";
  process.env["RESEND_API_KEY"]        ??= "re_test_key";

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) =>
      err ? reject(err) : resolve(),
    );
  });
});

after(async () => {
  await cleanTestRows().catch(() => {});
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  globalThis.fetch = realFetch;
  // Restore webhook secret to whatever it was before the suite ran.
  if (savedWebhookSecret !== undefined) process.env["MPESA_WEBHOOK_SECRET"] = savedWebhookSecret;
  else delete process.env["MPESA_WEBHOOK_SECRET"];
  invalidateMpesaSecretCache();
});

// ── (a) Non-zero ResultCode → no DB action ───────────────────────────────────

describe("M-Pesa callback — non-zero ResultCode", () => {
  it("acks without orderId and creates no DB row", async () => {
    const restore = stubDaraja("0");
    try {
      const ref = nextRef();
      const { status, body } = await postCallback(stkPayload(ref, 1032));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0, "Safaricom always receives ResultCode 0");
      assert.ok(!("orderId"   in body), "no orderId for a failed payment");
      assert.ok(!("recovered" in body), "no recovered flag");

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 0, "no DB row for a failed payment");
    } finally { restore(); }
  });
});

// ── (b) Missing CheckoutRequestID → no DB action ─────────────────────────────

describe("M-Pesa callback — missing CheckoutRequestID", () => {
  it("acks gracefully when CheckoutRequestID is absent", async () => {
    const restore = stubDaraja("0");
    try {
      const { status, body } = await postCallback({
        Body: { stkCallback: { ResultCode: 0, ResultDesc: "Success" } },
      });
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0);
      assert.ok(!("orderId" in body), "no orderId without a checkout reference");
    } finally { restore(); }
  });
});

// ── (c) Daraja rejects → no DB action ───────────────────────────────────────

describe("M-Pesa callback — Daraja verification rejects (forged/replayed callback)", () => {
  it("acks but creates no DB row when Daraja returns a non-0 ResultCode", async () => {
    const restore = stubDaraja("1032");   // rejected / unknown reference
    try {
      const ref = nextRef();
      await insertInitiation(ref);  // initiation exists but Daraja still rejects
      const { status, body } = await postCallback(stkPayload(ref));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0, "Safaricom always receives ResultCode 0");
      assert.ok(!("orderId"   in body), "no orderId — Daraja rejected");
      assert.ok(!("recovered" in body), "no recovered flag");

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 0, "a Daraja-rejected callback must not create any DB row");
    } finally { restore(); }
  });
});

// ── (d) Unknown CheckoutRequestID (no initiation record) → rejected ──────────
// Critical anti-fraud: a valid payment to our shortcode that we did not
// initiate must never create or advance an order in our system.

describe("M-Pesa callback — unknown CheckoutRequestID (no initiation record)", () => {
  it("rejects recovery creation even when Daraja confirms — no initiation record", async () => {
    const restore = stubDaraja("0");  // Daraja says payment is real
    try {
      const ref = nextRef();
      // NO initiation record inserted — simulates a CheckoutRequestID we never sent

      const { status, body } = await postCallback(stkPayload(ref, 0, 9999, "254799999999", "FOREIGN_01"));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0, "always ack Safaricom");
      assert.ok(!("orderId"   in body), "no orderId — no initiation record");
      assert.ok(!("recovered" in body), "no recovered flag");
      assert.ok(!("unverified" in body), "no unverified flag");

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(
        rows.length, 0,
        "a CheckoutRequestID with no initiation record must NEVER create an order, even if Daraja confirms it — this prevents an attacker with a foreign payment reference from triggering fulfilment",
      );
    } finally { restore(); }
  });
});

// ── (e) Expired initiation record → rejected ─────────────────────────────────

describe("M-Pesa callback — expired initiation record", () => {
  it("rejects a callback when the initiation has expired (replay protection)", async () => {
    const restore = stubDaraja("0");
    try {
      const ref = nextRef();
      // Insert with expiresAt in the past
      await insertInitiation(ref, 5000, "254712345678", -1000); // expired 1 second ago

      const { status, body } = await postCallback(stkPayload(ref));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0);
      assert.ok(!("orderId" in body), "no orderId for an expired initiation");

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 0, "expired initiation must not create an order");
    } finally { restore(); }
  });
});

// ── (f) Daraja unavailable + initiation present → "pending" (not "processing") ─
// Key invariant: unverifiable callback cannot produce a fulfillment-ready order.

describe("M-Pesa callback — Daraja unavailable, initiation present", () => {
  it("stores order as 'pending' (NOT 'processing') when Daraja is unreachable", async () => {
    const restore = stubDaraja(null);   // token + query both throw ECONNREFUSED
    const ref = nextRef();
    await insertInitiation(ref, 3500, "254712000001");
    try {
      const { status, body } = await postCallback(stkPayload(ref, 0, 9999, "254799000000", "TAMPERED"));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0);

      assert.ok("orderId"   in body, "orderId must be present so the record is traceable");
      assert.equal(body["unverified"], true, "unverified flag must be set");

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 1, "exactly one unverified order should be created");
      assert.equal(
        rows[0]!.status,
        "pending",
        "status must be 'pending' — NOT 'processing' — an unverifiable callback must not produce a fulfillment-ready record",
      );
      assert.equal(rows[0]!.webhookRecovery, true);
      // Amount must come from our initiation record, not the tampered callback
      assert.equal(rows[0]!.total, "3500", "total must use our stored initiation amount, not callback amount");
    } finally { restore(); }
  });

  it("leaves an existing pending order unchanged when Daraja is unreachable", async () => {
    const restore = stubDaraja(null);
    const ref = nextRef();
    await insertInitiation(ref, 5000, "254712000002");

    const [inserted] = await db
      .insert(ucOrdersTable)
      .values({
        userId:           "cust@example.com",
        status:           "pending",
        total:            "5000",
        currency:         "KES",
        paymentMethod:    "mpesa",
        paymentReference: ref,
        promoCode:        "",
        discountPercent:  0,
        discountAmount:   0,
        shippingAddress:  {},
      })
      .returning();

    try {
      const { status, body } = await postCallback(stkPayload(ref));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0);
      assert.equal(body["orderId"], inserted!.id);
      assert.equal(body["unverified"], true);

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows[0]!.status, "pending", "existing pending order must NOT be advanced without Daraja confirmation");
    } finally { restore(); }
  });
});

// ── (g) Daraja unavailable + no initiation → rejected ────────────────────────

describe("M-Pesa callback — Daraja unavailable, no initiation record", () => {
  it("rejects recovery creation when both Daraja and initiation record are absent", async () => {
    const restore = stubDaraja(null);  // Daraja unavailable
    const ref = nextRef();
    // No initiation record — we never initiated this push
    try {
      const { status, body } = await postCallback(stkPayload(ref));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0);
      assert.ok(!("orderId" in body), "no orderId — neither Daraja nor initiation can confirm ownership");

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 0, "no order must be created when neither Daraja nor initiation record confirms the push is ours");
    } finally { restore(); }
  });
});

// ── (h) Daraja confirms + initiation → "processing" recovery ─────────────────

describe("M-Pesa callback — Daraja confirms, initiation present, no existing order", () => {
  it("creates a 'processing' recovery using initiation amount (not callback amount)", async () => {
    const restore = stubDaraja("0");
    const ref = nextRef();
    // Initiation says 7500; callback claims 9999 (tampered)
    await insertInitiation(ref, 7500, "254722000002");
    try {
      const { status, body } = await postCallback(stkPayload(ref, 0, 9999, "254722000002", "LTEST004"));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0);
      assert.ok(typeof body["orderId"] === "number", "orderId must be a number");
      assert.equal(body["recovered"], true);
      assert.ok(!("unverified" in body), "no unverified flag when Daraja confirmed");

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 1, "exactly one recovery order");
      assert.equal(rows[0]!.status,          "processing", "Daraja-confirmed recovery must be 'processing'");
      assert.equal(rows[0]!.paymentMethod,   "mpesa");
      assert.equal(rows[0]!.total,           "7500",        "must use initiation amount (7500), not tampered callback amount (9999)");
      assert.equal(rows[0]!.webhookRecovery, true);
    } finally { restore(); }
  });
});

// ── (i) Concurrent confirmed callbacks → only one recovery order ──────────────

describe("M-Pesa callback — concurrent duplicate confirmed callbacks", () => {
  it("two simultaneous callbacks create exactly one recovery order", async () => {
    const restore = stubDaraja("0");
    const ref = nextRef();
    await insertInitiation(ref, 4200, "254733000003");
    try {
      const [first, second] = await Promise.all([
        postCallback(stkPayload(ref, 0, 4200, "254733000003", "LTEST005")),
        postCallback(stkPayload(ref, 0, 4200, "254733000003", "LTEST005")),
      ]);
      assert.equal(first.status,  200, "first callback must ack");
      assert.equal(second.status, 200, "second callback must ack");
      assert.equal(first.body["ResultCode"],  0);
      assert.equal(second.body["ResultCode"], 0);

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 1, "concurrent callbacks must not create duplicate recovery orders");
      assert.equal(rows[0]!.status, "processing");
    } finally { restore(); }
  });
});

// ── (j) Existing pending order advanced atomically ────────────────────────────

describe("M-Pesa callback — existing pending order (app closed during wait)", () => {
  it("advances pending → processing when Daraja confirms", async () => {
    const restore = stubDaraja("0");
    const ref = nextRef();
    await insertInitiation(ref, 9900, "254712345679");

    const [inserted] = await db
      .insert(ucOrdersTable)
      .values({
        userId:           "amina@example.com",
        status:           "pending",
        total:            "9900",
        currency:         "KES",
        paymentMethod:    "mpesa",
        paymentReference: ref,
        promoCode:        "",
        discountPercent:  0,
        discountAmount:   0,
        shippingAddress:  { firstName: "Amina", city: "Nairobi" },
      })
      .returning();

    try {
      const { status, body } = await postCallback(stkPayload(ref, 0, 9900, "254712345679", "LTEST006"));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0);
      assert.equal(body["orderId"], inserted!.id, "orderId must match the existing order");
      assert.ok(!("recovered" in body) || body["recovered"] !== true, "not a new recovery order");

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 1, "only one order row");
      assert.equal(rows[0]!.status, "processing", "pending order must be advanced to processing");
    } finally { restore(); }
  });

  it("two simultaneous callbacks on the same pending order advance it exactly once", async () => {
    const restore = stubDaraja("0");
    const ref = nextRef();
    await insertInitiation(ref, 6600, "254700000010");

    const [inserted] = await db
      .insert(ucOrdersTable)
      .values({
        userId:           "concurrent@example.com",
        status:           "pending",
        total:            "6600",
        currency:         "KES",
        paymentMethod:    "mpesa",
        paymentReference: ref,
        promoCode:        "",
        discountPercent:  0,
        discountAmount:   0,
        shippingAddress:  {},
      })
      .returning();

    try {
      const [first, second] = await Promise.all([
        postCallback(stkPayload(ref, 0, 6600, "254700000010", "LTEST007")),
        postCallback(stkPayload(ref, 0, 6600, "254700000010", "LTEST007")),
      ]);
      assert.equal(first.status,  200);
      assert.equal(second.status, 200);
      assert.equal(first.body["orderId"],  inserted!.id);
      assert.equal(second.body["orderId"], inserted!.id);

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 1, "one order, not two");
      assert.equal(rows[0]!.status, "processing", "must have been advanced");
    } finally { restore(); }
  });
});

// ── (k) Already-processing order → safe no-op ────────────────────────────────

describe("M-Pesa callback — already-processing order (duplicate)", () => {
  it("duplicate callback on a processing order is a no-op", async () => {
    const restore = stubDaraja("0");
    const ref = nextRef();
    await insertInitiation(ref, 3300, "254722000004");

    const [inserted] = await db
      .insert(ucOrdersTable)
      .values({
        userId:           "customer2@example.com",
        status:           "processing",
        total:            "3300",
        currency:         "KES",
        paymentMethod:    "mpesa",
        paymentReference: ref,
        promoCode:        "",
        discountPercent:  0,
        discountAmount:   0,
        shippingAddress:  {},
      })
      .returning();

    try {
      const { status, body } = await postCallback(stkPayload(ref, 0, 3300, "254722000004", "LTEST008"));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0);
      assert.equal(body["orderId"], inserted!.id);

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows[0]!.status, "processing", "already-processing order stays processing");
    } finally { restore(); }
  });
});

// ── (l) Malformed / empty body → acked gracefully ────────────────────────────

describe("M-Pesa callback — malformed body", () => {
  it("acks gracefully when Body.stkCallback is absent", async () => {
    const { status, body } = await postCallback({});
    assert.equal(status, 200);
    assert.equal(body["ResultCode"], 0);
  });
});

// ── Bearer-token guard tests ──────────────────────────────────────────────────
// These tests exercise the MPESA_WEBHOOK_SECRET verification added to the
// callback handler.  Each test sets / clears the env var around a single
// request and restores it afterwards so other tests are not affected.

describe("M-Pesa callback — bearer-token guard: correct token via query param", () => {
  it("accepts a request whose ?token= matches MPESA_WEBHOOK_SECRET", async () => {
    const restore = stubDaraja(null); // Daraja unavailable — we only care about the guard
    const savedSecret = process.env["MPESA_WEBHOOK_SECRET"];
    process.env["MPESA_WEBHOOK_SECRET"] = "test-webhook-secret-abc123";
    invalidateMpesaSecretCache();
    try {
      // Send a minimal body; Daraja unavailable + no initiation → no order created.
      // The guard must not reject the request (status must not be 401/403).
      const { status, body } = await postCallback(
        {},
        server,
        { urlSuffix: "?token=test-webhook-secret-abc123" },
      );
      assert.notEqual(status, 401, "correct token must not trigger 401");
      assert.notEqual(status, 403, "correct token must not trigger 403");
      // Malformed body → acks with ResultCode 0 (guard passed, body handler took over)
      assert.equal(body["ResultCode"], 0, "guard passed — handler returned its normal ack");
    } finally {
      if (savedSecret !== undefined) process.env["MPESA_WEBHOOK_SECRET"] = savedSecret;
      else delete process.env["MPESA_WEBHOOK_SECRET"];
      invalidateMpesaSecretCache();
      restore();
    }
  });
});

describe("M-Pesa callback — bearer-token guard: correct token via Authorization header", () => {
  it("accepts a request whose Authorization: Bearer matches MPESA_WEBHOOK_SECRET", async () => {
    const restore = stubDaraja(null);
    const savedSecret = process.env["MPESA_WEBHOOK_SECRET"];
    process.env["MPESA_WEBHOOK_SECRET"] = "test-webhook-secret-abc123";
    invalidateMpesaSecretCache();
    try {
      const { status, body } = await postCallback(
        {},
        server,
        { headers: { Authorization: "Bearer test-webhook-secret-abc123" } },
      );
      assert.notEqual(status, 401, "correct header token must not trigger 401");
      assert.notEqual(status, 403, "correct header token must not trigger 403");
      assert.equal(body["ResultCode"], 0, "guard passed");
    } finally {
      if (savedSecret !== undefined) process.env["MPESA_WEBHOOK_SECRET"] = savedSecret;
      else delete process.env["MPESA_WEBHOOK_SECRET"];
      invalidateMpesaSecretCache();
      restore();
    }
  });
});

describe("M-Pesa callback — bearer-token guard: wrong token", () => {
  it("rejects a request whose token does not match MPESA_WEBHOOK_SECRET with 401", async () => {
    const savedSecret = process.env["MPESA_WEBHOOK_SECRET"];
    process.env["MPESA_WEBHOOK_SECRET"] = "correct-secret";
    invalidateMpesaSecretCache();
    try {
      const { status } = await postCallback(
        {},
        server,
        { urlSuffix: "?token=wrong-secret" },
      );
      assert.equal(status, 401, "wrong token must be rejected with 401");
    } finally {
      if (savedSecret !== undefined) process.env["MPESA_WEBHOOK_SECRET"] = savedSecret;
      else delete process.env["MPESA_WEBHOOK_SECRET"];
      invalidateMpesaSecretCache();
    }
  });
});

describe("M-Pesa callback — bearer-token guard: missing token when secret is configured", () => {
  it("rejects a request with no token at all when MPESA_WEBHOOK_SECRET is set", async () => {
    const savedSecret = process.env["MPESA_WEBHOOK_SECRET"];
    process.env["MPESA_WEBHOOK_SECRET"] = "correct-secret";
    invalidateMpesaSecretCache();
    try {
      // No ?token= and no Authorization header
      const { status } = await postCallback({}, server);
      assert.equal(status, 401, "missing token must be rejected with 401 when a secret is configured");
    } finally {
      if (savedSecret !== undefined) process.env["MPESA_WEBHOOK_SECRET"] = savedSecret;
      else delete process.env["MPESA_WEBHOOK_SECRET"];
      invalidateMpesaSecretCache();
    }
  });
});

describe("M-Pesa callback — bearer-token guard: MPESA_WEBHOOK_REQUIRED_SIGNATURE=true without secret", () => {
  it("rejects with 403 when required-signature flag is set but no secret is configured", async () => {
    const savedSecret = process.env["MPESA_WEBHOOK_SECRET"];
    const savedRequired = process.env["MPESA_WEBHOOK_REQUIRED_SIGNATURE"];
    delete process.env["MPESA_WEBHOOK_SECRET"];
    invalidateMpesaSecretCache();
    process.env["MPESA_WEBHOOK_REQUIRED_SIGNATURE"] = "true";
    try {
      const { status, body } = await postCallback({}, server);
      assert.equal(status, 403, "must hard-reject when MPESA_WEBHOOK_REQUIRED_SIGNATURE=true and no secret");
      assert.ok(typeof body["error"] === "string", "error field must be present");
    } finally {
      if (savedSecret !== undefined) process.env["MPESA_WEBHOOK_SECRET"] = savedSecret;
      else delete process.env["MPESA_WEBHOOK_SECRET"];
      invalidateMpesaSecretCache();
      if (savedRequired !== undefined) process.env["MPESA_WEBHOOK_REQUIRED_SIGNATURE"] = savedRequired;
      else delete process.env["MPESA_WEBHOOK_REQUIRED_SIGNATURE"];
    }
  });
});

// ── CallBackURL token embedding test ─────────────────────────────────────────
// When MPESA_WEBHOOK_SECRET is set, the outgoing STK push must include the
// secret as ?token= in the CallBackURL so Safaricom echoes it back and the
// callback handler can verify it.

describe("M-Pesa initiation — CallBackURL token embedding", () => {
  it("includes ?token=<MPESA_WEBHOOK_SECRET> in the CallBackURL sent to Daraja", async () => {
    const savedSecret  = process.env["MPESA_WEBHOOK_SECRET"];
    const savedKey     = process.env["MPESA_CONSUMER_KEY"];
    const savedSec     = process.env["MPESA_CONSUMER_SECRET"];
    const savedShort   = process.env["MPESA_SHORTCODE"];
    const savedPass    = process.env["MPESA_PASSKEY"];

    const testSecret = "url-token-embed-test-secret-xyz";
    process.env["MPESA_WEBHOOK_SECRET"]   = testSecret;
    process.env["MPESA_CONSUMER_KEY"]     = "test_key";
    process.env["MPESA_CONSUMER_SECRET"]  = "test_secret";
    process.env["MPESA_SHORTCODE"]        = "174379";
    process.env["MPESA_PASSKEY"]          = "test_passkey";

    let capturedCallbackUrl: string | undefined;

    // Stub fetch to capture the STK push body sent to Daraja
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/oauth/v1/generate")) {
        return new Response(JSON.stringify({ access_token: "stub_token" }), { status: 200 });
      }
      if (u.includes("/stkpush/v1/processrequest")) {
        // Capture the CallBackURL from the body Daraja would receive
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
        capturedCallbackUrl = body["CallBackURL"];
        // Return a successful Daraja response
        return new Response(JSON.stringify({
          MerchantRequestID: "MR-TEST",
          CheckoutRequestID: `CB_TOKEN_TEST_${Date.now()}`,
          ResponseCode: "0",
          ResponseDescription: "Success",
          CustomerMessage: "Please check your phone",
        }), { status: 200 });
      }
      // DB migrations / other calls
      return origFetch(String(url), init);
    };

    try {
      const addr = (server.address() as { port: number });
      const res = await realFetch(
        `http://localhost:${addr.port}/api/payments/mpesa`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ phone: "0712345678", amount: 1000, orderId: "TOKEN-URL-TEST" }),
        },
      );
      assert.equal(res.status, 200, "STK push endpoint must return 200");

      assert.ok(
        capturedCallbackUrl !== undefined,
        "CallBackURL must have been captured from the Daraja request",
      );
      assert.ok(
        capturedCallbackUrl!.includes(`token=${encodeURIComponent(testSecret)}`),
        `CallBackURL must include the encoded MPESA_WEBHOOK_SECRET token. Got: ${capturedCallbackUrl}`,
      );
    } finally {
      globalThis.fetch = origFetch;
      if (savedSecret !== undefined) process.env["MPESA_WEBHOOK_SECRET"] = savedSecret;
      else delete process.env["MPESA_WEBHOOK_SECRET"];
      invalidateMpesaSecretCache();
      if (savedKey  !== undefined) process.env["MPESA_CONSUMER_KEY"]    = savedKey;
      else delete process.env["MPESA_CONSUMER_KEY"];
      if (savedSec  !== undefined) process.env["MPESA_CONSUMER_SECRET"] = savedSec;
      else delete process.env["MPESA_CONSUMER_SECRET"];
      if (savedShort !== undefined) process.env["MPESA_SHORTCODE"]      = savedShort;
      else delete process.env["MPESA_SHORTCODE"];
      if (savedPass !== undefined) process.env["MPESA_PASSKEY"]         = savedPass;
      else delete process.env["MPESA_PASSKEY"];
    }
  });
});

// ── (m) DB insert failure → STK push endpoint returns 500 (no CheckoutRequestID) ─
// Guards against the scenario where the DB is unavailable exactly when the
// initiation record should be written.  Without the record the callback cannot
// recover the payment; we must therefore refuse to issue a usable
// CheckoutRequestID rather than silently stranding the customer's payment.

describe("M-Pesa initiation — DB insert failure", () => {
  it("returns 500 without a CheckoutRequestID when the initiation DB insert fails", async () => {
    // Remove Daraja credentials so the endpoint uses the sandbox branch,
    // which does the insert BEFORE any external call — cleanest surface to intercept.
    const savedKey    = process.env["MPESA_CONSUMER_KEY"];
    const savedSecret = process.env["MPESA_CONSUMER_SECRET"];
    const savedShort  = process.env["MPESA_SHORTCODE"];
    const savedPass   = process.env["MPESA_PASSKEY"];
    delete process.env["MPESA_CONSUMER_KEY"];
    delete process.env["MPESA_CONSUMER_SECRET"];
    delete process.env["MPESA_SHORTCODE"];
    delete process.env["MPESA_PASSKEY"];

    // Override db.insert on the shared singleton to throw once.
    const { db: dbInstance } = await import("@workspace/db");
    const origInsert = dbInstance.insert.bind(dbInstance);
    let failTriggered = false;
    (dbInstance as unknown as Record<string, unknown>)["insert"] = function (...args: unknown[]) {
      if (!failTriggered) {
        failTriggered = true;
        throw new Error("DB write unavailable (simulated for test)");
      }
      return (origInsert as (...a: unknown[]) => unknown)(...args);
    };

    try {
      const addr = (server.address() as { port: number });
      const res = await realFetch(
        `http://localhost:${addr.port}/api/payments/mpesa`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ phone: "0712300000", amount: 5000, orderId: "DB-FAIL-TEST" }),
        },
      );
      const body = await res.json() as Record<string, unknown>;

      assert.equal(res.status, 500, "endpoint must return 500 when initiation DB insert fails");
      assert.ok(body["error"],        "error message must be present");
      assert.equal(body["retryable"], true, "client must be told to retry");
      assert.ok(!("checkoutRequestId" in body), "no CheckoutRequestID must be issued — without the record the callback cannot recover payment");
    } finally {
      // Restore insert and credentials
      (dbInstance as unknown as Record<string, unknown>)["insert"] = origInsert;
      if (savedKey)    process.env["MPESA_CONSUMER_KEY"]    = savedKey;
      if (savedSecret) process.env["MPESA_CONSUMER_SECRET"] = savedSecret;
      if (savedShort)  process.env["MPESA_SHORTCODE"]       = savedShort;
      if (savedPass)   process.env["MPESA_PASSKEY"]         = savedPass;
    }
  });
});

// ── (o) Successful callback on pending order → sends customer email ────────────
// Key signal: when the M-Pesa callback advances an existing pending order to
// "processing", sendViaResend must be called with the customer's email address
// (userId on the order) so they receive a confirmation email.
//
// The Resend API is stubbed via globalThis.fetch.  We capture every POST to
// api.resend.com and assert that at least one targets the customer email.

describe("M-Pesa callback — customer email sent when pending order is advanced", () => {
  it("POSTs to the Resend API with the customer email after advancing to processing", async () => {
    const ref = nextRef();
    await insertInitiation(ref, 5500, "254712345670");

    // Insert a pending order whose userId is the customer email.
    const [inserted] = await db
      .insert(ucOrdersTable)
      .values({
        userId:           "otieno@example.com",
        status:           "pending",
        total:            "5500",
        currency:         "KES",
        paymentMethod:    "mpesa",
        paymentReference: ref,
        promoCode:        "",
        discountPercent:  0,
        discountAmount:   0,
        shippingAddress:  { firstName: "Otieno", city: "Kisumu" },
      })
      .returning();

    const resendCalls: { to: unknown; subject: unknown }[] = [];

    // Custom fetch stub: confirms Daraja + captures Resend sends.
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/oauth/v1/generate")) {
        return new Response(JSON.stringify({ access_token: "stub_token" }), { status: 200 });
      }
      if (u.includes("/stkpushquery")) {
        return new Response(
          JSON.stringify({ ResultCode: "0", ResultDesc: "Processed successfully." }),
          { status: 200 },
        );
      }
      if (u.includes("resend.com")) {
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>; } catch { /* skip */ }
        resendCalls.push({ to: body["to"], subject: body["subject"] });
        return new Response(JSON.stringify({ id: "re_stub_ok" }), { status: 200 });
      }
      // Fall through for anything else (DB health-checks, etc.)
      return new Response(JSON.stringify({}), { status: 200 });
    };

    try {
      const { status, body } = await postCallback(stkPayload(ref, 0, 5500, "254712345670", "LEMAIL01"));
      assert.equal(status, 200, "callback must return 200");
      assert.equal(body["ResultCode"], 0);
      assert.equal(body["orderId"], inserted!.id, "orderId must match the existing order");

      // DB: order advanced to processing
      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows[0]!.status, "processing", "order must be advanced to processing");

      // Email: at least one Resend call must target the customer
      assert.ok(
        resendCalls.length > 0,
        "at least one email must be sent via Resend when a pending order is advanced",
      );
      const customerEmailSent = resendCalls.some((c) => String(c.to).includes("otieno@example.com"));
      assert.ok(
        customerEmailSent,
        `customer email 'otieno@example.com' must appear in a Resend to field; calls: ${JSON.stringify(resendCalls)}`,
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ── (p) Successful callback with no existing order → recovery row + team alert ─
// When Daraja confirms a payment but no order exists in our system (app lost
// connectivity before createOrder fired), a recovery order is created and the
// team is alerted via email.  This test verifies both: the DB row exists AND
// a Resend call targeted the team inbox (info@ucfilters.com).

describe("M-Pesa callback — team alert sent when recovery order is created", () => {
  it("sends a team alert email when a recovery order is created for a confirmed payment", async () => {
    const ref = nextRef();
    await insertInitiation(ref, 6200, "254733000099");
    // No existing order — this is the recovery path.

    const resendCalls: { to: unknown; subject: unknown }[] = [];

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/oauth/v1/generate")) {
        return new Response(JSON.stringify({ access_token: "stub_token" }), { status: 200 });
      }
      if (u.includes("/stkpushquery")) {
        return new Response(
          JSON.stringify({ ResultCode: "0", ResultDesc: "Processed successfully." }),
          { status: 200 },
        );
      }
      if (u.includes("resend.com")) {
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>; } catch { /* skip */ }
        resendCalls.push({ to: body["to"], subject: body["subject"] });
        return new Response(JSON.stringify({ id: "re_stub_team" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    try {
      const { status, body } = await postCallback(stkPayload(ref, 0, 9999, "254733000099", "LRECOV01"));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0);
      assert.equal(body["recovered"], true, "recovered flag must be set");
      assert.ok(typeof body["orderId"] === "number", "orderId must be a number");

      // DB: recovery order created in 'processing' state
      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 1, "exactly one recovery order must be created");
      assert.equal(rows[0]!.status, "processing");
      assert.equal(rows[0]!.webhookRecovery, true);

      // Alert: Resend must have been called targeting the team email.
      // alertTeamRecoveryOrder fires fetch via sendViaResend (fire-and-forget), so
      // we wait a tick to allow the microtask to settle before asserting.
      await new Promise<void>((r) => setTimeout(r, 50));
      assert.ok(
        resendCalls.length > 0,
        "at least one email must be sent via Resend for a recovery order",
      );
      const teamAlertSent = resendCalls.some((c) => String(c.to).includes("info@ucfilters.com"));
      assert.ok(
        teamAlertSent,
        `team email 'info@ucfilters.com' must appear in a Resend to field; calls: ${JSON.stringify(resendCalls)}`,
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ── (q) Sequential duplicate callback → absorbed without a second order ────────
// A non-concurrent duplicate (second request completes after the first): the
// idempotency check on paymentReference finds the order created by the first
// call and returns 200 without inserting another row.  This complements the
// concurrent test (i) by verifying the idempotency path also works when the
// requests arrive sequentially (the normal Safaricom retry pattern).

describe("M-Pesa callback — sequential duplicate is absorbed (no second order created)", () => {
  it("second callback for the same CheckoutRequestID is a no-op after the first succeeds", async () => {
    const restore = stubDaraja("0");
    const ref = nextRef();
    await insertInitiation(ref, 4800, "254711000077");
    try {
      // First call — creates the recovery order.
      const first = await postCallback(stkPayload(ref, 0, 4800, "254711000077", "LSEQ001"));
      assert.equal(first.status, 200, "first callback must return 200");
      assert.equal(first.body["ResultCode"], 0);
      assert.equal(first.body["recovered"], true, "first call must create a recovery order");
      const firstOrderId = first.body["orderId"] as number;

      // Second call — the order already exists; idempotency must absorb it.
      const second = await postCallback(stkPayload(ref, 0, 4800, "254711000077", "LSEQ001"));
      assert.equal(second.status, 200, "second callback must also return 200");
      assert.equal(second.body["ResultCode"], 0);
      // orderId must still refer to the same order (not a new one).
      assert.equal(
        second.body["orderId"],
        firstOrderId,
        "duplicate callback must reference the original order, not a new one",
      );

      // DB: exactly one order row — no duplicate.
      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(
        rows.length,
        1,
        "sequential duplicate callback must not create a second order row",
      );
      assert.equal(rows[0]!.status, "processing");
    } finally { restore(); }
  });
});

// ── (r) Failed payment (ResultCode !== 0) → no order touched ─────────────────
// Safaricom sends ResultCode !== 0 when the payment fails (user cancelled, wrong
// PIN, insufficient funds, etc.).  The handler must ack the callback (ResultCode 0
// in the response so Safaricom stops retrying) without creating or modifying any
// order row.

describe("M-Pesa callback — failed payment leaves no DB trace", () => {
  it("ResultCode !== 0 callback is acknowledged without creating or touching any order", async () => {
    const restore = stubDaraja("0"); // Daraja stub present but never reached (ResultCode check is first)
    const ref = nextRef();
    try {
      // ResultCode 1 = InsufficientFunds; not 0 → handler should bail immediately.
      const { status, body } = await postCallback(stkPayload(ref, 1));
      assert.equal(status, 200, "Safaricom must always receive HTTP 200");
      assert.equal(body["ResultCode"], 0, "ack ResultCode must always be 0");
      assert.ok(!("orderId"   in body), "no orderId for a failed payment");
      assert.ok(!("recovered" in body), "no recovered flag for a failed payment");

      // DB: no order must exist for this reference.
      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 0, "a non-zero ResultCode must not create or modify any order row");
    } finally { restore(); }
  });

  it("ResultCode 1032 (user cancelled) callback is acknowledged without any DB action", async () => {
    const restore = stubDaraja("0");
    const ref = nextRef();
    try {
      const { status, body } = await postCallback(stkPayload(ref, 1032));
      assert.equal(status, 200);
      assert.equal(body["ResultCode"], 0);
      assert.ok(!("orderId" in body));

      const rows = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.paymentReference, ref));
      assert.equal(rows.length, 0, "user-cancelled callback must not create any order row");
    } finally { restore(); }
  });
});

// ── (n) Full round-trip: POST /payments/mpesa → initiation stored → callback ─
// This test exercises the real POST /payments/mpesa endpoint in sandbox mode
// (no Daraja credentials active), verifies the initiation record is persisted,
// then fires the callback and confirms a 'processing' recovery order is created.
// It validates the deployed schema path: the table must exist before any STK
// push is accepted; if the migration was never applied this test will fail.

describe("M-Pesa callback — full round-trip (sandbox)", () => {
  it("POST /payments/mpesa stores initiation; callback creates recovery using initiation amount", async () => {
    const restore = stubDaraja("0");

    // Ensure Daraja credentials are ABSENT so the endpoint uses sandbox mode.
    const savedKey    = process.env["MPESA_CONSUMER_KEY"];
    const savedSecret = process.env["MPESA_CONSUMER_SECRET"];
    const savedShort  = process.env["MPESA_SHORTCODE"];
    const savedPass   = process.env["MPESA_PASSKEY"];
    delete process.env["MPESA_CONSUMER_KEY"];
    delete process.env["MPESA_CONSUMER_SECRET"];
    delete process.env["MPESA_SHORTCODE"];
    delete process.env["MPESA_PASSKEY"];

    try {
      const addr = (server.address() as { port: number });

      // ── Step 1: initiate the STK push via the real endpoint ──────────────
      const stkRes = await realFetch(
        `http://localhost:${addr.port}/api/payments/mpesa`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ phone: "0712345999", amount: 8800, orderId: "TEST-RT-1" }),
        },
      );
      assert.equal(stkRes.status, 200, "STK initiation must return 200");
      const stkBody = (await stkRes.json()) as Record<string, unknown>;
      const checkoutRequestId = stkBody["checkoutRequestId"] as string;
      assert.ok(checkoutRequestId, "response must include checkoutRequestId");

      // ── Step 2: verify the initiation record was persisted ───────────────
      const initiations = await db
        .select()
        .from(mpesaStkInitiationsTable)
        .where(eq(mpesaStkInitiationsTable.checkoutRequestId, checkoutRequestId));
      assert.equal(initiations.length, 1, "initiation record must be stored in DB immediately");
      assert.equal(initiations[0]!.expectedAmount, 8800, "stored amount must match request");
      assert.ok(initiations[0]!.expiresAt > new Date(), "expiry must be in the future");

      // ── Step 3: fire the callback and verify a recovery order is created ─
      // Restore Daraja env so verification runs (stubs handle the actual calls).
      process.env["MPESA_CONSUMER_KEY"]    = "test_key";
      process.env["MPESA_CONSUMER_SECRET"] = "test_secret";
      process.env["MPESA_SHORTCODE"]       = "174379";
      process.env["MPESA_PASSKEY"]         = "test_passkey";

      const cbRes = await postCallback(stkPayload(checkoutRequestId, 0, 9999, "254712345999", "LRT001"));
      assert.equal(cbRes.status, 200);
      assert.equal(cbRes.body["ResultCode"], 0);
      assert.ok(typeof cbRes.body["orderId"] === "number", "orderId must be returned");
      assert.equal(cbRes.body["recovered"], true);

      // ── Step 4: verify the recovery order uses our initiated amount ───────
      const orders = await db
        .select()
        .from(ucOrdersTable)
        .where(eq(ucOrdersTable.paymentReference, checkoutRequestId));
      assert.equal(orders.length, 1, "exactly one recovery order");
      assert.equal(orders[0]!.status, "processing");
      assert.equal(orders[0]!.total, "8800", "must use initiation amount (8800), not tampered callback amount (9999)");
      assert.equal(orders[0]!.webhookRecovery, true);
    } finally {
      // Restore env vars
      if (savedKey)    process.env["MPESA_CONSUMER_KEY"]    = savedKey;
      if (savedSecret) process.env["MPESA_CONSUMER_SECRET"] = savedSecret;
      if (savedShort)  process.env["MPESA_SHORTCODE"]       = savedShort;
      if (savedPass)   process.env["MPESA_PASSKEY"]         = savedPass;
      restore();
    }
  });
});
