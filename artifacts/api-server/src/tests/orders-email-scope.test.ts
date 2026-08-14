/**
 * GET /uc/orders — WooCommerce path authorization tests.
 *
 * Woo's /orders endpoint is store-wide; the route must never return another
 * customer's orders. These tests stub the Woo fetch to return a mixed list
 * and assert:
 *
 *   1. Each authenticated user only ever sees orders whose billing email
 *      matches their own account (two users on one device / store).
 *   2. A user whose own purchase is NOT the store's newest order still gets
 *      exactly their own order — never the newer order of someone else.
 *   3. An unauthenticated request receives an empty list, not store data.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";

import app from "../app.js";
import { db, ucUsersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

let realFetch: typeof globalThis.fetch;
let server:    http.Server;
let base:      string;

const createdUserIds: number[] = [];

async function createTestUser(suffix: string): Promise<{ id: number; email: string; jwt: string }> {
  const email = `oscope-${suffix}-${Date.now()}@uctest.internal`;
  const hash  = await bcryptjs.hash("Test1234!", 4);
  const [row] = await db
    .insert(ucUsersTable)
    .values({ email, passwordHash: hash, firstName: "Scope", lastName: "Tester", phone: "+254711000002" })
    .returning({ id: ucUsersTable.id });
  const id = row!.id;
  createdUserIds.push(id);

  const loginRes = await realFetch(`${base}/uc/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, password: "Test1234!" }),
  });
  assert.equal(loginRes.status, 200, `login must succeed (${suffix})`);
  const { token } = (await loginRes.json()) as { token?: string };
  assert.ok(token, "login response must contain a token");
  return { id, email, jwt: token! };
}

function wooOrder(id: number, billingEmail: string, dateCreated: string, productId: number, name: string) {
  return {
    id,
    status:         "completed",
    date_created:   dateCreated,
    total:          "4999",
    currency:       "KES",
    payment_method: "paystack",
    billing:        { email: billingEmail },
    shipping:       {},
    line_items:     [{ product_id: productId, name, quantity: 1, total: "4999" }],
  };
}

async function getOrders(jwt?: string): Promise<{ status: number; body: unknown[] }> {
  const res = await realFetch(`${base}/uc/orders`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  });
  const body = (await res.json()) as unknown[];
  return { status: res.status, body };
}

before(
  async () => {
    realFetch = globalThis.fetch;
    process.env["SESSION_SECRET"] ??= "test-secret-orders-email-scope";
    await new Promise<void>((resolve, reject) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") { reject(new Error("No address")); return; }
        base = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    });
  },
  { timeout: 30_000 },
);

after(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, createdUserIds)).catch(() => {});
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = realFetch;
});

describe("GET /uc/orders — WooCommerce orders are scoped to the bearer's email", () => {
  it("returns only the authenticated user's orders even when the store's newest order belongs to someone else", async () => {
    const alice = await createTestUser("alice");
    const bob   = await createTestUser("bob");

    const savedKey    = process.env["WC_CONSUMER_KEY"];
    const savedSecret = process.env["WC_CONSUMER_SECRET"];
    const savedBase   = process.env["WC_BASE_URL"];
    try {
      process.env["WC_CONSUMER_KEY"]    = "test_wc_key";
      process.env["WC_CONSUMER_SECRET"] = "test_wc_secret";
      process.env["WC_BASE_URL"]        = "https://wc.test";

      // Store-wide list: Bob's order is the newest; Alice's older order is
      // further down; a third stranger's order is also present. The stub
      // deliberately ignores the `search` param to simulate Woo's fuzzy
      // matching returning unrelated rows — the route's strict billing-email
      // filter must be the authorization boundary.
      const storeOrders = [
        wooOrder(9103, bob.email,              "2026-08-13T10:00:00", 8574, "Wireless Dispenser Filter"),
        wooOrder(9102, "stranger@example.com", "2026-08-12T10:00:00", 12,   "Counter Reverse Osmosis"),
        wooOrder(9101, alice.email,            "2026-08-01T10:00:00", 8574, "Wireless Dispenser Filter"),
      ];

      globalThis.fetch = async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("wc.test") && u.includes("/orders") && (!init?.method || init.method === "GET")) {
          return new Response(JSON.stringify(storeOrders), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }
        return realFetch(url as string, init);
      };

      // Alice: only her (older, not store-newest) order.
      const aliceRes = await getOrders(alice.jwt);
      assert.equal(aliceRes.status, 200);
      assert.equal(aliceRes.body.length, 1, "Alice must get exactly her own order");
      assert.equal((aliceRes.body[0] as { id: number }).id, 9101);

      // Bob (account switch on the same store): only his order.
      const bobRes = await getOrders(bob.jwt);
      assert.equal(bobRes.status, 200);
      assert.equal(bobRes.body.length, 1, "Bob must get exactly his own order");
      assert.equal((bobRes.body[0] as { id: number }).id, 9103);

      // No token: never expose store-wide data.
      const anonRes = await getOrders();
      assert.equal(anonRes.status, 200);
      assert.deepEqual(anonRes.body, [], "unauthenticated callers must get an empty list");
    } finally {
      globalThis.fetch = realFetch;
      if (savedKey    !== undefined) process.env["WC_CONSUMER_KEY"]    = savedKey;    else delete process.env["WC_CONSUMER_KEY"];
      if (savedSecret !== undefined) process.env["WC_CONSUMER_SECRET"] = savedSecret; else delete process.env["WC_CONSUMER_SECRET"];
      if (savedBase   !== undefined) process.env["WC_BASE_URL"]        = savedBase;   else delete process.env["WC_BASE_URL"];
    }
  });
});
