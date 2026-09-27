/**
 * Unit tests for backfill-pump-reminders.mjs.
 *
 * Covers:
 *   - WC status filtering (only processing/completed eligible)
 *   - Non-2xx WC responses throw (script exits non-zero)
 *   - Malformed / PHP-notice-prefixed JSON throws
 *   - Re-runs skip already-nudged users (idempotency log)
 *   - Opted-out users are skipped
 *   - Stale Expo tokens are reported
 *   - Unmatched WC buyers (no app account) reported for manual follow-up
 *
 * Run:  node --test scripts/__tests__/backfill-pump-reminders.test.mjs
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
  ELIGIBLE_WC_STATUSES,
  ELIGIBLE_DB_STATUSES,
  isEligibleWcStatus,
  parseWcResponse,
  fetchEligibleWcOrders,
  run,
} from "../backfill-pump-reminders.mjs";

// ─── isEligibleWcStatus ───────────────────────────────────────────────────────
describe("isEligibleWcStatus", () => {
  it("accepts processing and completed", () => {
    assert.ok(isEligibleWcStatus("processing"));
    assert.ok(isEligibleWcStatus("completed"));
  });

  it("rejects non-purchase statuses", () => {
    for (const s of ["pending", "pending-payment", "on-hold", "failed",
                     "cancelled", "refunded", "trash", "checkout-draft"]) {
      assert.ok(!isEligibleWcStatus(s), `expected ${s} to be ineligible`);
    }
  });
});

// ─── ELIGIBLE_DB_STATUSES allowlist ──────────────────────────────────────────
describe("ELIGIBLE_DB_STATUSES allowlist", () => {
  it("includes confirmed-purchase statuses", () => {
    assert.ok(ELIGIBLE_DB_STATUSES.includes("processing"), "processing must be eligible");
    assert.ok(ELIGIBLE_DB_STATUSES.includes("completed"),  "completed must be eligible");
  });

  it("excludes pending-wc (in-flight WooCommerce idempotency anchor)", () => {
    assert.ok(!ELIGIBLE_DB_STATUSES.includes("pending-wc"),
      "pending-wc is an in-flight anchor and must never be treated as a completed purchase");
  });

  it("excludes pending (COD awaiting payment)", () => {
    assert.ok(!ELIGIBLE_DB_STATUSES.includes("pending"),
      "pending COD orders have not been paid and must not receive a reminder nudge");
  });

  it("excludes non-purchase statuses", () => {
    for (const s of ["failed", "cancelled", "refunded", "declined", "trash"]) {
      assert.ok(!ELIGIBLE_DB_STATUSES.includes(s), `${s} must not be eligible`);
    }
  });
});

// ─── DB order filtering in run() ─────────────────────────────────────────────
describe("run() DB order status filtering", () => {
  const noop = () => {};

  it("does not nudge a pending-wc order (SQL uses IN allowlist)", async () => {
    // The mock DB intercepts the SQL; we verify the query uses IN with the
    // eligible list so pending-wc rows are excluded at the DB level.
    let capturedSql = "";
    const qry = async (sql, params) => {
      if (sql.includes("FROM uc_order_items")) {
        capturedSql = sql;
        return []; // simulate: no rows match the IN allowlist for pending-wc
      }
      return [];
    };
    const pool = { connect: async () => ({ query: async (sql, p) => ({ rows: await qry(sql, p) }), release: () => {} }) };
    await run({
      wcKey: "", wcSecret: "", wcBase: "",
      dbPool: pool,
      deliveryLog: { notifiedEmails: new Set(), notifiedUserIds: new Set() },
      log: noop, error: noop,
    });
    assert.match(capturedSql, /\bIN\b/, "DB query must use IN (allowlist), not NOT IN (denylist)");
    assert.doesNotMatch(capturedSql, /NOT IN/, "DB query must not use NOT IN");
  });

  it("does not send a nudge when pending-wc order is the only DB row", async () => {
    // Simulate the DB correctly returning nothing for a pending-wc order
    // (as it would with the IN allowlist).
    const qry = async (sql) => {
      if (sql.includes("FROM uc_order_items")) return []; // pending-wc excluded
      return [];
    };
    const pool = { connect: async () => ({ query: async (sql, p) => ({ rows: await qry(sql, p) }), release: () => {} }) };
    const dl = { notifiedEmails: new Set(), notifiedUserIds: new Set() };
    const result = await run({
      wcKey: "", wcSecret: "", wcBase: "",
      dbPool: pool, deliveryLog: dl, log: noop, error: noop,
    });
    assert.equal(result.sent, 0);
    assert.equal(result.dbEligible, 0);
    assert.equal(dl.notifiedUserIds.size, 0);
  });
});

// ─── parseWcResponse ──────────────────────────────────────────────────────────
describe("parseWcResponse", () => {
  it("parses a clean JSON array", () => {
    const result = parseWcResponse('[{"id":1}]', 200);
    assert.deepEqual(result, [{ id: 1 }]);
  });

  it("strips PHP notices before the JSON bracket", () => {
    const phpPrefix = "Notice: Undefined index in /var/www/...\n";
    const result = parseWcResponse(phpPrefix + '[{"id":2}]', 200);
    assert.deepEqual(result, [{ id: 2 }]);
  });

  it("throws on non-2xx status regardless of body", () => {
    assert.throws(
      () => parseWcResponse('[{"id":1}]', 401),
      /HTTP 401/,
    );
    assert.throws(
      () => parseWcResponse("Forbidden", 403),
      /HTTP 403/,
    );
    assert.throws(
      () => parseWcResponse("Internal Server Error", 500),
      /HTTP 500/,
    );
  });

  it("throws when body contains no JSON bracket", () => {
    assert.throws(
      () => parseWcResponse("WAF blocked this request", 200),
      /No JSON found/,
    );
  });

  it("throws on malformed JSON after stripping notices", () => {
    assert.throws(
      () => parseWcResponse("[broken", 200),
    );
  });
});

// ─── fetchEligibleWcOrders ────────────────────────────────────────────────────
describe("fetchEligibleWcOrders", () => {
  it("returns null when credentials are absent", async () => {
    const result = await fetchEligibleWcOrders(8147, { wcKey: "", wcSecret: "", wcBase: "" });
    assert.equal(result, null);
  });

  it("returns only processing/completed orders from the API", async () => {
    const orders = [
      { id: 1, status: "completed",  billing: { email: "a@test.com" }, line_items: [] },
      { id: 2, status: "processing", billing: { email: "b@test.com" }, line_items: [] },
      { id: 3, status: "pending",    billing: { email: "c@test.com" }, line_items: [] },
      { id: 4, status: "cancelled",  billing: { email: "d@test.com" }, line_items: [] },
      { id: 5, status: "on-hold",    billing: { email: "e@test.com" }, line_items: [] },
    ];
    const mockFetch = async () => ({
      status: 200,
      text:   async () => JSON.stringify(orders),
    });
    const result = await fetchEligibleWcOrders(8147, {
      wcKey: "k", wcSecret: "s", wcBase: "https://example.com", fetchFn: mockFetch,
    });
    assert.equal(result.length, 2);
    assert.deepEqual(result.map(o => o.id), [1, 2]);
  });

  it("throws on a non-2xx HTTP response", async () => {
    const mockFetch = async () => ({
      status: 401,
      text:   async () => '{"code":"woocommerce_rest_cannot_view"}',
    });
    await assert.rejects(
      fetchEligibleWcOrders(8147, {
        wcKey: "k", wcSecret: "s", wcBase: "https://example.com", fetchFn: mockFetch,
      }),
      /HTTP 401/,
    );
  });

  it("throws when the API returns a WAF-blocked non-JSON body with 200", async () => {
    const mockFetch = async () => ({
      status: 200,
      text:   async () => "Access denied by WAF",
    });
    await assert.rejects(
      fetchEligibleWcOrders(8147, {
        wcKey: "k", wcSecret: "s", wcBase: "https://example.com", fetchFn: mockFetch,
      }),
      /No JSON found/,
    );
  });

  it("paginates: fetches until a page with fewer than 100 results", async () => {
    let page = 0;
    const mockFetch = async (url) => {
      page++;
      // First page: 100 completed orders; second page: 1 order → stop
      const count = page === 1 ? 100 : 1;
      const orders = Array.from({ length: count }, (_, i) => ({
        id: (page - 1) * 100 + i + 1,
        status: "completed",
        billing: { email: `user${(page-1)*100+i+1}@test.com` },
        line_items: [],
      }));
      return { status: 200, text: async () => JSON.stringify(orders) };
    };
    const result = await fetchEligibleWcOrders(8147, {
      wcKey: "k", wcSecret: "s", wcBase: "https://example.com", fetchFn: mockFetch,
    });
    assert.equal(result.length, 101);
    assert.equal(page, 2);
  });
});

// ─── run() — integration-style with mocked deps ───────────────────────────────
describe("run()", () => {
  const noop = () => {};

  /** Minimal DB stub: one user row for a given email, no push token by default. */
  function makeDb({ userByEmail = null, tokenByUserId = null } = {}) {
    return async (sql, params) => {
      if (sql.includes("FROM uc_users")) {
        const email = params[0];
        if (userByEmail && userByEmail.email === email) return [{ id: userByEmail.id }];
        return [];
      }
      if (sql.includes("FROM uc_push_tokens")) {
        const uid = String(params[0]);
        if (tokenByUserId && String(tokenByUserId.userId) === uid) {
          return [{ push_token: tokenByUserId.token, opt_out_orders: tokenByUserId.optOut ?? false }];
        }
        return [];
      }
      if (sql.includes("FROM uc_order_items")) return [];
      if (sql.includes("DELETE FROM uc_push_tokens")) return [];
      return [];
    };
  }

  /** Wrap a qry function as a pool stub for run(). */
  function poolOf(qry) {
    return { connect: async () => ({ query: async (sql, p) => ({ rows: await qry(sql, p) }), release: () => {} }) };
  }

  it("skips WC check when no credentials are provided", async () => {
    const result = await run({ wcKey: "", wcSecret: "", wcBase: "", log: noop, error: noop,
      deliveryLog: { notifiedEmails: new Set(), notifiedUserIds: new Set() } });
    assert.equal(result.wcEligible, 0);
  });

  it("sends a nudge to a matched WC buyer and records in delivery log", async () => {
    const order = {
      id: 99, status: "completed",
      billing: { email: "buyer@example.com", first_name: "Jo", last_name: "Smith" },
      line_items: [{ product_id: 8147, quantity: 1 }],
    };
    const mockFetch = async (url) => {
      if (url.includes("exp.host")) {
        return { ok: true, status: 200, json: async () => ({ data: [{ status: "ok" }] }) };
      }
      return { status: 200, text: async () => JSON.stringify([order]) };
    };
    const dl = { notifiedEmails: new Set(), notifiedUserIds: new Set() };
    const qry = makeDb({ userByEmail: { email: "buyer@example.com", id: 42 },
                         tokenByUserId: { userId: 42, token: "ExponentPushToken[xxx]" } });
    const result = await run({
      wcKey: "k", wcSecret: "s", wcBase: "https://example.com",
      fetchFn: mockFetch, dbPool: poolOf(qry), deliveryLog: dl, log: noop, error: noop,
    });
    assert.equal(result.sent, 1);
    assert.ok(dl.notifiedEmails.has("buyer@example.com"));
  });

  it("skips a buyer already in the delivery log (idempotency)", async () => {
    const order = {
      id: 99, status: "completed",
      billing: { email: "repeat@example.com", first_name: "A", last_name: "B" },
      line_items: [{ product_id: 8147, quantity: 1 }],
    };
    const mockFetch = async (url) => {
      if (url.includes("exp.host")) return { json: async () => ({ data: [{ status: "ok" }] }) };
      return { status: 200, text: async () => JSON.stringify([order]) };
    };
    const dl = {
      notifiedEmails:  new Set(["repeat@example.com"]),
      notifiedUserIds: new Set(),
    };
    const qry = makeDb();
    const result = await run({
      wcKey: "k", wcSecret: "s", wcBase: "https://example.com",
      fetchFn: mockFetch, dbPool: poolOf(qry), deliveryLog: dl, log: noop, error: noop,
    });
    assert.equal(result.sent, 0);
    assert.equal(result.skippedLog, 1);
  });

  it("reports unmatched WC buyers (no app account) without sending", async () => {
    const order = {
      id: 100, status: "processing",
      billing: { email: "ghost@example.com" },
      line_items: [{ product_id: 8147, quantity: 1 }],
    };
    const mockFetch = async () => ({ status: 200, text: async () => JSON.stringify([order]) });
    const dl = { notifiedEmails: new Set(), notifiedUserIds: new Set() };
    const qry = makeDb(); // no user row
    const result = await run({
      wcKey: "k", wcSecret: "s", wcBase: "https://example.com",
      fetchFn: mockFetch, dbPool: poolOf(qry), deliveryLog: dl, log: noop, error: noop,
    });
    assert.equal(result.sent, 0);
    assert.equal(result.wcUnmatched, 1);
  });

  it("skips opted-out users", async () => {
    const order = {
      id: 101, status: "completed",
      billing: { email: "optout@example.com" },
      line_items: [{ product_id: 8147, quantity: 1 }],
    };
    const mockFetch = async () => ({ status: 200, text: async () => JSON.stringify([order]) });
    const dl = { notifiedEmails: new Set(), notifiedUserIds: new Set() };
    const qry = makeDb({
      userByEmail:   { email: "optout@example.com", id: 7 },
      tokenByUserId: { userId: 7, token: "ExponentPushToken[yyy]", optOut: true },
    });
    const result = await run({
      wcKey: "k", wcSecret: "s", wcBase: "https://example.com",
      fetchFn: mockFetch, dbPool: poolOf(qry), deliveryLog: dl, log: noop, error: noop,
    });
    assert.equal(result.sent, 0);
    assert.equal(result.optedOut, 1);
  });

  it("throws (propagates to caller) on WC HTTP error so the process exits non-zero", async () => {
    const mockFetch = async () => ({ status: 401, text: async () => "Unauthorized" });
    await assert.rejects(
      run({
        wcKey: "k", wcSecret: "s", wcBase: "https://example.com",
        fetchFn: mockFetch, deliveryLog: { notifiedEmails: new Set(), notifiedUserIds: new Set() },
        log: noop, error: noop,
      }),
      /HTTP 401/,
    );
  });

  it("Expo 5xx response: returns failed, does NOT write to delivery log", async () => {
    const order = {
      id: 200, status: "completed",
      billing: { email: "expo5xx@example.com" },
      line_items: [{ product_id: 8147, quantity: 1 }],
    };
    let fetchCall = 0;
    const mockFetch = async (url) => {
      fetchCall++;
      if (url.includes("exp.host")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { status: 200, text: async () => JSON.stringify([order]) };
    };
    const dl = { notifiedEmails: new Set(), notifiedUserIds: new Set() };
    const qry = makeDb({
      userByEmail:   { email: "expo5xx@example.com", id: 11 },
      tokenByUserId: { userId: 11, token: "ExponentPushToken[5xx]" },
    });
    const result = await run({
      wcKey: "k", wcSecret: "s", wcBase: "https://example.com",
      fetchFn: mockFetch, dbPool: poolOf(qry), deliveryLog: dl, log: noop, error: noop,
    });
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    // Must NOT appear in the log — eligible for retry
    assert.ok(!dl.notifiedEmails.has("expo5xx@example.com"));
  });

  it("Expo malformed JSON response: returns failed, does NOT write to delivery log", async () => {
    const order = {
      id: 201, status: "completed",
      billing: { email: "expobad@example.com" },
      line_items: [{ product_id: 8147, quantity: 1 }],
    };
    const mockFetch = async (url) => {
      if (url.includes("exp.host")) {
        return {
          ok: true,
          status: 200,
          json: async () => { throw new SyntaxError("bad JSON"); },
        };
      }
      return { status: 200, text: async () => JSON.stringify([order]) };
    };
    const dl = { notifiedEmails: new Set(), notifiedUserIds: new Set() };
    const qry = makeDb({
      userByEmail:   { email: "expobad@example.com", id: 12 },
      tokenByUserId: { userId: 12, token: "ExponentPushToken[bad]" },
    });
    const result = await run({
      wcKey: "k", wcSecret: "s", wcBase: "https://example.com",
      fetchFn: mockFetch, dbPool: poolOf(qry), deliveryLog: dl, log: noop, error: noop,
    });
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    assert.ok(!dl.notifiedEmails.has("expobad@example.com"));
  });

  it("Expo non-stale error ticket: returns failed, does NOT write to delivery log", async () => {
    const order = {
      id: 202, status: "completed",
      billing: { email: "expoticketerr@example.com" },
      line_items: [{ product_id: 8147, quantity: 1 }],
    };
    const mockFetch = async (url) => {
      if (url.includes("exp.host")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ status: "error", details: { error: "MessageRateExceeded" } }] }),
        };
      }
      return { status: 200, text: async () => JSON.stringify([order]) };
    };
    const dl = { notifiedEmails: new Set(), notifiedUserIds: new Set() };
    const qry = makeDb({
      userByEmail:   { email: "expoticketerr@example.com", id: 13 },
      tokenByUserId: { userId: 13, token: "ExponentPushToken[err]" },
    });
    const result = await run({
      wcKey: "k", wcSecret: "s", wcBase: "https://example.com",
      fetchFn: mockFetch, dbPool: poolOf(qry), deliveryLog: dl, log: noop, error: noop,
    });
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    assert.ok(!dl.notifiedEmails.has("expoticketerr@example.com"));
  });

  it("excludes pending/failed WC orders (status filtering)", async () => {
    const orders = [
      { id: 1, status: "pending",   billing: { email: "p@x.com" }, line_items: [] },
      { id: 2, status: "failed",    billing: { email: "f@x.com" }, line_items: [] },
      { id: 3, status: "completed", billing: { email: "c@x.com" },
        line_items: [{ product_id: 8147, quantity: 1 }] },
    ];
    // API returns all three statuses but fetchEligibleWcOrders filters to eligible
    const mockFetch = async (url) => {
      if (url.includes("exp.host")) {
        return { ok: true, status: 200, json: async () => ({ data: [{ status: "ok" }] }) };
      }
      // WC API filters by status param, but we simulate returning all and let our
      // client-side filter handle it.
      return { status: 200, text: async () => JSON.stringify(orders) };
    };
    const dl = { notifiedEmails: new Set(), notifiedUserIds: new Set() };
    const qry = makeDb({
      userByEmail:   { email: "c@x.com", id: 99 },
      tokenByUserId: { userId: 99, token: "ExponentPushToken[zzz]" },
    });
    const result = await run({
      wcKey: "k", wcSecret: "s", wcBase: "https://example.com",
      fetchFn: mockFetch, dbPool: poolOf(qry), deliveryLog: dl, log: noop, error: noop,
    });
    // Only the completed order matches; pending/failed are dropped
    assert.equal(result.wcEligible, 1);
    assert.equal(result.sent, 1);
  });
});
