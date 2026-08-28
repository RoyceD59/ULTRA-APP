/**
 * Tests for the Companion wishlist endpoints:
 *   GET    /api/uc/wishlist
 *   POST   /api/uc/wishlist
 *   DELETE /api/uc/wishlist/:productId
 *
 * Covers:
 *   - Unauthenticated access is rejected on all three routes.
 *   - POST validates productId / productName.
 *   - POST adds a product, GET returns it.
 *   - A duplicate POST for the same (user, product) upserts rather than
 *     creating a second row (idempotency), and updates the cached name.
 *   - DELETE removes the product; a subsequent GET no longer includes it.
 *
 * Strategy: spin up the real Express app against the isolated test DB (same
 * pattern as push-token-rotation.test.ts) and authenticate with a real JWT
 * issued via issueToken(). No WooCommerce or push I/O is exercised by these
 * routes, so no stubbing is required.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
import { db, teamUsersTable, ucWishlistTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

let server: http.Server;
let base: string;

const USER_ID    = "998877701";
const OTHER_USER_ID = "998877702";
const USER_EMAIL = "wishlist-test@ucfilters-test.internal";

const TEST_PRODUCT_ID = 887702;
const TEST_PRODUCT_NAME = "Wishlist Test Filter";
const ADMIN_ID = "wishlist-test-admin";
const DEMAND_PRODUCT_ID = 887703;
const DEMAND_PRODUCT_NAME = "Demand Test Filter";

function bearerFor(id: string): string {
  return `Bearer ${issueToken({ id: Number(id), email: USER_EMAIL, firstName: "Wish", lastName: "List" })}`;
}

function adminBearer(): string {
  return `Bearer ${issueToken({
    id: ADMIN_ID,
    email: "wishlist-admin@ucfilters-test.internal",
    type: "team-session",
    role: "admin",
  })}`;
}

async function get(path: string, auth?: string) {
  const res = await fetch(`${base}${path}`, {
    headers: auth ? { Authorization: auth } : {},
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function post(path: string, body: unknown, auth?: string) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function del(path: string, auth?: string) {
  const res = await fetch(`${base}${path}`, {
    method: "DELETE",
    headers: auth ? { Authorization: auth } : {},
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-wishlist-route-tests";
  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
  base = `http://localhost:${(server.address() as { port: number }).port}/api`;

  await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, [USER_ID, OTHER_USER_ID]));
  await db.insert(teamUsersTable).values({
    id: ADMIN_ID,
    email: "wishlist-admin@ucfilters-test.internal",
    name: "Wishlist Admin",
    passwordHash: "x",
    role: "admin",
    isActive: true,
  });
});

after(async () => {
  await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, [USER_ID, OTHER_USER_ID]));
  await db.delete(teamUsersTable).where(eq(teamUsersTable.id, ADMIN_ID));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("Wishlist endpoints — authentication", () => {
  it("GET /uc/wishlist requires authentication", async () => {
    const { status, json } = await get("/uc/wishlist");
    assert.equal(status, 401);
    assert.equal((json as { error: string }).error, "Authentication required");
  });

  it("POST /uc/wishlist requires authentication", async () => {
    const { status } = await post("/uc/wishlist", { productId: TEST_PRODUCT_ID, productName: TEST_PRODUCT_NAME });
    assert.equal(status, 401);
  });

  it("DELETE /uc/wishlist/:productId requires authentication", async () => {
    const { status } = await del(`/uc/wishlist/${TEST_PRODUCT_ID}`);
    assert.equal(status, 401);
  });
});

describe("Wishlist endpoints — validation", () => {
  it("POST rejects a missing productId", async () => {
    const { status, json } = await post("/uc/wishlist", { productName: TEST_PRODUCT_NAME }, bearerFor(USER_ID));
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /productId/);
  });

  it("POST rejects a non-numeric productId", async () => {
    const { status } = await post(
      "/uc/wishlist",
      { productId: "not-a-number", productName: TEST_PRODUCT_NAME },
      bearerFor(USER_ID),
    );
    assert.equal(status, 400);
  });

  it("POST rejects a missing productName", async () => {
    const { status, json } = await post("/uc/wishlist", { productId: TEST_PRODUCT_ID }, bearerFor(USER_ID));
    assert.equal(status, 400);
    assert.match((json as { error: string }).error, /productName/);
  });

  it("POST rejects a blank productName", async () => {
    const { status } = await post(
      "/uc/wishlist",
      { productId: TEST_PRODUCT_ID, productName: "   " },
      bearerFor(USER_ID),
    );
    assert.equal(status, 400);
  });
});

describe("Wishlist endpoints — add / list / duplicate / remove", () => {
  it("returns an empty wishlist for a user with no items", async () => {
    const { status, json } = await get("/uc/wishlist", bearerFor(USER_ID));
    assert.equal(status, 200);
    assert.deepEqual(json, []);
  });

  it("POST adds a product to the wishlist", async () => {
    const { status, json } = await post(
      "/uc/wishlist",
      { productId: TEST_PRODUCT_ID, productName: TEST_PRODUCT_NAME },
      bearerFor(USER_ID),
    );
    assert.equal(status, 201);
    const body = json as { productId: number; productName: string; addedAt: string };
    assert.equal(body.productId, TEST_PRODUCT_ID);
    assert.equal(body.productName, TEST_PRODUCT_NAME);
    assert.ok(body.addedAt);
  });

  it("GET returns the newly added product", async () => {
    const { status, json } = await get("/uc/wishlist", bearerFor(USER_ID));
    assert.equal(status, 200);
    const items = json as Array<{ productId: number; productName: string; notifiedRestockAt: unknown }>;
    assert.equal(items.length, 1);
    assert.equal(items[0]!.productId, TEST_PRODUCT_ID);
    assert.equal(items[0]!.notifiedRestockAt, null);
  });

  it("a duplicate POST for the same product upserts instead of duplicating (idempotency)", async () => {
    const { status, json } = await post(
      "/uc/wishlist",
      { productId: TEST_PRODUCT_ID, productName: "Wishlist Test Filter (renamed)" },
      bearerFor(USER_ID),
    );
    assert.equal(status, 201);
    assert.equal((json as { productName: string }).productName, "Wishlist Test Filter (renamed)");

    const rows = await db
      .select()
      .from(ucWishlistTable)
      .where(eq(ucWishlistTable.userId, USER_ID));
    assert.equal(rows.length, 1, "duplicate add must not create a second row");
    assert.equal(rows[0]!.productName, "Wishlist Test Filter (renamed)", "cached name must be refreshed");
  });

  it("the wishlist is scoped per user — another user's wishlist stays empty", async () => {
    const { json } = await get("/uc/wishlist", bearerFor(OTHER_USER_ID));
    assert.deepEqual(json, []);
  });

  it("DELETE rejects a non-numeric productId", async () => {
    const { status } = await del("/uc/wishlist/not-a-number", bearerFor(USER_ID));
    assert.equal(status, 400);
  });

  it("DELETE removes the product from the wishlist", async () => {
    const { status, json } = await del(`/uc/wishlist/${TEST_PRODUCT_ID}`, bearerFor(USER_ID));
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true });
  });

  it("GET no longer returns the removed product", async () => {
    const { json } = await get("/uc/wishlist", bearerFor(USER_ID));
    assert.deepEqual(json, []);
  });

  it("DELETE of an already-removed product is a harmless no-op", async () => {
    const { status, json } = await del(`/uc/wishlist/${TEST_PRODUCT_ID}`, bearerFor(USER_ID));
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true });
  });
});

describe("GET /uc/admin/inventory/wishlist-demand", () => {
  it("requires admin authentication", async () => {
    const { status } = await get("/uc/admin/inventory/wishlist-demand");
    assert.equal(status, 401);
  });

  it("groups waiting customers and reports pending versus notified rows", async () => {
    const notifiedAt = new Date("2026-08-26T10:00:00.000Z");
    await db.insert(ucWishlistTable).values([
      {
        userId: USER_ID,
        productId: DEMAND_PRODUCT_ID,
        productName: DEMAND_PRODUCT_NAME,
        notifiedRestockAt: null,
      },
      {
        userId: OTHER_USER_ID,
        productId: DEMAND_PRODUCT_ID,
        productName: DEMAND_PRODUCT_NAME,
        notifiedRestockAt: notifiedAt,
      },
      {
        userId: OTHER_USER_ID,
        productId: TEST_PRODUCT_ID,
        productName: TEST_PRODUCT_NAME,
        notifiedRestockAt: notifiedAt,
      },
    ]);

    const { status, json } = await get("/uc/admin/inventory/wishlist-demand", adminBearer());
    assert.equal(status, 200);
    const rows = json as Array<{
      productId: number;
      productName: string;
      waitingCustomerCount: number;
      pendingCustomerCount: number;
      notifiedCustomerCount: number;
      lastNotifiedRestockAt: string;
    }>;
    const demand = rows.find((row) => row.productId === DEMAND_PRODUCT_ID);
    assert.ok(demand);
    assert.equal(demand.productName, DEMAND_PRODUCT_NAME);
    assert.equal(demand.waitingCustomerCount, 2);
    assert.equal(demand.pendingCustomerCount, 1);
    assert.equal(demand.notifiedCustomerCount, 1);
    assert.equal(new Date(demand.lastNotifiedRestockAt).toISOString(), notifiedAt.toISOString());

    await db.delete(ucWishlistTable).where(
      inArray(ucWishlistTable.productId, [DEMAND_PRODUCT_ID, TEST_PRODUCT_ID]),
    );
  });
});
