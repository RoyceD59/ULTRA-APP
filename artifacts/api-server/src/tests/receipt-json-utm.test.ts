/**
 * Tests for the structured receipt export and promo-code UTM encoding.
 *
 *   1. promoUtmParams / promoUtmQuery — unit tests (sanitization, empty codes).
 *   2. GET /api/uc/admin/orders/:id/receipt.json — auth, 404, and the
 *      bookkeeping / inventory / crm / marketing sections.
 *   3. GET /api/uc/admin/orders.csv — utm column present and populated.
 *
 * Uses the real DB (same pattern as orders-csv-export.test.ts).
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
import { promoUtmParams, promoUtmQuery, storeUrlWithUtm } from "../lib/utm.js";
import { buildOrderReceiptEmail } from "../lib/email.js";
import {
  db,
  ucUsersTable,
  ucOrdersTable,
  ucOrderItemsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-receipt-json-tests";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) =>
      err ? reject(err) : resolve(),
    );
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(e => (e ? reject(e) : resolve())),
  );
});

async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; headers: Headers; text: string }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, init);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

function authHeader(claims: { id: number | string; email: string }) {
  return `Bearer ${issueToken({ ...claims, firstName: "Receipt", lastName: "Test" })}`;
}

// ── UTM unit tests ────────────────────────────────────────────────────────────

describe("promoUtmParams / promoUtmQuery — promo code UTM encoding", () => {
  it("returns null for empty / whitespace / missing codes", () => {
    assert.equal(promoUtmParams(""), null);
    assert.equal(promoUtmParams("   "), null);
    assert.equal(promoUtmParams(null), null);
    assert.equal(promoUtmParams(undefined), null);
    assert.equal(promoUtmQuery(""), "");
  });

  it("encodes a simple code with standard source/medium", () => {
    const utm = promoUtmParams("WATER10");
    assert.deepEqual(utm, {
      utm_source:   "uc-companion",
      utm_medium:   "promo-code",
      utm_campaign: "water10",
    });
  });

  it("sanitizes spaces and special characters in the campaign name", () => {
    assert.equal(promoUtmParams("Summer Sale!")!.utm_campaign, "summer-sale");
    assert.equal(promoUtmParams("  10% OFF  ")!.utm_campaign, "10-off");
  });

  it("returns null when the code sanitizes to nothing", () => {
    assert.equal(promoUtmParams("!!!"), null);
    assert.equal(promoUtmQuery("!!!"), "");
  });

  it("produces a URL-safe query string", () => {
    assert.equal(
      promoUtmQuery("WATER10"),
      "utm_source=uc-companion&utm_medium=promo-code&utm_campaign=water10",
    );
  });

  it("storeUrlWithUtm appends the query only when a promo exists", () => {
    assert.equal(storeUrlWithUtm(""), "https://ucfilters.co.ke");
    assert.equal(
      storeUrlWithUtm("WATER10"),
      "https://ucfilters.co.ke/?utm_source=uc-companion&utm_medium=promo-code&utm_campaign=water10",
    );
  });
});

describe("buildOrderReceiptEmail — store link carries promo UTM", () => {
  it("html and text link to the UTM-tagged store URL when a promo code is set", () => {
    const { html, text } = buildOrderReceiptEmail({
      orderId: 1234,
      firstName: "Amina",
      email: "amina@example.com",
      lineItems: [{ name: "Ultra Filter", quantity: 1, total: "4500" }],
      total: "4500",
      currency: "KES",
      paymentMethod: "mpesa",
      promoCode: "WATER10",
      discountAmount: 500,
    });
    assert.ok(html.includes("utm_campaign=water10"), "html must carry the UTM link");
    assert.ok(text.includes("utm_campaign=water10"), "text must carry the UTM link");
  });

  it("uses the plain store URL when there is no promo code", () => {
    const { html } = buildOrderReceiptEmail({
      orderId: 1235,
      firstName: "Amina",
      email: "amina@example.com",
      lineItems: [],
      total: "0",
      currency: "KES",
      paymentMethod: "cod",
    });
    assert.ok(!html.includes("utm_"), "no UTM parameters without a promo code");
  });
});

// ── receipt.json endpoint ─────────────────────────────────────────────────────

const TEST_EMAIL = "receipt-json-test-admin@ucfilters-test.internal";

describe("GET /api/uc/admin/orders/:id/receipt.json — structured receipt", () => {
  let testUserId: number;
  let orderId: number;

  before(async () => {
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: TEST_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "Receipt",
        lastName: "Test",
        isAdmin: false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert test user");
    testUserId = inserted.id;
    process.env["UC_ADMIN_EMAILS"] = TEST_EMAIL;

    const [order] = await db
      .insert(ucOrdersTable)
      .values({
        userId: String(testUserId),
        status: "processing",
        total: "8500",
        currency: "KES",
        paymentMethod: "mpesa",
        paymentReference: `RCPT-TEST-${Date.now()}`,
        mpesaReceipt: "SGB1KX2Q4P",
        promoCode: "WATER10",
        discountPercent: 10,
        discountAmount: 500,
        shippingAddress: {
          firstName: "Amina",
          lastName: "Otieno",
          address1: "12 Riverside Dr",
          city: "Nairobi",
          country: "KE",
          phone: "+254700000042",
        },
        webhookRecovery: false,
      })
      .returning({ id: ucOrdersTable.id });
    if (!order) throw new Error("Failed to insert test order");
    orderId = order.id;

    await db.insert(ucOrderItemsTable).values([
      { orderId, productId: 77, name: "Ultra Filter Pro", quantity: 1, total: "6000" },
      { orderId, productId: 88, name: "Replacement Cartridge", quantity: 2, total: "3000" },
    ]);
  });

  after(async () => {
    await db.delete(ucOrderItemsTable).where(eq(ucOrderItemsTable.orderId, orderId));
    await db.delete(ucOrdersTable).where(inArray(ucOrdersTable.id, [orderId]));
    await db.delete(ucUsersTable).where(eq(ucUsersTable.email, TEST_EMAIL));
  });

  it("rejects requests without admin auth (403)", async () => {
    const res = await apiFetch(`/api/uc/admin/orders/${orderId}/receipt.json`);
    assert.equal(res.status, 403);
  });

  it("returns 404 for an unknown order id", async () => {
    const res = await apiFetch(`/api/uc/admin/orders/999999999/receipt.json`, {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    assert.equal(res.status, 404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await apiFetch(`/api/uc/admin/orders/nope/receipt.json`, {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    assert.equal(res.status, 400);
  });

  it("returns the sectioned receipt with bookkeeping, inventory, crm, and marketing data", async () => {
    const res = await apiFetch(`/api/uc/admin/orders/${orderId}/receipt.json`, {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.text);

    assert.equal(body.format, "uc-receipt/v1");

    // receipt
    assert.equal(body.receipt.orderId, orderId);
    assert.match(body.receipt.serial, /^UC-\d{8}-\d{6}$/);
    assert.equal(body.receipt.status, "processing");
    assert.ok(!isNaN(Date.parse(body.receipt.orderDate)), "orderDate must be ISO");

    // bookkeeping
    assert.equal(body.bookkeeping.currency, "KES");
    assert.equal(body.bookkeeping.total, "8500");
    assert.equal(body.bookkeeping.subtotal, 9000);          // 8500 + 500 discount
    assert.equal(body.bookkeeping.discountAmount, 500);
    assert.equal(body.bookkeeping.paymentMethod, "mpesa");
    assert.equal(body.bookkeeping.mpesaReceipt, "SGB1KX2Q4P");

    // inventory
    assert.equal(body.inventory.lineItems.length, 2);
    assert.deepEqual(body.inventory.lineItems[0], {
      productId: 77, name: "Ultra Filter Pro", quantity: 1, lineTotal: "6000",
    });

    // crm
    assert.equal(body.crm.customerName, "Amina Otieno");
    assert.equal(body.crm.email, TEST_EMAIL);
    assert.equal(body.crm.phone, "+254700000042");
    assert.equal(body.crm.promoCode, "WATER10");

    // marketing
    assert.equal(body.marketing.utm.utm_campaign, "water10");
    assert.equal(
      body.marketing.utmQuery,
      "utm_source=uc-companion&utm_medium=promo-code&utm_campaign=water10",
    );
  });

  it("omits the CRM email for WooCommerce-principal user ids (no uc_users leak)", async () => {
    const [wooOrder] = await db
      .insert(ucOrdersTable)
      .values({
        userId: "1000000042",            // >= 1e9 → Woo principal, never a uc_users id
        status: "pending",
        total: "100",
        currency: "KES",
        paymentMethod: "cod",
        paymentReference: "",
      })
      .returning({ id: ucOrdersTable.id });
    try {
      const res = await apiFetch(`/api/uc/admin/orders/${wooOrder!.id}/receipt.json`, {
        headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
      });
      assert.equal(res.status, 200);
      const body = JSON.parse(res.text);
      assert.equal(body.crm.email, null);
    } finally {
      await db.delete(ucOrdersTable).where(eq(ucOrdersTable.id, wooOrder!.id));
    }
  });

  it("orders.csv includes the utm column populated from the promo code", async () => {
    const res = await apiFetch(`/api/uc/admin/orders.csv`, {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    assert.equal(res.status, 200);
    const [headerRow, ...rows] = res.text.trim().split("\r\n");
    const headerCells = headerRow!.split(",");
    assert.ok(headerCells.includes("utm"), "header must contain the utm column");
    // Legacy static columns must keep their historical positions (external
    // spreadsheet imports map by position) — new columns are appended after.
    assert.deepEqual(
      headerCells.slice(0, 9),
      ["id", "userId", "status", "dateCreated", "total", "currency",
       "paymentMethod", "paymentReference", "promoCode"],
      "original column order must be preserved for existing imports",
    );
    const ourRow = rows.find(r => r.startsWith(`${orderId},`));
    assert.ok(ourRow, "fixture order must be present in the CSV");
    assert.ok(
      ourRow!.includes("utm_source=uc-companion&utm_medium=promo-code&utm_campaign=water10"),
      "fixture row must carry the encoded UTM string",
    );
  });
});
