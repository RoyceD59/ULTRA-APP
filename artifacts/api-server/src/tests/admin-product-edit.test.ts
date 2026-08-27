/**
 * Tests for PATCH /api/uc/admin/products/:id — the admin "Edit product
 * details" endpoint that forwards a partial update to WooCommerce.
 *
 * Covers:
 *   - Admin gate: rejected with no token and with a non-admin token.
 *   - Invalid :id path param.
 *   - Per-field validation errors (name, description, shortDescription,
 *     regularPrice, salePrice, stockStatus, stockQuantity) and the
 *     "no editable fields" case.
 *   - Mock-mode acknowledgement when WC credentials are absent.
 *   - Partial-update forwarding to WooCommerce (mocked fetch): only the
 *     supplied fields are sent, camelCase -> WC snake_case mapping is
 *     correct, and upstream failure/network-error paths surface as 502.
 *
 * Strategy: real Express app + real DB-anchored admin user (isAdminRequest's
 * "uc_users account" path), matching push-token-rotation.test.ts. WooCommerce
 * is either absent (mock mode) or stubbed via globalThis.fetch (forwarding
 * mode) — never hits the real network.
 *
 * Note: this route uses `res.status(401).json({ error: "Unauthorized" })`
 * for a failed admin check (like the neighbouring inventory/media routes in
 * this file), not the 403 used by some other admin routes elsewhere in
 * uc.ts — these tests assert the endpoint's actual documented behaviour.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";
import { eq } from "drizzle-orm";

import { issueToken } from "../lib/jwt.js";
import { db, ucUsersTable } from "@workspace/db";

let server: http.Server;
let base: string;
let realFetch: typeof globalThis.fetch;

const TEST_PRODUCT_ID = 55501;

const ADMIN_EMAIL    = "admin-product-edit-test@ucfilters-test.internal";
const NON_ADMIN_EMAIL = "nonadmin-product-edit-test@ucfilters-test.internal";

let adminUserId: number;
let nonAdminUserId: number;

function bearerFor(id: number, email: string): string {
  return `Bearer ${issueToken({ id, email, firstName: "Test", lastName: "User" })}`;
}

async function patch(path: string, body: unknown, auth?: string) {
  const res = await realFetch(`${base}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-admin-product-edit-tests";

  // WC credentials are present in this dev/test environment via secrets —
  // strip them so the default state is "mock mode" and individual tests can
  // opt into WC forwarding explicitly.
  delete process.env["WC_CONSUMER_KEY"];
  delete process.env["WC_CONSUMER_SECRET"];

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
  base = `http://localhost:${(server.address() as { port: number }).port}/api`;
  realFetch = globalThis.fetch;

  const hash = await bcryptjs.hash("TestPass1!", 4);

  const [admin] = await db
    .insert(ucUsersTable)
    .values({ email: ADMIN_EMAIL, passwordHash: hash, firstName: "Admin", lastName: "Tester", isAdmin: true })
    .returning({ id: ucUsersTable.id });
  adminUserId = admin!.id;

  const [nonAdmin] = await db
    .insert(ucUsersTable)
    .values({ email: NON_ADMIN_EMAIL, passwordHash: hash, firstName: "Regular", lastName: "Tester", isAdmin: false })
    .returning({ id: ucUsersTable.id });
  nonAdminUserId = nonAdmin!.id;
});

after(async () => {
  globalThis.fetch = realFetch;
  delete process.env["WC_CONSUMER_KEY"];
  delete process.env["WC_CONSUMER_SECRET"];
  await db.delete(ucUsersTable).where(eq(ucUsersTable.id, adminUserId));
  await db.delete(ucUsersTable).where(eq(ucUsersTable.id, nonAdminUserId));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("PATCH /api/uc/admin/products/:id — admin gate", () => {
  it("rejects a request with no auth token", async () => {
    const { status } = await patch(`/uc/admin/products/${TEST_PRODUCT_ID}`, { name: "New name" });
    assert.equal(status, 401);
  });

  it("rejects a request from an authenticated non-admin user", async () => {
    const { status } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { name: "New name" },
      bearerFor(nonAdminUserId, NON_ADMIN_EMAIL),
    );
    assert.equal(status, 401);
  });

  it("rejects an invalid product id", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/not-a-number`,
      { name: "New name" },
      bearerFor(adminUserId, ADMIN_EMAIL),
    );
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /Invalid product id/);
  });
});

describe("PATCH /api/uc/admin/products/:id — validation", () => {
  const adminAuth = () => bearerFor(adminUserId, ADMIN_EMAIL);

  it("rejects an empty body (no editable fields)", async () => {
    const { status, json } = await patch(`/uc/admin/products/${TEST_PRODUCT_ID}`, {}, adminAuth());
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /No editable fields/);
  });

  it("rejects a blank name", async () => {
    const { status, json } = await patch(`/uc/admin/products/${TEST_PRODUCT_ID}`, { name: "   " }, adminAuth());
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /name/);
  });

  it("rejects a non-string description", async () => {
    const { status, json } = await patch(`/uc/admin/products/${TEST_PRODUCT_ID}`, { description: 12345 }, adminAuth());
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /description/);
  });

  it("rejects a non-string shortDescription", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { shortDescription: false },
      adminAuth(),
    );
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /shortDescription/);
  });

  it("rejects a non-numeric regularPrice", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { regularPrice: "not-a-price" },
      adminAuth(),
    );
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /regularPrice/);
  });

  it("rejects a negative regularPrice", async () => {
    const { status } = await patch(`/uc/admin/products/${TEST_PRODUCT_ID}`, { regularPrice: "-5" }, adminAuth());
    assert.equal(status, 400);
  });

  it("rejects an invalid (non-empty, non-numeric) salePrice", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { salePrice: "abc" },
      adminAuth(),
    );
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /salePrice/);
  });

  it("accepts an empty-string salePrice as 'clear the sale price'", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { salePrice: "" },
      adminAuth(),
    );
    assert.equal(status, 200);
    // `updated` reports the WooCommerce-mapped (snake_case) keys that were
    // actually sent upstream, not the caller's camelCase field names.
    assert.deepEqual((json as { updated: string[] }).updated, ["sale_price"]);
  });

  it("rejects an invalid stockStatus value", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { stockStatus: "backordered" },
      adminAuth(),
    );
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /stockStatus/);
  });

  it("rejects a negative stockQuantity", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { stockQuantity: -1 },
      adminAuth(),
    );
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /stockQuantity/);
  });

  it("rejects a non-integer stockQuantity", async () => {
    const { status } = await patch(`/uc/admin/products/${TEST_PRODUCT_ID}`, { stockQuantity: 4.5 }, adminAuth());
    assert.equal(status, 400);
  });
});

describe("PATCH /api/uc/admin/products/:id — mock mode (no WC credentials)", () => {
  it("acknowledges the update without contacting WooCommerce", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { name: "Mock Mode Filter", stockQuantity: 12 },
      bearerFor(adminUserId, ADMIN_EMAIL),
    );
    assert.equal(status, 200);
    const body = json as { ok: boolean; productId: number; updated: string[]; source: string };
    assert.equal(body.ok, true);
    assert.equal(body.productId, TEST_PRODUCT_ID);
    assert.equal(body.source, "mock");
    // `updated` reports the WooCommerce-mapped (snake_case) keys, and
    // stockQuantity implicitly turns on manage_stock as a second key.
    assert.deepEqual(body.updated.sort(), ["manage_stock", "name", "stock_quantity"].sort());
  });
});

describe("PATCH /api/uc/admin/products/:id — WooCommerce forwarding", () => {
  const adminAuth = () => bearerFor(adminUserId, ADMIN_EMAIL);

  before(() => {
    process.env["WC_CONSUMER_KEY"] = "test-wc-key";
    process.env["WC_CONSUMER_SECRET"] = "test-wc-secret";
    process.env["WC_BASE_URL"] = "https://product-edit-forwarding.test";
  });

  after(() => {
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];
    delete process.env["WC_BASE_URL"];
    globalThis.fetch = realFetch;
  });

  it("forwards only the supplied fields, mapped to WooCommerce's snake_case shape", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "";
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ id: TEST_PRODUCT_ID, name: "Forwarded Filter" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { stockQuantity: 7 }, // partial update: only one field supplied
      adminAuth(),
    );
    assert.equal(status, 200);
    const body = json as { ok: boolean; source: string; updated: string[] };
    assert.equal(body.ok, true);
    assert.equal(body.source, "woocommerce");
    // stockQuantity implicitly forwards manage_stock as a second WC key.
    assert.deepEqual(body.updated.sort(), ["manage_stock", "stock_quantity"].sort());

    assert.equal(capturedMethod, "PUT");
    assert.ok(capturedUrl.includes(`/products/${TEST_PRODUCT_ID}`));
    assert.deepEqual(capturedBody, { stock_quantity: 7, manage_stock: true });
  });

  it("forwards multiple fields together with correct key mapping", async () => {
    let capturedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ id: TEST_PRODUCT_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const { status } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      {
        name: "Renamed Filter",
        shortDescription: "Short blurb",
        regularPrice: "19.99",
        stockStatus: "outofstock",
      },
      adminAuth(),
    );

    assert.equal(status, 200);
    assert.deepEqual(capturedBody, {
      name: "Renamed Filter",
      short_description: "Short blurb",
      regular_price: "19.99",
      stock_status: "outofstock",
    });
  });

  it("returns 502 when WooCommerce responds with a failure status", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ message: "Invalid product ID." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { name: "Doesn't matter" },
      adminAuth(),
    );

    assert.equal(status, 502);
    assert.match((json as { error: string }).error, /WooCommerce update failed/);
  });

  it("returns 502 when WooCommerce is unreachable", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED (test)");
    }) as typeof fetch;

    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { name: "Doesn't matter" },
      adminAuth(),
    );

    assert.equal(status, 502);
    assert.match((json as { error: string }).error, /Failed to reach WooCommerce/);
  });
});
