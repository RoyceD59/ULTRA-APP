/**
 * Tests for combined ?status= + ?from=/?to= filtering on the three admin JSON
 * list endpoints:
 *   GET /api/uc/admin/orders
 *   GET /api/uc/admin/tickets
 *   GET /api/uc/admin/water-tests
 *
 * The individual filters are covered separately by date-range-filter.test.ts
 * (dates) and the status-only tests elsewhere. This suite specifically targets
 * the AND-wiring in the Drizzle query: a bug that drops either condition would
 * either leak out-of-range rows or hide in-range ones.
 *
 * For each JSON endpoint the suite proves:
 *   1. A row matching BOTH status AND date range appears in the response.
 *   2. A row matching status ONLY (outside the date window) is excluded.
 *   3. A row matching date ONLY (wrong status) is excluded.
 *   4. A row matching NEITHER is excluded.
 *
 * Uses the real DB (same pattern as combined-filter-csv-export.test.ts).
 * Uses August 2023 dates — distinct from:
 *   - June 2023  (date-range-csv-export.test.ts)
 *   - July 2023  (combined-filter-csv-export.test.ts)
 *   - June 2024  (date-range-filter.test.ts)
 * so the suites never share fixtures even in the same DB.
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
  process.env["SESSION_SECRET"] ??= "test-secret-for-combined-filter-json-tests";
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
        firstName: "CombinedJson",
        lastName: "Test",
      })}`,
    },
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ── Date constants ────────────────────────────────────────────────────────────
// August 2023 — distinct from all other test suites.

const DATE_FROM   = "2023-08-10"; // inclusive lower bound
const DATE_INSIDE = "2023-08-11"; // clearly inside the range
const DATE_TO     = "2023-08-12"; // inclusive upper bound
const DATE_BEFORE = "2023-08-09"; // outside — before the window

const COMBO_RANGE = `from=${DATE_FROM}&to=${DATE_TO}`;

/** Returns a Date at noon UTC on the given YYYY-MM-DD string. */
function tsAt(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00Z`);
}

// ── Status constants ──────────────────────────────────────────────────────────

const ORDERS_TARGET_STATUS  = "pending";
const ORDERS_OTHER_STATUS   = "processing";

const TICKETS_TARGET_STATUS = "submitted";
const TICKETS_OTHER_STATUS  = "in_progress";

const WATER_TARGET_STATUS   = "pending";
const WATER_OTHER_STATUS    = "scheduled";

// ── Fixture state ─────────────────────────────────────────────────────────────

const TEST_EMAIL = "combined-filter-json-test@ucfilters-test.internal";
let testUserId: number;

// Each fixture array has four entries in this order:
//   [0] matchBoth    — target status + inside date range  → IN result
//   [1] statusOnly   — target status + BEFORE date range  → OUT
//   [2] dateOnly     — other status  + inside date range  → OUT
//   [3] neither      — other status  + BEFORE date range  → OUT
let insertedOrderIds:     number[] = [];
let insertedTicketIds:    string[] = [];
let insertedWaterTestIds: string[] = [];

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Combined status + date-range filter — admin JSON list endpoints", () => {
  before(async () => {
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email:        TEST_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName:    "CombinedJson",
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
        firstName: "CombinedJson",
        lastName:  "Test",
        address1:  "1 Test Rd",
        city:      "Nairobi",
        country:   "KE",
        phone:     "+254700000000",
      },
      webhookRecovery: false,
    };

    const [oMatch] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_TARGET_STATUS, dateCreated: tsAt(DATE_INSIDE) })
      .returning({ id: ucOrdersTable.id });
    if (!oMatch) throw new Error("Failed to insert matchBoth order");

    const [oStatus] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_TARGET_STATUS, dateCreated: tsAt(DATE_BEFORE) })
      .returning({ id: ucOrdersTable.id });
    if (!oStatus) throw new Error("Failed to insert statusOnly order");

    const [oDate] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_OTHER_STATUS, dateCreated: tsAt(DATE_INSIDE) })
      .returning({ id: ucOrdersTable.id });
    if (!oDate) throw new Error("Failed to insert dateOnly order");

    const [oNeither] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_OTHER_STATUS, dateCreated: tsAt(DATE_BEFORE) })
      .returning({ id: ucOrdersTable.id });
    if (!oNeither) throw new Error("Failed to insert neither order");

    insertedOrderIds = [oMatch.id, oStatus.id, oDate.id, oNeither.id];

    // ── Tickets ─────────────────────────────────────────────────────────────
    const uid = testUserId;
    const ticketBase = {
      userId:               String(uid),
      productModel:         "TestModel",
      issueDescription:     "Combined JSON filter test ticket",
      preferredContactTime: "Any time",
      photos:               [],
      videos:               [],
    };

    await db.insert(ucTicketsTable).values({
      id: `TKT-CJ-match-${uid}`,
      ...ticketBase,
      status:    TICKETS_TARGET_STATUS,
      createdAt: tsAt(DATE_INSIDE),
    });
    await db.insert(ucTicketsTable).values({
      id: `TKT-CJ-statusonly-${uid}`,
      ...ticketBase,
      status:    TICKETS_TARGET_STATUS,
      createdAt: tsAt(DATE_BEFORE),
    });
    await db.insert(ucTicketsTable).values({
      id: `TKT-CJ-dateonly-${uid}`,
      ...ticketBase,
      status:    TICKETS_OTHER_STATUS,
      createdAt: tsAt(DATE_INSIDE),
    });
    await db.insert(ucTicketsTable).values({
      id: `TKT-CJ-neither-${uid}`,
      ...ticketBase,
      status:    TICKETS_OTHER_STATUS,
      createdAt: tsAt(DATE_BEFORE),
    });

    insertedTicketIds = [
      `TKT-CJ-match-${uid}`,
      `TKT-CJ-statusonly-${uid}`,
      `TKT-CJ-dateonly-${uid}`,
      `TKT-CJ-neither-${uid}`,
    ];

    // ── Water-tests ──────────────────────────────────────────────────────────
    const waterBase = {
      userId:      String(uid),
      name:        "CombinedJson Test",
      address:     "1 Test Rd, Nairobi",
      phone:       "+254700000000",
      waterSource: "Municipal",
      concerns:    "Combined JSON filter test booking",
      photos:      [],
      videos:      [],
    };

    await db.insert(ucWaterTestsTable).values({
      id: `WT-CJ-match-${uid}`,
      ...waterBase,
      status:    WATER_TARGET_STATUS,
      createdAt: tsAt(DATE_INSIDE),
    });
    await db.insert(ucWaterTestsTable).values({
      id: `WT-CJ-statusonly-${uid}`,
      ...waterBase,
      status:    WATER_TARGET_STATUS,
      createdAt: tsAt(DATE_BEFORE),
    });
    await db.insert(ucWaterTestsTable).values({
      id: `WT-CJ-dateonly-${uid}`,
      ...waterBase,
      status:    WATER_OTHER_STATUS,
      createdAt: tsAt(DATE_INSIDE),
    });
    await db.insert(ucWaterTestsTable).values({
      id: `WT-CJ-neither-${uid}`,
      ...waterBase,
      status:    WATER_OTHER_STATUS,
      createdAt: tsAt(DATE_BEFORE),
    });

    insertedWaterTestIds = [
      `WT-CJ-match-${uid}`,
      `WT-CJ-statusonly-${uid}`,
      `WT-CJ-dateonly-${uid}`,
      `WT-CJ-neither-${uid}`,
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
   * an array body, then return only the fixture IDs from the response.
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

  describe("GET /api/uc/admin/orders — combined status + date-range filter", () => {
    const qs = `status=${ORDERS_TARGET_STATUS}&${COMBO_RANGE}`;

    async function fetchOrderIds(): Promise<(number | string)[]> {
      return fetchFixtureIds(
        "/api/uc/admin/orders",
        qs,
        new Set(insertedOrderIds),
      );
    }

    it("row matching BOTH status and date range appears in the response", async () => {
      const ids = await fetchOrderIds();
      assert.ok(
        ids.includes(insertedOrderIds[0]!),
        `matchBoth order (id=${insertedOrderIds[0]}) must appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching status ONLY (before date window) is excluded", async () => {
      const ids = await fetchOrderIds();
      assert.ok(
        !ids.includes(insertedOrderIds[1]!),
        `statusOnly order (id=${insertedOrderIds[1]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching date range ONLY (wrong status) is excluded", async () => {
      const ids = await fetchOrderIds();
      assert.ok(
        !ids.includes(insertedOrderIds[2]!),
        `dateOnly order (id=${insertedOrderIds[2]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching NEITHER filter is excluded", async () => {
      const ids = await fetchOrderIds();
      assert.ok(
        !ids.includes(insertedOrderIds[3]!),
        `neither order (id=${insertedOrderIds[3]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });
  });

  // ── GET /api/uc/admin/tickets ─────────────────────────────────────────────

  describe("GET /api/uc/admin/tickets — combined status + date-range filter", () => {
    const qs = `status=${TICKETS_TARGET_STATUS}&${COMBO_RANGE}`;

    async function fetchTicketIds(): Promise<(number | string)[]> {
      return fetchFixtureIds(
        "/api/uc/admin/tickets",
        qs,
        new Set(insertedTicketIds),
      );
    }

    it("row matching BOTH status and date range appears in the response", async () => {
      const ids = await fetchTicketIds();
      assert.ok(
        ids.includes(insertedTicketIds[0]!),
        `matchBoth ticket (${insertedTicketIds[0]}) must appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching status ONLY (before date window) is excluded", async () => {
      const ids = await fetchTicketIds();
      assert.ok(
        !ids.includes(insertedTicketIds[1]!),
        `statusOnly ticket (${insertedTicketIds[1]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching date range ONLY (wrong status) is excluded", async () => {
      const ids = await fetchTicketIds();
      assert.ok(
        !ids.includes(insertedTicketIds[2]!),
        `dateOnly ticket (${insertedTicketIds[2]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching NEITHER filter is excluded", async () => {
      const ids = await fetchTicketIds();
      assert.ok(
        !ids.includes(insertedTicketIds[3]!),
        `neither ticket (${insertedTicketIds[3]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });
  });

  // ── GET /api/uc/admin/water-tests ─────────────────────────────────────────

  describe("GET /api/uc/admin/water-tests — combined status + date-range filter", () => {
    const qs = `status=${WATER_TARGET_STATUS}&${COMBO_RANGE}`;

    async function fetchWaterTestIds(): Promise<(number | string)[]> {
      return fetchFixtureIds(
        "/api/uc/admin/water-tests",
        qs,
        new Set(insertedWaterTestIds),
      );
    }

    it("row matching BOTH status and date range appears in the response", async () => {
      const ids = await fetchWaterTestIds();
      assert.ok(
        ids.includes(insertedWaterTestIds[0]!),
        `matchBoth water-test (${insertedWaterTestIds[0]}) must appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching status ONLY (before date window) is excluded", async () => {
      const ids = await fetchWaterTestIds();
      assert.ok(
        !ids.includes(insertedWaterTestIds[1]!),
        `statusOnly water-test (${insertedWaterTestIds[1]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching date range ONLY (wrong status) is excluded", async () => {
      const ids = await fetchWaterTestIds();
      assert.ok(
        !ids.includes(insertedWaterTestIds[2]!),
        `dateOnly water-test (${insertedWaterTestIds[2]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching NEITHER filter is excluded", async () => {
      const ids = await fetchWaterTestIds();
      assert.ok(
        !ids.includes(insertedWaterTestIds[3]!),
        `neither water-test (${insertedWaterTestIds[3]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });
  });
});
