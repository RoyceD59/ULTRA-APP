/**
 * Tests for GET /api/uc/customer/data-export (GDPR Art. 20 / PDPA portability).
 *
 * Covers:
 *   1. 401 when unauthenticated.
 *   2. 200 with attachment headers for a registered user.
 *   3. Category coverage — profile, orders, tickets, waterTests, enquiries,
 *      reviews, notificationPreferences, pushRegistrations are all present.
 *   4. Ownership isolation — user A's export never contains user B's data.
 *
 * Uses the real DB (same pattern as orders-csv-export.test.ts).
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
import {
  db,
  ucUsersTable,
  ucReviewsTable,
  ucNotifPrefsTable,
  ucPushTokensTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-data-export-tests";
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

function authHeader(user: { id: number; email: string }) {
  return `Bearer ${issueToken({ id: user.id, email: user.email, firstName: "Export", lastName: "Test" })}`;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const stamp = Date.now();
let userA: { id: number; email: string };
let userB: { id: number; email: string };
const createdReviewIds: number[] = [];
const createdUserIds: number[] = [];

before(async () => {
  const [a] = await db.insert(ucUsersTable).values({
    email:        `export-a-${stamp}@test.local`,
    passwordHash: "x",
    firstName:    "Alice",
    lastName:     "Export",
    phone:        "+254700000001",
  }).returning();
  const [b] = await db.insert(ucUsersTable).values({
    email:        `export-b-${stamp}@test.local`,
    passwordHash: "x",
    firstName:    "Bob",
    lastName:     "Other",
    phone:        "+254700000002",
  }).returning();
  userA = { id: a.id, email: a.email };
  userB = { id: b.id, email: b.email };
  createdUserIds.push(a.id, b.id);

  const reviews = await db.insert(ucReviewsTable).values([
    { productId: 1, userId: String(a.id), authorName: "Alice", rating: 5, title: "A-review", body: `alice-review-${stamp}` },
    { productId: 1, userId: String(b.id), authorName: "Bob",   rating: 2, title: "B-review", body: `bob-review-${stamp}` },
  ]).returning();
  createdReviewIds.push(...reviews.map(r => r.id));

  await db.insert(ucNotifPrefsTable).values({ userId: String(a.id), optOutOrders: true });
  await db.insert(ucPushTokensTable).values({ userId: String(a.id), pushToken: `ExponentPushToken[test-${stamp}]` });
});

after(async () => {
  if (createdReviewIds.length) await db.delete(ucReviewsTable).where(inArray(ucReviewsTable.id, createdReviewIds));
  for (const uid of createdUserIds) {
    await db.delete(ucNotifPrefsTable).where(eq(ucNotifPrefsTable.userId, String(uid)));
    await db.delete(ucPushTokensTable).where(eq(ucPushTokensTable.userId, String(uid)));
  }
  if (createdUserIds.length) await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, createdUserIds));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/uc/customer/data-export", () => {
  it("returns 401 when unauthenticated", async () => {
    const { status } = await apiFetch("/api/uc/customer/data-export");
    assert.equal(status, 401);
  });

  it("returns a downloadable JSON export with all data categories", async () => {
    const { status, headers, text } = await apiFetch("/api/uc/customer/data-export", {
      headers: { Authorization: authHeader(userA) },
    });
    assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
    assert.match(headers.get("content-type") ?? "", /application\/json/);
    assert.match(headers.get("content-disposition") ?? "", /attachment; filename="ultra-clear-data-export-/);

    const payload = JSON.parse(text) as Record<string, unknown>;
    for (const key of [
      "profile", "orders", "tickets", "waterTests", "enquiries",
      "reviews", "notificationPreferences", "pushRegistrations", "referrals",
    ]) {
      assert.ok(key in payload, `export must include the "${key}" category`);
    }

    assert.match(String(payload["format"]), /v2/, "export format version must be v2");

    const referrals = payload["referrals"] as Record<string, unknown>;
    for (const key of ["code", "referredCount", "conversions", "creditsEarnedKes", "usedReferralCode"]) {
      assert.ok(key in referrals, `referrals section must include "${key}"`);
    }

    const profile = payload["profile"] as { id: number; email: string };
    assert.equal(profile.id, userA.id);
    assert.equal(profile.email, userA.email);

    const reviews = payload["reviews"] as Array<{ body: string }>;
    assert.ok(reviews.some(r => r.body === `alice-review-${stamp}`), "user A's review must be included");

    const prefs = payload["notificationPreferences"] as Array<{ optOutOrderUpdates: boolean }>;
    assert.equal(prefs.length, 1);
    assert.equal(prefs[0]!.optOutOrderUpdates, true);

    const pushRegs = payload["pushRegistrations"] as Array<{ pushToken: string }>;
    assert.equal(pushRegs.length, 1);
    assert.equal(pushRegs[0]!.pushToken, `ExponentPushToken[test-${stamp}]`);
  });

  it("exports WooCommerce orders scoped to the customer's email when WC is configured", async () => {
    const saved = {
      key:    process.env["WC_CONSUMER_KEY"],
      secret: process.env["WC_CONSUMER_SECRET"],
      base:   process.env["WC_BASE_URL"],
    };
    const origFetch = globalThis.fetch;
    try {
      process.env["WC_CONSUMER_KEY"]    = "test_wc_key_export";
      process.env["WC_CONSUMER_SECRET"] = "test_wc_secret_export";
      process.env["WC_BASE_URL"]        = "https://wc-export.test";

      globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://wc-export.test/wp-json/wc/v3/orders")) {
          return new Response(JSON.stringify([
            {
              id: 9001, status: "completed", date_created: "2026-08-01T10:00:00",
              total: "4500", currency: "KES", payment_method: "mpesa",
              billing: { email: userA.email },
              shipping: { address_1: "1 Test Lane" },
              line_items: [{ product_id: 3, name: "Ultra Clear Filter", quantity: 1, total: "4500" }],
            },
            {
              id: 9002, status: "completed", date_created: "2026-08-02T10:00:00",
              total: "999", currency: "KES", payment_method: "cod",
              billing: { email: userB.email },
              shipping: {},
              line_items: [],
            },
          ]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return origFetch(input, init);
      }) as typeof fetch;

      const { status, text } = await apiFetch("/api/uc/customer/data-export", {
        headers: { Authorization: authHeader(userA) },
      });
      assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
      const payload = JSON.parse(text) as { orders: Array<{ id: number; lineItems: Array<{ name: string }> }> };
      assert.equal(payload.orders.length, 1, "only the customer's own WooCommerce order must be exported");
      assert.equal(payload.orders[0]!.id, 9001);
      assert.equal(payload.orders[0]!.lineItems[0]!.name, "Ultra Clear Filter");
      assert.ok(!text.includes("9002"), "another customer's order must not appear");
    } finally {
      globalThis.fetch = origFetch;
      if (saved.key    !== undefined) process.env["WC_CONSUMER_KEY"]    = saved.key;    else delete process.env["WC_CONSUMER_KEY"];
      if (saved.secret !== undefined) process.env["WC_CONSUMER_SECRET"] = saved.secret; else delete process.env["WC_CONSUMER_SECRET"];
      if (saved.base   !== undefined) process.env["WC_BASE_URL"]        = saved.base;   else delete process.env["WC_BASE_URL"];
    }
  });

  it("follows WooCommerce pagination so >100 orders are exported completely", async () => {
    const saved = {
      key:    process.env["WC_CONSUMER_KEY"],
      secret: process.env["WC_CONSUMER_SECRET"],
      base:   process.env["WC_BASE_URL"],
    };
    const origFetch = globalThis.fetch;
    try {
      process.env["WC_CONSUMER_KEY"]    = "test_wc_key_paged";
      process.env["WC_CONSUMER_SECRET"] = "test_wc_secret_paged";
      process.env["WC_BASE_URL"]        = "https://wc-paged.test";

      const makeOrder = (id: number) => ({
        id, status: "completed", date_created: "2026-08-01T10:00:00",
        total: "100", currency: "KES", payment_method: "mpesa",
        billing: { email: userA.email }, shipping: {},
        line_items: [],
      });

      globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://wc-paged.test/wp-json/wc/v3/orders")) {
          const page = Number(new URL(url).searchParams.get("page") ?? "1");
          const body =
            page === 1 ? Array.from({ length: 100 }, (_, i) => makeOrder(10000 + i))
            : page === 2 ? [makeOrder(10100), makeOrder(10101)]
            : [];
          return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return origFetch(input, init);
      }) as typeof fetch;

      const { status, text } = await apiFetch("/api/uc/customer/data-export", {
        headers: { Authorization: authHeader(userA) },
      });
      assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
      const payload = JSON.parse(text) as { orders: Array<{ id: number }> };
      assert.equal(payload.orders.length, 102, "all pages of WooCommerce orders must be exported");
      assert.ok(payload.orders.some(o => o.id === 10101), "orders from the second page must be included");
    } finally {
      globalThis.fetch = origFetch;
      if (saved.key    !== undefined) process.env["WC_CONSUMER_KEY"]    = saved.key;    else delete process.env["WC_CONSUMER_KEY"];
      if (saved.secret !== undefined) process.env["WC_CONSUMER_SECRET"] = saved.secret; else delete process.env["WC_CONSUMER_SECRET"];
      if (saved.base   !== undefined) process.env["WC_BASE_URL"]        = saved.base;   else delete process.env["WC_BASE_URL"];
    }
  });

  it("fails loudly (502) when WooCommerce is configured but unreachable", async () => {
    const saved = {
      key:    process.env["WC_CONSUMER_KEY"],
      secret: process.env["WC_CONSUMER_SECRET"],
      base:   process.env["WC_BASE_URL"],
    };
    const origFetch = globalThis.fetch;
    try {
      process.env["WC_CONSUMER_KEY"]    = "test_wc_key_down";
      process.env["WC_CONSUMER_SECRET"] = "test_wc_secret_down";
      process.env["WC_BASE_URL"]        = "https://wc-down.test";
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://wc-down.test/")) throw new Error("connection refused");
        return origFetch(input, init);
      }) as typeof fetch;

      const { status } = await apiFetch("/api/uc/customer/data-export", {
        headers: { Authorization: authHeader(userA) },
      });
      assert.equal(status, 502, "export must not silently omit orders when the order system is down");
    } finally {
      globalThis.fetch = origFetch;
      if (saved.key    !== undefined) process.env["WC_CONSUMER_KEY"]    = saved.key;    else delete process.env["WC_CONSUMER_KEY"];
      if (saved.secret !== undefined) process.env["WC_CONSUMER_SECRET"] = saved.secret; else delete process.env["WC_CONSUMER_SECRET"];
      if (saved.base   !== undefined) process.env["WC_BASE_URL"]        = saved.base;   else delete process.env["WC_BASE_URL"];
    }
  });

  it("never includes another user's data (ownership isolation)", async () => {
    const { status, text } = await apiFetch("/api/uc/customer/data-export", {
      headers: { Authorization: authHeader(userA) },
    });
    assert.equal(status, 200);
    assert.ok(!text.includes(`bob-review-${stamp}`), "user B's review must not leak into user A's export");
    assert.ok(!text.includes(userB.email), "user B's email must not leak into user A's export");
  });
});
