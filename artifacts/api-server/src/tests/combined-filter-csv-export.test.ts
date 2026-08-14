/**
 * Tests for combined ?status= + ?from=/?to= filtering on the three admin CSV
 * export endpoints:
 *   GET /api/uc/admin/orders.csv
 *   GET /api/uc/admin/tickets.csv
 *   GET /api/uc/admin/water-tests.csv
 *
 * The individual filters are covered separately by orders-csv-export.test.ts
 * (status) and date-range-csv-export.test.ts (dates). This suite specifically
 * targets the AND-wiring in the Drizzle query: a bug that drops either
 * condition would either leak out-of-range rows or hide in-range ones.
 *
 * For each CSV endpoint the suite proves:
 *   1. A row matching BOTH status AND date range appears in the CSV.
 *   2. A row matching status ONLY (outside the date window) is excluded.
 *   3. A row matching date ONLY (wrong status) is excluded.
 *   4. A row matching NEITHER is excluded.
 *
 * For orders.csv an additional scenario confirms that maxItems (which drives
 * the item column width) is computed from the combined-filtered set only, so
 * an excluded order with more items cannot inflate the header columns.
 *
 * Uses the real DB (same pattern as the other CSV test suites).
 * Uses July 2023 dates — distinct from June 2023 (date-range-csv-export) and
 * June 2024 (date-range-filter) — so the three suites never share fixtures.
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
  ucOrderItemsTable,
  ucTicketsTable,
  ucWaterTestsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-combined-filter-csv-tests";
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
): Promise<{ status: number; headers: Headers; text: string }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, {
    headers: {
      Authorization: `Bearer ${issueToken({
        id: testUserId,
        email: TEST_EMAIL,
        firstName: "CombinedFilter",
        lastName: "Test",
      })}`,
    },
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

/**
 * Parse a single RFC-4180 CSV row into its cell values.
 * Handles quoted cells (embedded commas and doubled-quote escaping) and
 * trailing empty cells produced by Array.join(",") when the last value is "".
 */
function parseCsvRow(row: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i <= row.length) {
    if (i === row.length) {
      cells.push("");
      break;
    }
    if (row[i] === '"') {
      let cell = "";
      i++; // skip opening quote
      while (i < row.length) {
        if (row[i] === '"' && row[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else if (row[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          cell += row[i++];
        }
      }
      cells.push(cell);
      if (i < row.length && row[i] === ",") i++;
      else break;
    } else {
      const end = row.indexOf(",", i);
      if (end === -1) {
        cells.push(row.slice(i));
        break;
      } else {
        cells.push(row.slice(i, end));
        i = end + 1;
      }
    }
  }
  return cells;
}

/** Extract the first-column IDs of all data rows in a CSV body. */
function csvFirstColumnIds(text: string): string[] {
  const lines = text.split("\r\n").filter(l => l.trim());
  return lines.slice(1).map(l => parseCsvRow(l)[0] ?? "");
}

// ── Date constants ────────────────────────────────────────────────────────────
// July 2023 — distinct from date-range-csv-export.test.ts (2023-06) and
// date-range-filter.test.ts (2024-06) to prevent cross-suite fixture
// interference even when all suites share the same database.

const DATE_FROM   = "2023-07-10"; // inclusive lower bound
const DATE_INSIDE = "2023-07-11"; // clearly inside the range
const DATE_TO     = "2023-07-12"; // inclusive upper bound
const DATE_BEFORE = "2023-07-09"; // outside — before the window

/** Returns a Date at noon UTC on the given YYYY-MM-DD string. */
function tsAt(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00Z`);
}

// Combined-filter query string: status in range
const ORDERS_TARGET_STATUS = "pending";
const ORDERS_OTHER_STATUS  = "processing";
const COMBO_RANGE = `from=${DATE_FROM}&to=${DATE_TO}`;

const TICKETS_TARGET_STATUS = "submitted";
const TICKETS_OTHER_STATUS  = "in_progress";

const WATER_TARGET_STATUS = "pending";
const WATER_OTHER_STATUS  = "scheduled";

// Static column count for orders.csv (same as orders-csv-export.test.ts)
const STATIC_COL_COUNT = 17;
const COLS_PER_ITEM    = 4;

// ── Fixture state ─────────────────────────────────────────────────────────────

const TEST_EMAIL = "combined-filter-csv-test@ucfilters-test.internal";
let testUserId: number;

// Orders
// [0] matchBoth    — ORDERS_TARGET_STATUS, inside range  → IN result
// [1] statusOnly   — ORDERS_TARGET_STATUS, before range  → OUT
// [2] dateOnly     — ORDERS_OTHER_STATUS,  inside range  → OUT
// [3] neither      — ORDERS_OTHER_STATUS,  before range  → OUT
// [4] excludedWide — ORDERS_OTHER_STATUS,  inside range, 3 items → OUT (maxItems probe)
// [5] includedNarrow — ORDERS_TARGET_STATUS, inside range, 1 item → IN (sets maxItems=1)
let insertedOrderIds: number[] = [];

// Tickets: same four zones (id strings)
let insertedTicketIds: string[] = [];

// Water-tests: same four zones (id strings)
let insertedWaterTestIds: string[] = [];

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Combined status + date-range filter — admin CSV exports", () => {
  before(async () => {
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: TEST_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "CombinedFilter",
        lastName: "Test",
        isAdmin: false,
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
        firstName: "Combined",
        lastName:  "Test",
        address1:  "1 Test Rd",
        city:      "Nairobi",
        country:   "KE",
        phone:     "+254700000000",
      },
      webhookRecovery: false,
    };

    // [0] matchBoth: target status + inside date range → must appear
    const [oMatch] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_TARGET_STATUS, dateCreated: tsAt(DATE_INSIDE) })
      .returning({ id: ucOrdersTable.id });
    if (!oMatch) throw new Error("Failed to insert matchBoth order");

    // [1] statusOnly: target status but BEFORE the range → must not appear
    const [oStatus] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_TARGET_STATUS, dateCreated: tsAt(DATE_BEFORE) })
      .returning({ id: ucOrdersTable.id });
    if (!oStatus) throw new Error("Failed to insert statusOnly order");

    // [2] dateOnly: inside the range but wrong status → must not appear
    const [oDate] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_OTHER_STATUS, dateCreated: tsAt(DATE_INSIDE) })
      .returning({ id: ucOrdersTable.id });
    if (!oDate) throw new Error("Failed to insert dateOnly order");

    // [3] neither: wrong status AND before the range → must not appear
    const [oNeither] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_OTHER_STATUS, dateCreated: tsAt(DATE_BEFORE) })
      .returning({ id: ucOrdersTable.id });
    if (!oNeither) throw new Error("Failed to insert neither order");

    // [4] excludedWide: wrong status, inside range, 3 items — must NOT inflate maxItems
    const [oWide] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_OTHER_STATUS, dateCreated: tsAt(DATE_INSIDE) })
      .returning({ id: ucOrdersTable.id });
    if (!oWide) throw new Error("Failed to insert excludedWide order");

    // [5] includedNarrow: target status, inside range, 1 item — IN result, sets maxItems=1
    const [oNarrow] = await db.insert(ucOrdersTable)
      .values({ ...baseOrder, status: ORDERS_TARGET_STATUS, dateCreated: tsAt(DATE_INSIDE) })
      .returning({ id: ucOrdersTable.id });
    if (!oNarrow) throw new Error("Failed to insert includedNarrow order");

    insertedOrderIds = [oMatch.id, oStatus.id, oDate.id, oNeither.id, oWide.id, oNarrow.id];

    // 3 items on excludedWide (index 4) — would inflate maxItems if accidentally included
    await db.insert(ucOrderItemsTable).values([
      { orderId: oWide.id, productId: 1,  name: "Hydra Flux",             quantity: 1, total: "3499" },
      { orderId: oWide.id, productId: 22, name: "Bottle Filter Cartridge", quantity: 1, total: "1099" },
      { orderId: oWide.id, productId: 23, name: "Faucet Filter Cartridge", quantity: 1, total: "1999" },
    ]);

    // 1 item on includedNarrow (index 5) — sets maxItems=1 for the filtered export
    await db.insert(ucOrderItemsTable).values([
      { orderId: oNarrow.id, productId: 23, name: "Faucet Filter Cartridge", quantity: 2, total: "3998" },
    ]);

    // ── Tickets ─────────────────────────────────────────────────────────────
    const uid = testUserId;

    const ticketBase = {
      userId:               String(uid),
      productModel:         "TestModel",
      issueDescription:     "Combined filter test ticket",
      preferredContactTime: "Any time",
      photos:               [],
      videos:               [],
    };

    await db.insert(ucTicketsTable).values({
      id: `TKT-CF-match-${uid}`,
      ...ticketBase,
      status:    TICKETS_TARGET_STATUS,
      createdAt: tsAt(DATE_INSIDE),
    });
    await db.insert(ucTicketsTable).values({
      id: `TKT-CF-statusonly-${uid}`,
      ...ticketBase,
      status:    TICKETS_TARGET_STATUS,
      createdAt: tsAt(DATE_BEFORE),
    });
    await db.insert(ucTicketsTable).values({
      id: `TKT-CF-dateonly-${uid}`,
      ...ticketBase,
      status:    TICKETS_OTHER_STATUS,
      createdAt: tsAt(DATE_INSIDE),
    });
    await db.insert(ucTicketsTable).values({
      id: `TKT-CF-neither-${uid}`,
      ...ticketBase,
      status:    TICKETS_OTHER_STATUS,
      createdAt: tsAt(DATE_BEFORE),
    });

    insertedTicketIds = [
      `TKT-CF-match-${uid}`,
      `TKT-CF-statusonly-${uid}`,
      `TKT-CF-dateonly-${uid}`,
      `TKT-CF-neither-${uid}`,
    ];

    // ── Water-tests ──────────────────────────────────────────────────────────
    const waterBase = {
      userId:      String(uid),
      name:        "Combined Filter Test",
      address:     "1 Test Rd, Nairobi",
      phone:       "+254700000000",
      waterSource: "Municipal",
      concerns:    "Combined filter test booking",
      photos:      [],
      videos:      [],
    };

    await db.insert(ucWaterTestsTable).values({
      id: `WT-CF-match-${uid}`,
      ...waterBase,
      status:    WATER_TARGET_STATUS,
      createdAt: tsAt(DATE_INSIDE),
    });
    await db.insert(ucWaterTestsTable).values({
      id: `WT-CF-statusonly-${uid}`,
      ...waterBase,
      status:    WATER_TARGET_STATUS,
      createdAt: tsAt(DATE_BEFORE),
    });
    await db.insert(ucWaterTestsTable).values({
      id: `WT-CF-dateonly-${uid}`,
      ...waterBase,
      status:    WATER_OTHER_STATUS,
      createdAt: tsAt(DATE_INSIDE),
    });
    await db.insert(ucWaterTestsTable).values({
      id: `WT-CF-neither-${uid}`,
      ...waterBase,
      status:    WATER_OTHER_STATUS,
      createdAt: tsAt(DATE_BEFORE),
    });

    insertedWaterTestIds = [
      `WT-CF-match-${uid}`,
      `WT-CF-statusonly-${uid}`,
      `WT-CF-dateonly-${uid}`,
      `WT-CF-neither-${uid}`,
    ];
  });

  after(async () => {
    if (insertedOrderIds.length) {
      await db.delete(ucOrderItemsTable)
        .where(inArray(ucOrderItemsTable.orderId, insertedOrderIds));
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

  // ── orders.csv ──────────────────────────────────────────────────────────────

  describe("GET /api/uc/admin/orders.csv — combined status + date-range filter", () => {
    async function fetchOrderIds(qs: string): Promise<string[]> {
      const { status, text } = await apiFetch(`/api/uc/admin/orders.csv?${qs}`);
      assert.equal(status, 200, `Expected 200, got ${status}: ${text}`);
      return csvFirstColumnIds(text);
    }

    const qs = `status=${ORDERS_TARGET_STATUS}&${COMBO_RANGE}`;

    it("row matching BOTH status and date range appears in the CSV", async () => {
      const ids = await fetchOrderIds(qs);
      assert.ok(
        ids.includes(String(insertedOrderIds[0])),
        `matchBoth order (id=${insertedOrderIds[0]}) must appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching status ONLY (before date window) is excluded", async () => {
      const ids = await fetchOrderIds(qs);
      assert.ok(
        !ids.includes(String(insertedOrderIds[1])),
        `statusOnly order (id=${insertedOrderIds[1]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching date range ONLY (wrong status) is excluded", async () => {
      const ids = await fetchOrderIds(qs);
      assert.ok(
        !ids.includes(String(insertedOrderIds[2])),
        `dateOnly order (id=${insertedOrderIds[2]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching NEITHER filter is excluded", async () => {
      const ids = await fetchOrderIds(qs);
      assert.ok(
        !ids.includes(String(insertedOrderIds[3])),
        `neither order (id=${insertedOrderIds[3]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("maxItems column width is computed from the combined-filtered set only", async () => {
      // includedNarrow (index 5) has 1 item and is in the combined result.
      // excludedWide (index 4) has 3 items but is excluded by status.
      // Header must have STATIC_COL_COUNT + 1*COLS_PER_ITEM columns — NOT 3.
      const { status, text } = await apiFetch(`/api/uc/admin/orders.csv?${qs}`);
      assert.equal(status, 200);

      const lines = text.split("\r\n").filter(l => l.trim());
      assert.ok(lines.length >= 1, "CSV must have at least a header row");

      const headerCells = parseCsvRow(lines[0]!);
      const itemColCount = headerCells.length - STATIC_COL_COUNT;

      // The combined-filtered set has matchBoth (0 items) + includedNarrow (1 item).
      // maxItems = 1, so exactly COLS_PER_ITEM item columns expected.
      assert.ok(
        itemColCount <= COLS_PER_ITEM,
        `Header must not exceed ${COLS_PER_ITEM} item columns (maxItems=1 from filtered set). ` +
          `Got ${itemColCount} — the excluded wide order may have leaked its item count.`,
      );
      assert.equal(
        itemColCount,
        COLS_PER_ITEM,
        `Header must have exactly ${COLS_PER_ITEM} item columns (1 item × ${COLS_PER_ITEM} cols). ` +
          `Got ${itemColCount}`,
      );
    });

    it("includedNarrow order row (in result) carries the correct item data", async () => {
      const { status, text } = await apiFetch(`/api/uc/admin/orders.csv?${qs}`);
      assert.equal(status, 200);

      const lines = text.split("\r\n").filter(l => l.trim());
      const dataLines = lines.slice(1);

      const narrowRow = dataLines.find(l => {
        const cells = parseCsvRow(l);
        return cells[0] !== undefined && Number(cells[0]) === insertedOrderIds[5];
      });
      assert.ok(
        narrowRow,
        `includedNarrow order (id=${insertedOrderIds[5]}) must appear in the filtered CSV`,
      );

      const cells = parseCsvRow(narrowRow!);
      const itemStart = STATIC_COL_COUNT;
      assert.equal(cells[itemStart],     "23",                      "item_1_productId must be 23");
      assert.equal(cells[itemStart + 1], "Faucet Filter Cartridge", "item_1_name must be correct");
      assert.equal(cells[itemStart + 2], "2",                       "item_1_qty must be 2");
      assert.equal(cells[itemStart + 3], "3998",                    "item_1_total must be 3998");
    });
  });

  // ── tickets.csv ─────────────────────────────────────────────────────────────

  describe("GET /api/uc/admin/tickets.csv — combined status + date-range filter", () => {
    async function fetchTicketIds(qs: string): Promise<string[]> {
      const { status, text } = await apiFetch(`/api/uc/admin/tickets.csv?${qs}`);
      assert.equal(status, 200, `Expected 200, got ${status}: ${text}`);
      return csvFirstColumnIds(text);
    }

    const qs = `status=${TICKETS_TARGET_STATUS}&${COMBO_RANGE}`;

    it("row matching BOTH status and date range appears in the CSV", async () => {
      const ids = await fetchTicketIds(qs);
      assert.ok(
        ids.includes(insertedTicketIds[0]!),
        `matchBoth ticket (${insertedTicketIds[0]}) must appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching status ONLY (before date window) is excluded", async () => {
      const ids = await fetchTicketIds(qs);
      assert.ok(
        !ids.includes(insertedTicketIds[1]!),
        `statusOnly ticket (${insertedTicketIds[1]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching date range ONLY (wrong status) is excluded", async () => {
      const ids = await fetchTicketIds(qs);
      assert.ok(
        !ids.includes(insertedTicketIds[2]!),
        `dateOnly ticket (${insertedTicketIds[2]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching NEITHER filter is excluded", async () => {
      const ids = await fetchTicketIds(qs);
      assert.ok(
        !ids.includes(insertedTicketIds[3]!),
        `neither ticket (${insertedTicketIds[3]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });
  });

  // ── water-tests.csv ──────────────────────────────────────────────────────────

  describe("GET /api/uc/admin/water-tests.csv — combined status + date-range filter", () => {
    async function fetchWaterIds(qs: string): Promise<string[]> {
      const { status, text } = await apiFetch(`/api/uc/admin/water-tests.csv?${qs}`);
      assert.equal(status, 200, `Expected 200, got ${status}: ${text}`);
      return csvFirstColumnIds(text);
    }

    const qs = `status=${WATER_TARGET_STATUS}&${COMBO_RANGE}`;

    it("row matching BOTH status and date range appears in the CSV", async () => {
      const ids = await fetchWaterIds(qs);
      assert.ok(
        ids.includes(insertedWaterTestIds[0]!),
        `matchBoth water-test (${insertedWaterTestIds[0]}) must appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching status ONLY (before date window) is excluded", async () => {
      const ids = await fetchWaterIds(qs);
      assert.ok(
        !ids.includes(insertedWaterTestIds[1]!),
        `statusOnly water-test (${insertedWaterTestIds[1]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching date range ONLY (wrong status) is excluded", async () => {
      const ids = await fetchWaterIds(qs);
      assert.ok(
        !ids.includes(insertedWaterTestIds[2]!),
        `dateOnly water-test (${insertedWaterTestIds[2]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row matching NEITHER filter is excluded", async () => {
      const ids = await fetchWaterIds(qs);
      assert.ok(
        !ids.includes(insertedWaterTestIds[3]!),
        `neither water-test (${insertedWaterTestIds[3]}) must not appear. IDs: ${JSON.stringify(ids)}`,
      );
    });
  });
});
