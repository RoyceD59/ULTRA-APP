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
import { setTimeout as delay } from "node:timers/promises";

import app from "../app.js";
import { db, pool, ucOrdersTable, ucNotificationLogTable } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";

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

    const orderIds = rows.map((row) => row.id);
    if (orderIds.length) {
      await pool.query(
        "DELETE FROM uc_reconciliation_conflicts WHERE source_reference LIKE ANY($1::text[])",
        [orderIds.map((id) => `order:${id}:%`)],
      ).catch(() => {});
      await pool.query(
        "DELETE FROM uc_canonical_purchase_lines WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[]))",
        [orderIds],
      ).catch(() => {});
      await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[])", [orderIds]).catch(() => {});
    }
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
  it("emails the recovered order details exactly once when a signed webhook is delivered twice", async () => {
    const reference = nextRef();
    const customerEmail = `${reference.toLowerCase()}@example.com`;
    const event = chargeSuccessEvent({
      reference,
      amountKobo: 350_000,
      currency: "KES",
      customerEmail,
    });
    const emails: Array<{ subject: string; text: string; to: string }> = [];
    const savedFetch = globalThis.fetch;
    const savedResendBaseUrl = process.env["RESEND_BASE_URL"];
    const resendBaseUrl = "https://paystack-recovery-resend.test.invalid";
    // Force the direct test transport, never the authenticated connector.
    process.env["RESEND_BASE_URL"] = resendBaseUrl;
    globalThis.fetch = async (url, init) => {
      if (String(url) === `${resendBaseUrl}/emails`) {
        assert.equal(init?.method, "POST");
        assert.equal(typeof init?.body, "string");
        emails.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ id: `recovery-${reference}` }), { status: 200 });
      }
      // SMS and other outbound providers must also remain local stubs.
      return new Response(JSON.stringify({}), { status: 200 });
    };

    let orderId: number | undefined;
    try {
      const existing = await db.select({ id: ucOrdersTable.id }).from(ucOrdersTable)
        .where(eq(ucOrdersTable.paymentReference, reference));
      assert.equal(existing.length, 0, "the webhook must start without a matching order");

      const first = await postWebhook(event);
      assert.equal(first.status, 200);
      assert.equal(first.body["received"], true);
      assert.equal(first.body["recovered"], true);
      assert.ok(typeof first.body["orderId"] === "number" && first.body["orderId"] > 0);
      orderId = first.body["orderId"];

      // Email is fire-and-forget. Its audit row proves the background send
      // finished, rather than assuming it finished with the webhook response.
      const deadline = Date.now() + 5_000;
      let sent = false;
      while (Date.now() < deadline) {
        const logs = await db.select({ id: ucNotificationLogTable.id })
          .from(ucNotificationLogTable).where(and(
            eq(ucNotificationLogTable.orderId, orderId),
            eq(ucNotificationLogTable.template, "payment_recovery_alert"),
            eq(ucNotificationLogTable.channel, "email"),
            eq(ucNotificationLogTable.status, "sent"),
          ));
        if (logs.length > 0) {
          sent = true;
          break;
        }
        await delay(10);
      }
      assert.ok(sent, "the recovery alert must complete its email delivery");
      assert.equal(emails.length, 1, "the first webhook must send one recovery email");
      const alert = emails[0]!;
      assert.equal(alert.subject, `⚠️ Webhook recovery order #${orderId} needs fulfilment`);
      assert.ok(alert.to, "the recovery email must have a team recipient");
      const lines = alert.text.split("\n");
      assert.ok(lines.includes(`Order ID:   ${orderId}`), "alert must contain the recovered order ID");
      assert.ok(lines.includes(`Reference:  ${reference}`), "alert must contain the Paystack reference");
      assert.ok(lines.includes("Amount:     KES 3,500"), "alert must convert kobo to the correct amount and currency");
      assert.ok(lines.includes(`Customer:   ${customerEmail}`), "alert must contain the paying customer's email");

      const duplicate = await postWebhook(event);
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body["received"], true);
      assert.equal(duplicate.body["orderId"], orderId);
      assert.notEqual(duplicate.body["recovered"], true);
      // Let any accidentally scheduled background send reach the transport.
      await delay(100);
      assert.equal(emails.length, 1, "a duplicate webhook must not send a second recovery alert");
      const orders = await db.select({ id: ucOrdersTable.id }).from(ucOrdersTable)
        .where(eq(ucOrdersTable.paymentReference, reference));
      assert.deepEqual(orders, [{ id: orderId }], "both deliveries must resolve to the same order");
    } finally {
      globalThis.fetch = savedFetch;
      if (savedResendBaseUrl === undefined) delete process.env["RESEND_BASE_URL"];
      else process.env["RESEND_BASE_URL"] = savedResendBaseUrl;
      if (orderId !== undefined) {
        await db.delete(ucNotificationLogTable).where(eq(ucNotificationLogTable.orderId, orderId));
      }
    }
  });

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
          row!.paymentReference,
          reference,
          `paymentReference must equal the Paystack reference "${reference}"; got "${row!.paymentReference}"`,
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

describe("Paystack webhook — concurrent duplicate charge.success", () => {
  it(
    "two simultaneous charge.success webhooks for the same reference create exactly one recovery order",
    async () => {
      const reference = nextRef();
      const amountKobo = 500_000; // KES 5,000
      const currency = "KES";
      const customerEmail = `concurrent-${Date.now()}@example.com`;

      const event = chargeSuccessEvent({ reference, amountKobo, currency, customerEmail });

      // Silence all outbound HTTP (Resend, SMS, etc.) for both concurrent calls.
      const savedFetch = globalThis.fetch;
      globalThis.fetch = silentFetch();

      try {
        // Fire two concurrent webhook deliveries for the same reference.
        const [first, second] = await Promise.all([
          postWebhook(event),
          postWebhook(event),
        ]);

        assert.equal(first.status,  200, `first webhook must return 200; got ${first.status}: ${JSON.stringify(first.body)}`);
        assert.equal(second.status, 200, `second webhook must return 200; got ${second.status}: ${JSON.stringify(second.body)}`);

        assert.equal(first.body["received"],  true, "first response must include received:true");
        assert.equal(second.body["received"], true, "second response must include received:true");

        const firstOrderId  = first.body["orderId"];
        const secondOrderId = second.body["orderId"];

        assert.ok(
          typeof firstOrderId === "number" && firstOrderId > 0,
          `first orderId must be a positive number; got ${firstOrderId}`,
        );
        assert.ok(
          typeof secondOrderId === "number" && secondOrderId > 0,
          `second orderId must be a positive number; got ${secondOrderId}`,
        );
        assert.equal(
          firstOrderId,
          secondOrderId,
          `both responses must return the same orderId; got ${firstOrderId} vs ${secondOrderId}`,
        );

        // Verify exactly one DB row for this reference.
        const rows = await db
          .select()
          .from(ucOrdersTable)
          .where(eq(ucOrdersTable.paymentReference, reference));

        assert.equal(
          rows.length,
          1,
          `concurrent webhooks must not create duplicate recovery orders; found ${rows.length} rows`,
        );
        assert.equal(rows[0]!.webhookRecovery, true, "the single row must be flagged as a webhook recovery");
        assert.equal(rows[0]!.paymentMethod,   "paystack", "paymentMethod must be 'paystack'");
      } finally {
        globalThis.fetch = savedFetch;
      }
    },
  );
});

describe("Paystack webhook — enabled canonical dual-write recovery", () => {
  it("heals the winning existing order and converges duplicates to one canonical purchase and line", async () => {
    const previous = process.env["UC_CANONICAL_DUAL_WRITES"];
    process.env["UC_CANONICAL_DUAL_WRITES"] = "true";
    const reference = nextRef();
    const savedFetch = globalThis.fetch;
    globalThis.fetch = silentFetch();
    const user = await pool.query(
      "INSERT INTO uc_users (email,password_hash,first_name) VALUES ($1,'unused','Paystack') RETURNING id",
      [`paystack-${Date.now()}@test.invalid`],
    );
    const order = await pool.query(
      `INSERT INTO uc_orders
       (user_id,status,total,currency,payment_method,payment_reference,promo_code,discount_percent,discount_amount,shipping_address)
       VALUES ($1,'pending','3500','KES','paystack',$2,'',0,0,'{}') RETURNING id`,
      [String(user.rows[0].id), reference],
    );
    const orderId = Number(order.rows[0].id);
    await pool.query(
      "INSERT INTO uc_order_items (order_id,product_id,name,quantity,total) VALUES ($1,1,'Paystack item',1,'3500')",
      [orderId],
    );
    try {
      const event = chargeSuccessEvent({ reference, amountKobo: 350_000, customerEmail: "buyer@example.com" });
      const [first, second] = await Promise.all([postWebhook(event), postWebhook(event)]);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(first.body["orderId"], orderId);
      assert.equal(second.body["orderId"], orderId);
      const canonical = await pool.query(
        "SELECT id FROM uc_canonical_purchases WHERE companion_order_id=$1",
        [orderId],
      );
      assert.equal(canonical.rows.length, 1);
      const lines = await pool.query(
        "SELECT count(*)::int AS count FROM uc_canonical_purchase_lines WHERE purchase_id=$1",
        [canonical.rows[0].id],
      );
      assert.equal(lines.rows[0].count, 1);
    } finally {
      globalThis.fetch = savedFetch;
      if (previous === undefined) delete process.env["UC_CANONICAL_DUAL_WRITES"];
      else process.env["UC_CANONICAL_DUAL_WRITES"] = previous;
      await pool.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE companion_order_id=$1)", [orderId]);
      await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id=$1", [orderId]);
      await pool.query("DELETE FROM uc_order_items WHERE order_id=$1", [orderId]);
      await pool.query("DELETE FROM uc_orders WHERE id=$1", [orderId]);
      await pool.query("DELETE FROM uc_users WHERE id=$1", [user.rows[0].id]);
    }
  });

  it("returns retryable non-2xx for an incompatible canonical purchase without duplicating the order", async () => {
    const previous = process.env["UC_CANONICAL_DUAL_WRITES"];
    process.env["UC_CANONICAL_DUAL_WRITES"] = "true";
    const reference = nextRef();
    const savedFetch = globalThis.fetch;
    globalThis.fetch = silentFetch();
    try {
      await pool.query(
        "INSERT INTO uc_canonical_purchases (companion_order_id,payment_provider,payment_reference,currency,total_minor,payment_status,fulfilment_status) VALUES (NULL,'paystack',$1,'KES',999999,'paid','processing')",
        [reference],
      );
      const response = await postWebhook(chargeSuccessEvent({
        reference,
        amountKobo: 350_000,
        customerEmail: "paystack-conflict@example.com",
      }));
      assert.notEqual(response.status, 200);
      assert.ok(response.status >= 500, `expected retryable 5xx, got ${response.status}`);
      const orders = await pool.query("SELECT count(*)::int AS count FROM uc_orders WHERE payment_reference=$1", [reference]);
      assert.equal(orders.rows[0].count, 1);
      const canonical = await pool.query("SELECT count(*)::int AS count FROM uc_canonical_purchases WHERE payment_reference=$1", [reference]);
      assert.equal(canonical.rows[0].count, 1);
    } finally {
      globalThis.fetch = savedFetch;
      if (previous === undefined) delete process.env["UC_CANONICAL_DUAL_WRITES"];
      else process.env["UC_CANONICAL_DUAL_WRITES"] = previous;
      await pool.query("DELETE FROM uc_reconciliation_conflicts WHERE source_reference LIKE $1", [`%${reference}%`]).catch(() => {});
      await pool.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE payment_reference=$1)", [reference]).catch(() => {});
      await pool.query("DELETE FROM uc_canonical_purchases WHERE payment_reference=$1", [reference]).catch(() => {});
    }
  });
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
