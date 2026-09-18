/**
 * Tests for COD (Cash on Delivery) input validation in POST /api/uc/orders.
 *
 * COD has no payment barrier, so the route must reject junk submissions:
 *   – keyboard-mash names ("hjkhjk", "asdf")
 *   – missing/invalid phone numbers
 * while accepting real Kenyan names and phone formats, normalizing local
 * 07…/01… numbers to +254…. Verified-payment methods (mpesa etc.) must NOT
 * be gated by these checks.
 *
 * Strategy mirrors mpesa-idempotency.test.ts: no WC credentials → DB path;
 * fetch stubbed so no external calls fire.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";

import app from "../app.js";
import {
  db,
  ucUsersTable,
  ucOrdersTable,
  ucOrderItemsTable,
  ucRewardsLedgerTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { looksLikeRealName, validatePhone } from "../lib/order-validation.js";

// ── Shared state ──────────────────────────────────────────────────────────────

let realFetch: typeof globalThis.fetch;
let server: http.Server;
let base: string;

const createdUserIds: number[] = [];
const createdOrderIds: number[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postOrders(
  body: unknown,
  jwt?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await realFetch(`${base}/uc/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
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
  const email = `codval-${suffix}-${Date.now()}@uctest.internal`;
  const hash = await bcryptjs.hash("Test1234!", 4);
  const [row] = await db
    .insert(ucUsersTable)
    .values({
      email,
      passwordHash: hash,
      firstName: "Test",
      lastName: "Buyer",
    })
    .returning();
  if (!row) throw new Error("failed to insert test user");
  createdUserIds.push(row.id);

  const res = await realFetch(`${base}/uc/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Test1234!" }),
  });
  const loginBody = (await res.json()) as { token?: string };
  if (!loginBody.token) throw new Error("login failed for test user");
  return { id: row.id, email, jwt: loginBody.token };
}

const VALID_SHIPPING = {
  firstName: "Amina",
  lastName: "Otieno",
  address1: "12 Riverside Dr",
  city: "Nairobi",
  country: "KE",
  phone: "0712345678",
};

function codPayload(shippingOverrides: Record<string, string | undefined> = {}) {
  const shippingAddress: Record<string, string> = { ...VALID_SHIPPING };
  for (const [k, v] of Object.entries(shippingOverrides)) {
    if (v === undefined) delete shippingAddress[k];
    else shippingAddress[k] = v;
  }
  return {
    lineItems: [{ productId: 22, quantity: 1 }],
    paymentMethod: "cod",
    shippingAddress,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("COD order input validation", () => {
  let jwt: string;

  before(async () => {
    realFetch = globalThis.fetch;

    // Mirror the mpesa-idempotency harness: with M-Pesa credentials absent
    // the server verifies mpesa references in mock mode, and with WC
    // credentials absent all orders take the local DB path (no WooCommerce
    // pre-flight/anchor round-trips, which fail closed against stubs).
    delete process.env["MPESA_CONSUMER_KEY"];
    delete process.env["MPESA_CONSUMER_SECRET"];
    delete process.env["MPESA_SHORTCODE"];
    delete process.env["MPESA_PASSKEY"];
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no server address");
    base = `http://127.0.0.1:${addr.port}/api`;
    ({ jwt } = await createTestUser("main"));

    // Silence outbound calls for every test in this file. Safaricom (Daraja)
    // endpoints get well-formed success payloads so the mpesa control test
    // passes payment verification. WooCommerce lookups return an empty list
    // and WC order creation returns no usable order (no `id`), so the route
    // always falls through to the local DB path. Everything else gets a
    // generic empty 200.
    globalThis.fetch = async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("safaricom.co.ke") && u.includes("/oauth/")) {
        return new Response(JSON.stringify({ access_token: "stub-token" }), { status: 200 });
      }
      if (u.includes("safaricom.co.ke") && u.includes("stkpushquery")) {
        return new Response(JSON.stringify({ ResultCode: "0", ResultDesc: "ok" }), { status: 200 });
      }
      if (u.includes("/wp-json/")) {
        const method = (init?.method ?? "GET").toUpperCase();
        return method === "GET"
          ? new Response(JSON.stringify([]), { status: 200 })
          : new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    if (createdOrderIds.length > 0) {
      await db.delete(ucOrderItemsTable).where(inArray(ucOrderItemsTable.orderId, createdOrderIds));
      await db.delete(ucOrdersTable).where(inArray(ucOrdersTable.id, createdOrderIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(ucRewardsLedgerTable).where(inArray(ucRewardsLedgerTable.userId, createdUserIds));
    }
    for (const id of createdUserIds) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, id));
    }
  });

  function track(body: Record<string, unknown>): void {
    if (typeof body["id"] === "number") createdOrderIds.push(body["id"]);
  }

  // ── Rejections ──────────────────────────────────────────────────────────

  it("rejects a keyboard-mash first name (no vowels)", async () => {
    const { status, body } = await postOrders(codPayload({ firstName: "hjkhjk" }), jwt);
    assert.equal(status, 400);
    const fields = body["fields"] as Record<string, string>;
    assert.ok(fields["firstName"], "must name the firstName field");
  });

  it("rejects a keyboard-row run as a name (asdf…)", async () => {
    const { status, body } = await postOrders(codPayload({ firstName: "Asdfgh" }), jwt);
    assert.equal(status, 400);
    assert.ok((body["fields"] as Record<string, string>)["firstName"]);
  });

  it("rejects a numeric first name", async () => {
    const { status } = await postOrders(codPayload({ firstName: "12345" }), jwt);
    assert.equal(status, 400);
  });

  it("rejects a single repeated character name (aaaa)", async () => {
    const { status } = await postOrders(codPayload({ firstName: "aaaa" }), jwt);
    assert.equal(status, 400);
  });

  it("rejects a missing first name", async () => {
    const { status, body } = await postOrders(codPayload({ firstName: undefined }), jwt);
    assert.equal(status, 400);
    assert.ok((body["fields"] as Record<string, string>)["firstName"]);
  });

  it("rejects a gibberish last name when one is provided", async () => {
    const { status, body } = await postOrders(codPayload({ lastName: "zxzxzx" }), jwt);
    assert.equal(status, 400);
    assert.ok((body["fields"] as Record<string, string>)["lastName"]);
  });

  it("rejects a missing phone number", async () => {
    const { status, body } = await postOrders(codPayload({ phone: undefined }), jwt);
    assert.equal(status, 400);
    assert.ok((body["fields"] as Record<string, string>)["phone"]);
  });

  it("rejects a too-short phone number", async () => {
    const { status } = await postOrders(codPayload({ phone: "0712" }), jwt);
    assert.equal(status, 400);
  });

  it("rejects a phone number with letters", async () => {
    const { status } = await postOrders(codPayload({ phone: "07abc45678" }), jwt);
    assert.equal(status, 400);
  });

  it("rejects a COD order with no shippingAddress at all", async () => {
    const { status, body } = await postOrders(
      { lineItems: [{ productId: 22, quantity: 1 }], paymentMethod: "cod" },
      jwt,
    );
    assert.equal(status, 400);
    assert.ok(body["fields"], "must return field errors");
  });

  it("returns a controlled 400 (not a crash) for non-string shipping fields", async () => {
    const { status, body } = await postOrders(
      {
        lineItems: [{ productId: 22, quantity: 1 }],
        paymentMethod: "cod",
        shippingAddress: { firstName: 42, lastName: ["x"], phone: { n: 1 }, address1: "1 Ngong Ave", city: "Nairobi" },
      },
      jwt,
    );
    assert.equal(status, 400, `expected controlled 400, got ${status}: ${JSON.stringify(body)}`);
    const fields = body["fields"] as Record<string, string>;
    assert.ok(fields["firstName"], "non-string firstName must be treated as missing");
    assert.ok(fields["phone"], "non-string phone must be treated as missing");
  });

  it("returns a controlled 400 when shippingAddress is an array", async () => {
    const { status, body } = await postOrders(
      { lineItems: [{ productId: 22, quantity: 1 }], paymentMethod: "cod", shippingAddress: ["junk"] },
      jwt,
    );
    assert.equal(status, 400);
    assert.ok(body["fields"], "must return field errors");
  });

  it("reports multiple bad fields in one response", async () => {
    const { status, body } = await postOrders(
      codPayload({ firstName: "xzxz", phone: "123" }),
      jwt,
    );
    assert.equal(status, 400);
    const fields = body["fields"] as Record<string, string>;
    assert.ok(fields["firstName"] && fields["phone"], "both fields must be reported");
  });

  // ── Acceptances ─────────────────────────────────────────────────────────

  /** Read the stored shipping address for an order straight from the DB. */
  async function storedShipping(orderId: number): Promise<Record<string, string>> {
    const [row] = await db
      .select()
      .from(ucOrdersTable)
      .where(eq(ucOrdersTable.id, orderId));
    assert.ok(row, `order ${orderId} must exist in the DB`);
    return (row.shippingAddress ?? {}) as Record<string, string>;
  }

  it("accepts a valid COD order and normalizes 07… to +254…", async () => {
    const { status, body } = await postOrders(codPayload(), jwt);
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    track(body);
    const shipping = await storedShipping(body["id"] as number);
    assert.equal(shipping["phone"], "+254712345678", "local phone must be normalized to +254");
  });

  it("accepts +254 international format unchanged", async () => {
    const { status, body } = await postOrders(codPayload({ phone: "+254101234567" }), jwt);
    assert.equal(status, 200);
    track(body);
    const shipping = await storedShipping(body["id"] as number);
    assert.equal(shipping["phone"], "+254101234567");
  });

  it("accepts an apostrophe name (Ng'ang'a)", async () => {
    const { status, body } = await postOrders(codPayload({ lastName: "Ng'ang'a" }), jwt);
    assert.equal(status, 200, JSON.stringify(body));
    track(body);
  });

  it("accepts an accented name (Ngũgĩ)", async () => {
    const { status, body } = await postOrders(codPayload({ firstName: "Ngũgĩ" }), jwt);
    assert.equal(status, 200, JSON.stringify(body));
    track(body);
  });

  it("accepts a guest COD order with valid details (no auth token)", async () => {
    const { status, body } = await postOrders(codPayload());
    assert.equal(status, 200, JSON.stringify(body));
    track(body);
  });

  it("returns retryable 503 and creates no local order when WooCommerce is unavailable", async () => {
    const previousKey = process.env["WC_CONSUMER_KEY"];
    const previousSecret = process.env["WC_CONSUMER_SECRET"];
    process.env["WC_CONSUMER_KEY"] = "ck_cod_outage_test";
    process.env["WC_CONSUMER_SECRET"] = "cs_cod_outage_test";

    const firstReference = `cod_checkout_${Date.now()}_a`;
    const secondReference = `cod_checkout_${Date.now()}_b`;
    const firstPayload = {
      ...codPayload(),
      paymentReference: firstReference,
      idempotencyKey: "checkout-attempt-a",
    };
    const secondPayload = {
      ...codPayload(),
      paymentReference: secondReference,
      idempotencyKey: "checkout-attempt-b",
    };

    try {
      const first = await postOrders(firstPayload);
      const retry = await postOrders(firstPayload);
      const independentCheckout = await postOrders(secondPayload);

      assert.equal(first.status, 503);
      assert.equal(first.body["retryable"], true);
      assert.equal(retry.status, 503);
      assert.equal(retry.body["retryable"], true);
      assert.equal(independentCheckout.status, 503);
      assert.equal(independentCheckout.body["retryable"], true);

      const pendingAnchors = await db
        .select({ paymentReference: ucOrdersTable.paymentReference })
        .from(ucOrdersTable)
        .where(inArray(ucOrdersTable.paymentReference, [firstReference, secondReference]));
      assert.deepEqual(
        pendingAnchors.map(row => row.paymentReference).sort(),
        [firstReference, secondReference].sort(),
        "a retry must reuse one anchor while an independent checkout gets its own",
      );
    } finally {
      const anchors = await db
        .select({ id: ucOrdersTable.id })
        .from(ucOrdersTable)
        .where(inArray(ucOrdersTable.paymentReference, [firstReference, secondReference]));
      const anchorIds = anchors.map(row => row.id);
      if (anchorIds.length > 0) {
        await db.delete(ucOrderItemsTable).where(inArray(ucOrderItemsTable.orderId, anchorIds));
        await db.delete(ucOrdersTable).where(inArray(ucOrdersTable.id, anchorIds));
      }
      if (previousKey === undefined) delete process.env["WC_CONSUMER_KEY"];
      else process.env["WC_CONSUMER_KEY"] = previousKey;
      if (previousSecret === undefined) delete process.env["WC_CONSUMER_SECRET"];
      else process.env["WC_CONSUMER_SECRET"] = previousSecret;
    }
  });

  it("rejects invalid phone numbers before a verified-payment order", async () => {
    // Phone normalization is required for every method, even though paid
    // methods do not use the COD name heuristics.
    const { status, body } = await postOrders(
      {
        lineItems: [{ productId: 22, quantity: 1 }],
        paymentMethod: "mpesa",
        paymentReference: `ws_CO_codval_${Date.now()}`,
        shippingAddress: { firstName: "hjkhjk", phone: "123" },
      },
      jwt,
    );
    assert.equal(status, 400, `invalid phone must be rejected: ${JSON.stringify(body)}`);
    assert.ok((body["fields"] as Record<string, string>)["phone"]);
  });

  it("normalizes a non-Kenyan local phone before paid-order persistence", async () => {
    const { status, body } = await postOrders(
      {
        lineItems: [{ productId: 22, quantity: 1 }],
        paymentMethod: "mpesa",
        paymentReference: `ws_GH_${Date.now()}`,
        shippingAddress: {
          firstName: "Amina",
          country: "GH",
          phone: "0241234567",
        },
      },
      jwt,
    );
    assert.equal(status, 200, JSON.stringify(body));
    track(body);
    const shipping = await storedShipping(body["id"] as number);
    assert.equal(shipping["phone"], "+233241234567");
  });

  it("rejects local phone values when no valid country is supplied", async () => {
    const { status, body } = await postOrders(
      {
        lineItems: [{ productId: 22, quantity: 1 }],
        paymentMethod: "mpesa",
        paymentReference: `ws_NO_COUNTRY_${Date.now()}`,
        shippingAddress: { firstName: "Amina", phone: "0722123456" },
      },
      jwt,
    );
    assert.equal(status, 400);
    assert.ok((body["fields"] as Record<string, string>)["phone"]);
  });
});

// ── Unit tests for the helpers ────────────────────────────────────────────────

describe("looksLikeRealName", () => {
  it("accepts common names", () => {
    for (const n of ["Amina", "Jean-Paul", "Ng'ang'a", "Ngũgĩ", "O'Brien", "St. John", "Kym"]) {
      assert.ok(looksLikeRealName(n), `${n} must be accepted`);
    }
  });
  it("rejects junk", () => {
    for (const n of ["hjkhjk", "asdf", "qwerty", "12345", "aaaa", "x", "", "  ", "J@ne"]) {
      assert.ok(!looksLikeRealName(n), `${JSON.stringify(n)} must be rejected`);
    }
  });
});

describe("validatePhone", () => {
  it("normalizes Kenyan formats to +254", () => {
    assert.equal(validatePhone("0712 345 678", "KE").normalized, "+254712345678");
    assert.equal(validatePhone("0112345678", "KE").normalized, "+254112345678");
    assert.equal(validatePhone("254712345678", "KE").normalized, "+254712345678");
    assert.equal(validatePhone("+254712345678", "KE").normalized, "+254712345678");
  });
  it("accepts other international numbers with +", () => {
    assert.ok(validatePhone("+14155552671").valid);
  });
  it("rejects junk", () => {
    for (const p of ["", "123", "0712", "07123456789", "abcdefghij", "0812345678", "+0712345678"]) {
      assert.ok(!validatePhone(p).valid, `${JSON.stringify(p)} must be rejected`);
    }
  });
  it("requires country for local numbers", () => {
    assert.equal(validatePhone("0712 345 678").valid, false);
    assert.equal(validatePhone("0241234567", "GH").normalized, "+233241234567");
  });
});
