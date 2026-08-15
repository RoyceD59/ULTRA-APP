/**
 * Paystack webhook — recovery order correctness
 *
 * Covers:
 *   1. charge.success with no existing order creates a recovery row with:
 *        – userId   = the customer's email from the payload
 *        – total    = amountKobo / 100 (KES, string)
 *        – currency = from payload
 *        – paymentMethod  = "paystack"
 *        – webhookRecovery = true
 *   2. charge.success with no customer email falls back to
 *      "paystack-webhook-recovery" as the userId.
 *   3. Paystack initialize endpoint returns 429 (Too Many Requests) →
 *      server responds 500 with { retryable: true }.
 *
 * Strategy:
 *   – PAYSTACK_SECRET_KEY is set to a known test value so:
 *       (a) the webhook route does HMAC verification (not 503)
 *       (b) the init route tries the real Paystack branch
 *   – globalThis.fetch is replaced per-test to intercept outbound calls
 *     (Paystack init, Resend, SMS) so nothing real is contacted.
 *   – DB rows are cleaned up in after() by payment reference prefix.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";

import app from "../app.js";
import { db, ucOrdersTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";

// ── Shared state ──────────────────────────────────────────────────────────────

let realFetch: typeof globalThis.fetch;
let server: http.Server;
let base: string;

const TEST_SECRET = "ps_test_recovery_secret_12345";
const TEST_PREFIX = `PS_REC_${Date.now()}`;
let seq = 0;
const nextRef = (): string => `${TEST_PREFIX}_${++seq}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute the HMAC-SHA512 hex digest of raw JSON bytes. */
function sign(body: unknown, secret: string): string {
  return createHmac("sha512", secret)
    .update(JSON.stringify(body))
    .digest("hex");
}

/**
 * POST a Paystack webhook event.
 * The body is JSON-stringified, signed with TEST_SECRET, and sent with the
 * correct Content-Type so the rawBody middleware captures it.
 */
async function postWebhook(
  event: unknown,
  opts: { omitSig?: boolean; wrongSig?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const rawBytes = JSON.stringify(event);
  const sig = opts.omitSig
    ? undefined
    : opts.wrongSig
    ? "0".repeat(128)
    : sign(event, TEST_SECRET);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sig !== undefined) headers["x-paystack-signature"] = sig;

  const res = await realFetch(`${base}/payments/paystack/webhook`, {
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

/** Build a minimal charge.success event. */
function chargeSuccessEvent(opts: {
  reference: string;
  amountKobo: number;
  currency?: string;
  customerEmail?: string | null;
}): unknown {
  return {
    event: "charge.success",
    data: {
      reference: opts.reference,
      amount: opts.amountKobo,
      currency: opts.currency ?? "KES",
      status: "success",
      customer: opts.customerEmail !== null
        ? { email: opts.customerEmail ?? "buyer@example.com" }
        : {},
    },
  };
}

/** Silence outbound Resend/SMS/push calls without throwing. */
function silentFetch(): typeof globalThis.fetch {
  return async (_url: unknown, _init?: RequestInit) =>
    new Response(JSON.stringify({}), { status: 200 });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(
  async () => {
    realFetch = globalThis.fetch;

    process.env["PAYSTACK_SECRET_KEY"] = TEST_SECRET;
    process.env["SESSION_SECRET"] ??= "test-secret-ps-recovery";

    // Delete WC/M-Pesa env vars so outbound calls don't reach real gateways.
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];
    delete process.env["MPESA_CONSUMER_KEY"];
    delete process.env["MPESA_CONSUMER_SECRET"];

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
  // Clean up all recovery orders created during this suite (matched by reference prefix).
  try {
    const rows = await db
      .select({ id: ucOrdersTable.id })
      .from(ucOrdersTable)
      .where(like(ucOrdersTable.paymentReference, `${TEST_PREFIX}%`));

    for (const row of rows) {
      await db.delete(ucOrdersTable).where(eq(ucOrdersTable.id, row.id)).catch(() => {});
    }
  } catch {
    /* best-effort cleanup */
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
  globalThis.fetch = realFetch;
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Paystack webhook — recovery order correctness", () => {
  it(
    "charge.success with no existing order inserts recovery row with correct customer, amount, currency, and paymentMethod",
    async () => {
      const reference = nextRef();
      const amountKobo = 350_000; // KES 3,500
      const currency = "KES";
      const customerEmail = `buyer-${Date.now()}@example.com`;

      const event = chargeSuccessEvent({ reference, amountKobo, currency, customerEmail });

      // Silence all outbound HTTP (Resend, SMS, etc.)
      const savedFetch = globalThis.fetch;
      globalThis.fetch = silentFetch();

      try {
        const res = await postWebhook(event);

        assert.equal(
          res.status,
          200,
          `expected 200 from webhook handler; got ${res.status}: ${JSON.stringify(res.body)}`,
        );
        assert.equal(res.body["received"], true, "response must include received:true");
        assert.equal(res.body["recovered"], true, "response must include recovered:true for a new recovery row");

        const orderId = res.body["orderId"];
        assert.ok(typeof orderId === "number" && orderId > 0, `orderId must be a positive number; got ${orderId}`);

        // Verify the DB row contains the right values.
        const [row] = await db
          .select()
          .from(ucOrdersTable)
          .where(eq(ucOrdersTable.id, orderId as number))
          .limit(1);

        assert.ok(row, "recovery order row must exist in the database");

        assert.equal(
          row!.userId,
          customerEmail,
          `userId must equal the customer email from the payload ("${customerEmail}"); got "${row!.userId}"`,
        );

        const expectedTotal = String(Math.round(amountKobo / 100));
        assert.equal(
          row!.total,
          expectedTotal,
          `total must be amountKobo/100 = "${expectedTotal}" (KES); got "${row!.total}"`,
        );

        assert.equal(
          row!.currency,
          currency,
          `currency must be "${currency}" from the payload; got "${row!.currency}"`,
        );

        assert.equal(
          row!.paymentMethod,
          "paystack",
          `paymentMethod must be "paystack"; got "${row!.paymentMethod}"`,
        );

        assert.equal(
          row!.webhookRecovery,
          true,
          `webhookRecovery must be true on a recovery row; got ${row!.webhookRecovery}`,
        );
      } finally {
        globalThis.fetch = savedFetch;
      }
    },
  );

  it(
    "charge.success with no customer email falls back to 'paystack-webhook-recovery' as userId",
    async () => {
      const reference = nextRef();
      const amountKobo = 120_000; // KES 1,200

      // Payload without customer email (empty customer object)
      const event = chargeSuccessEvent({ reference, amountKobo, customerEmail: null });

      const savedFetch = globalThis.fetch;
      globalThis.fetch = silentFetch();

      try {
        const res = await postWebhook(event);

        assert.equal(
          res.status,
          200,
          `expected 200; got ${res.status}: ${JSON.stringify(res.body)}`,
        );
        assert.equal(res.body["recovered"], true, "must be flagged as a recovery order");

        const orderId = res.body["orderId"] as number;
        const [row] = await db
          .select()
          .from(ucOrdersTable)
          .where(eq(ucOrdersTable.id, orderId))
          .limit(1);

        assert.ok(row, "recovery order row must exist");
        assert.equal(
          row!.userId,
          "paystack-webhook-recovery",
          `userId must fall back to "paystack-webhook-recovery" when email is absent; got "${row!.userId}"`,
        );
        assert.equal(
          row!.paymentMethod,
          "paystack",
          `paymentMethod must be "paystack"; got "${row!.paymentMethod}"`,
        );
        assert.equal(row!.webhookRecovery, true, "webhookRecovery must be true");
      } finally {
        globalThis.fetch = savedFetch;
      }
    },
  );
});

describe("Paystack initialize — transient outage signalling", () => {
  it(
    "Paystack returns 429 (Too Many Requests) → server responds 500 with retryable:true",
    async () => {
      // Paystack rate-limits us: return 429.
      const savedFetch = globalThis.fetch;
      globalThis.fetch = async (url: unknown, _init?: RequestInit) => {
        const u = String(url);
        if (u.includes("paystack.co")) {
          return new Response(JSON.stringify({ message: "Too Many Requests" }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }
        // Other outbound calls (Resend, etc.) succeed silently.
        return new Response(JSON.stringify({}), { status: 200 });
      };

      try {
        const res = await realFetch(`${base}/payments/paystack/init`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "buyer@example.com", amount: 1000 }),
        });

        const body = (await res.json()) as Record<string, unknown>;

        assert.equal(
          res.status,
          500,
          `expected 500 for a 429 Paystack outage; got ${res.status}: ${JSON.stringify(body)}`,
        );
        assert.equal(
          body["retryable"],
          true,
          `retryable must be true for a 429 so the client offers retry/COD; got: ${JSON.stringify(body)}`,
        );
        assert.ok(
          typeof body["error"] === "string" && body["error"].length > 0,
          "error message must be present in the response",
        );
      } finally {
        globalThis.fetch = savedFetch;
      }
    },
  );
});
