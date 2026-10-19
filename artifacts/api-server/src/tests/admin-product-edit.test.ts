/**
 * Tests for PATCH /api/uc/admin/products/:id — the admin "Edit product
 * details" endpoint backed by the shared app-owned catalogue.
 *
 * Covers:
 *   - Admin gate: rejected with no token and with a non-admin token.
 *   - Invalid :id path param.
 *   - Per-field validation errors (name, description, shortDescription,
 *     regularPrice, salePrice, stockStatus, stockQuantity) and the
 *     "no editable fields" case.
 *   - Durable partial updates independent of retired Woo credentials,
 *     including a provider outage, and no phantom success for unknown IDs.
 *
 * Strategy: real Express app + real DB-anchored admin user (isAdminRequest's
 * "uc_users account" path), matching push-token-rotation.test.ts. WooCommerce
 * is either absent (mock mode) or stubbed via globalThis.fetch (forwarding
 * mode) — never hits the real network.
 *
 * The app-owned management route denies non-admin access with HTTP 403.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";
import { eq } from "drizzle-orm";

import { issueToken } from "../lib/jwt.js";
import { db, pool, ucUsersTable } from "@workspace/db";
import { appCatalogueFixture } from "./helpers/app-catalogue.js";

let server: http.Server;
let base: string;
let realFetch: typeof globalThis.fetch;

let TEST_PRODUCT_ID: number;

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
  TEST_PRODUCT_ID = (await appCatalogueFixture()).id;

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
    assert.equal(status, 403);
  });

  it("rejects a request from an authenticated non-admin user", async () => {
    const { status } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { name: "New name" },
      bearerFor(nonAdminUserId, NON_ADMIN_EMAIL),
    );
    assert.equal(status, 403);
  });

  it("rejects an invalid product id", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/not-a-number`,
      { name: "New name" },
      bearerFor(adminUserId, ADMIN_EMAIL),
    );
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /Invalid product update/);
  });
});

describe("PATCH /api/uc/admin/products/:id — validation", () => {
  const adminAuth = () => bearerFor(adminUserId, ADMIN_EMAIL);

  it("rejects an empty body (no editable fields)", async () => {
    const { status, json } = await patch(`/uc/admin/products/${TEST_PRODUCT_ID}`, {}, adminAuth());
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /Invalid product update/);
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
    assert.match((json as { error: string }).error, /Price/);
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
    assert.match((json as { error: string }).error, /managed promotions/);
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
    assert.deepEqual((json as { updated: string[] }).updated, ["salePrice"]);
  });

  it("rejects an invalid stockStatus value", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { stockStatus: "backordered" },
      adminAuth(),
    );
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /stock status/i);
  });

  it("rejects a negative stockQuantity", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { stockQuantity: -1 },
      adminAuth(),
    );
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /Stock/);
  });

  it("rejects a non-integer stockQuantity", async () => {
    const { status } = await patch(`/uc/admin/products/${TEST_PRODUCT_ID}`, { stockQuantity: 4.5 }, adminAuth());
    assert.equal(status, 400);
  });
});

describe("PATCH /api/uc/admin/products/:id — app-owned persistence", () => {
  it("persists the update without contacting WooCommerce", async () => {
    const { status, json } = await patch(
      `/uc/admin/products/${TEST_PRODUCT_ID}`,
      { name: "Mock Mode Filter", stockQuantity: 12 },
      bearerFor(adminUserId, ADMIN_EMAIL),
    );
    assert.equal(status, 200);
    const body = json as { ok: boolean; productId: number; updated: string[]; source: string };
    assert.equal(body.ok, true);
    assert.equal(body.productId, TEST_PRODUCT_ID);
    assert.equal(body.source, "companion");
    // `updated` reports the WooCommerce-mapped (snake_case) keys, and
    // stockQuantity implicitly turns on manage_stock as a second key.
    assert.deepEqual(body.updated.sort(), ["name", "stockQuantity"].sort());
    const row = (await pool.query("SELECT stock_quantity,manage_stock FROM uc_catalogue_inventory WHERE id=$1", [TEST_PRODUCT_ID])).rows[0];
    assert.equal(row.stock_quantity,12); assert.equal(row.manage_stock,true);
  });
});

describe("PATCH /api/uc/admin/products/:id — retired Woo independence", () => {
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

  it("writes only supplied app fields without forwarding to WooCommerce", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (!String(input).includes("/wp-json/wc/")) return Response.json({ keys: [] });
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
    assert.equal(body.source, "companion");
    // stockQuantity implicitly forwards manage_stock as a second WC key.
    assert.deepEqual(body.updated, ["stockQuantity"]);

    assert.equal(capturedMethod, "");
    assert.equal(capturedUrl, "");
    assert.equal(capturedBody, null);
    assert.equal((await pool.query("SELECT stock_quantity FROM uc_catalogue_inventory WHERE id=$1", [TEST_PRODUCT_ID])).rows[0].stock_quantity,7);
  });

  it("persists multiple fields together in the shared authored record", async () => {
    let capturedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (!String(_input).includes("/wp-json/wc/")) return Response.json({ keys: [] });
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
        stockStatus: "onbackorder",
      },
      adminAuth(),
    );

    assert.equal(status, 200);
    assert.equal(capturedBody,null);
    const record = (await pool.query(`SELECT p.record FROM uc_product_editorial p
      JOIN uc_catalogue_inventory i USING(code) WHERE i.id=$1`, [TEST_PRODUCT_ID])).rows[0].record;
    assert.equal(record.name,"Renamed Filter");
    assert.equal(record.seo.h1_sub,"Short blurb");
    assert.equal(record.price_kes,19.99);
    assert.equal(record.ownership.product_price_kes,19.99);
  });

  it("still saves app-owned content when WooCommerce would return a failure", async () => {
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

    assert.equal(status, 200);
    assert.equal((json as { source: string }).source,"companion");
  });

  it("returns 404 for an unknown app product without trying an external fallback", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED (test)");
    }) as typeof fetch;

    const { status, json } = await patch(
      `/uc/admin/products/987654321`,
      { name: "Doesn't matter" },
      adminAuth(),
    );

    assert.equal(status, 404);
    assert.match((json as { error: string }).error, /App product not found/);
  });
});
