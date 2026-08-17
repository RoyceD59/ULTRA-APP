/**
 * Tests for status-only filtering on the three admin JSON list endpoints:
 *   GET /api/uc/admin/orders
 *   GET /api/uc/admin/tickets
 *   GET /api/uc/admin/water-tests
 *
 * The combined-filter suite (combined-filter-json-list.test.ts) proves that the
 * AND-wiring works when both ?status= and date params are present.  This suite
 * specifically covers the status-only path — no ?from= / ?to= supplied — so a
 * regression in that branch (e.g. the status condition being silently dropped
 * when date params are absent) would be caught.
 *
 * For each endpoint the suite proves:
 *   1. A row with the target status appears in the response.
 *   2. A row with a different status is excluded.
 *
 * Uses the real DB (same pattern as combined-filter-json-list.test.ts).
 * Uses September 2023 timestamps — distinct from:
 *   - June 2023    (date-range-csv-export.test.ts)
 *   - July 2023    (combined-filter-csv-export.test.ts)
 *   - August 2023  (combined-filter-json-list.test.ts)
 *   - June 2024    (date-range-filter.test.ts)
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { issueToken } from "../lib/jwt.js";
import {
  db,
  ucUsersTable,
  ucOrdersTable,
  ucTicketsTable,
  ucWaterTestsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-status-only-filter-tests";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(
  path: string,
): Promise<{ status: number; body: unknown }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, {
    headers: {
      Authorization: `Bearer ${issueToken({
        id: testUserId,
        email: TEST_EMAIL,
        firstName: "StatusOnly",
        lastName: "Test",
      })}`,
    },
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ── Status constants ──────────────────────────────────────────────────────────

const ORDERS_TARGET_STATUS  = "pending";
const ORDERS_OTHER_STATUS   = "processing";

const TICKETS_TARGET_STATUS = "submitted";
const TICKETS_OTHER_STATUS  = "in_progress";

const WATER_TARGET_STATUS   = "pending";
const WATER_OTHER_STATUS    = "scheduled";

// ── Fixture state ─────────────────────────────────────────────────────────────

const TEST_EMAIL = "status-only-filter-test@ucfilters-test.internal";
let testUserId: number;

// Each array has two entries: [0] = target status, [1] = other status.
let insertedOrderIds:     number[] = [];
let insertedTicketIds:    string[] = [];
let insertedWaterTestIds: string[] = [];

/** September 2023 — distinct from all other test suites. */
function fixtureTs(): Date {
  return new Date("2023-09-15T12:00:00Z");
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Status-only filter — admin JSON list endpoints", () => {
  before(async () => {
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email:        TEST_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName:    "StatusOnly",
        lastName:     "Test",
        isAdmin:      false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert test user");
    testUserId = inserted.id;

    process.env["UC_ADMIN_EMAILS"] = TEST_EMAIL;

    // ── Orders ──────────────────────────────────────────────────────────────
    const baseOrder = {
      userId:           String(testUserId),
      total:            "0",
      currency:         "KES",
      paymentMethod:    "cod" as const,
      paymentReference: "",
      promoCode:        "",
      discountPercent:  0,
      discountAmount:   0,
      shippingAddress:  {
        firstName: "StatusOnly",
        lastName:  "Test",
        address1:  "1 Test Rd",
        city:      "Nairobi",
        country:   "KE",
        phone:     "+254700000000",
      },
      webhookRecovery: false,
      dateCreated:     fixtureTs(),
    };

    const [oTarget] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_TARGET_STATUS })
      .returning({ id: ucOrdersTable.id });
    if (!oTarget) throw new Error("Failed to insert target-status order");

    const [oOther] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_OTHER_STATUS })
      .returning({ id: ucOrdersTable.id });
    if (!oOther) throw new Error("Failed to insert other-status order");

    insertedOrderIds = [oTarget.id, oOther.id];

    // ── Tickets ─────────────────────────────────────────────────────────────
    const uid = testUserId;
    const ticketBase = {
      userId:               String(uid),
      productModel:         "TestModel",
      issueDescription:     "Status-only filter test ticket",
      preferredContactTime: "Any time",
      photos:               [],
      videos:               [],
      createdAt:            fixtureTs(),
    };

    await db.insert(ucTicketsTable).values({
      id: `TKT-SO-target-${uid}`,
      ...ticketBase,
      status: TICKETS_TARGET_STATUS,
    });
    await db.insert(ucTicketsTable).values({
      id: `TKT-SO-other-${uid}`,
      ...ticketBase,
      status: TICKETS_OTHER_STATUS,
    });

    insertedTicketIds = [
      `TKT-SO-target-${uid}`,
      `TKT-SO-other-${uid}`,
    ];

    // ── Water-tests ──────────────────────────────────────────────────────────
    const waterBase = {
      userId:      String(uid),
      name:        "StatusOnly Test",
      address:     "1 Test Rd, Nairobi",
      phone:       "+254700000000",
      waterSource: "Municipal",
      concerns:    "Status-only filter test booking",
      photos:      [],
      videos:      [],
      createdAt:   fixtureTs(),
    };

    await db.insert(ucWaterTestsTable).values({
      id: `WT-SO-target-${uid}`,
      ...waterBase,
      status: WATER_TARGET_STATUS,
    });
    await db.insert(ucWaterTestsTable).values({
      id: `WT-SO-other-${uid}`,
      ...waterBase,
      status: WATER_OTHER_STATUS,
    });

    insertedWaterTestIds = [
      `WT-SO-target-${uid}`,
      `WT-SO-other-${uid}`,
    ];
  });

  after(async () => {
    if (insertedOrderIds.length) {
      await db.delete(ucOrdersTable)
        .where(inArray(ucOrdersTable.id, insertedOrderIds));
    }
    if (insertedTicketIds.length) {
      await db.delete(ucTicketsTable)
        .where(inArray(ucTicketsTable.id, insertedTicketIds));
    }
    if (insertedWaterTestIds.length) {
      await db.delete(ucWaterTestsTable)
        .where(inArray(ucWaterTestsTable.id, insertedWaterTestIds));
    }
    if (testUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, testUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  // ── Shared helper ─────────────────────────────────────────────────────────

  /**
   * Fetch the JSON list endpoint with the given query string, assert 200 and
   * an array body, then return only the fixture IDs present in the response.
   */
  async function fetchFixtureIds(
    endpointPath: string,
    qs: string,
    allFixtureIds: Set<number | string>,
  ): Promise<(number | string)[]> {
    const { status, body } = await apiFetch(`${endpointPath}?${qs}`);
    assert.equal(
      status,
      200,
      `Expected 200 from ${endpointPath}?${qs}, got ${status}: ${JSON.stringify(body)}`,
    );
    assert.ok(
      Array.isArray(body),
      `Expected array from ${endpointPath}?${qs}, got: ${JSON.stringify(body)}`,
    );
    return (body as Array<Record<string, unknown>>)
      .filter(r => allFixtureIds.has(r["id"] as number | string))
      .map(r => r["id"] as number | string);
  }

  // ── GET /api/uc/admin/orders ──────────────────────────────────────────────

  describe("GET /api/uc/admin/orders — status-only filter", () => {
    const qs = `status=${ORDERS_TARGET_STATUS}`;

    async function fetchOrderIds(): Promise<(number | string)[]> {
      return fetchFixtureIds(
        "/api/uc/admin/orders",
        qs,
        new Set(insertedOrderIds),
      );
    }

    it("row with target status appears in the response", async () => {
      const ids = await fetchOrderIds();
      assert.ok(
        ids.includes(insertedOrderIds[0]!),
        `target-status order (id=${insertedOrderIds[0]}) must appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row with a different status is excluded from the response", async () => {
      const ids = await fetchOrderIds();
      assert.ok(
        !ids.includes(insertedOrderIds[1]!),
        `other-status order (id=${insertedOrderIds[1]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });
  });

  // ── GET /api/uc/admin/tickets ─────────────────────────────────────────────

  describe("GET /api/uc/admin/tickets — status-only filter", () => {
    const qs = `status=${TICKETS_TARGET_STATUS}`;

    async function fetchTicketIds(): Promise<(number | string)[]> {
      return fetchFixtureIds(
        "/api/uc/admin/tickets",
        qs,
        new Set(insertedTicketIds),
      );
    }

    it("row with target status appears in the response", async () => {
      const ids = await fetchTicketIds();
      assert.ok(
        ids.includes(insertedTicketIds[0]!),
        `target-status ticket (${insertedTicketIds[0]}) must appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row with a different status is excluded from the response", async () => {
      const ids = await fetchTicketIds();
      assert.ok(
        !ids.includes(insertedTicketIds[1]!),
        `other-status ticket (${insertedTicketIds[1]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });
  });

  // ── GET /api/uc/admin/water-tests ─────────────────────────────────────────

  describe("GET /api/uc/admin/water-tests — status-only filter", () => {
    const qs = `status=${WATER_TARGET_STATUS}`;

    async function fetchWaterTestIds(): Promise<(number | string)[]> {
      return fetchFixtureIds(
        "/api/uc/admin/water-tests",
        qs,
        new Set(insertedWaterTestIds),
      );
    }

    it("row with target status appears in the response", async () => {
      const ids = await fetchWaterTestIds();
      assert.ok(
        ids.includes(insertedWaterTestIds[0]!),
        `target-status water-test (${insertedWaterTestIds[0]}) must appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row with a different status is excluded from the response", async () => {
      const ids = await fetchWaterTestIds();
      assert.ok(
        !ids.includes(insertedWaterTestIds[1]!),
        `other-status water-test (${insertedWaterTestIds[1]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });
  });
});
