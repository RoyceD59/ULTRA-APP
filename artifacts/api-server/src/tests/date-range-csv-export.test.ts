/**
 * Tests for date-range filtering on the three admin CSV export endpoints:
 *   GET /api/uc/admin/orders.csv
 *   GET /api/uc/admin/tickets.csv
 *   GET /api/uc/admin/water-tests.csv
 *
 * The JSON endpoints are covered by date-range-filter.test.ts, but each .csv
 * handler wires parseDateRange into its own Drizzle query independently, so
 * an error in one of those wiring calls would not be caught there.
 *
 * Covers, for each CSV endpoint:
 *   1. Rows on the from-date and to-date boundaries are included (inclusive)
 *   2. Rows inside the range are included
 *   3. Rows before ?from= and after ?to= are excluded
 *   4. A far-future range yields a CSV with none of our fixture rows
 *
 * Uses the real DB (same pattern as date-range-filter.test.ts).
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
  process.env["SESSION_SECRET"] ??= "test-secret-for-csv-date-range-tests";
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
        firstName: "CsvDateRange",
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

// ── Test date constants ───────────────────────────────────────────────────────
// June 2023 — well in the past, distinct from date-range-filter.test.ts (2024-06)
// so the two suites can never interfere with each other's fixtures.

const DATE_BEFORE = "2023-06-14";
const DATE_FROM   = "2023-06-15"; // inclusive lower bound
const DATE_INSIDE = "2023-06-16"; // clearly inside the range
const DATE_TO     = "2023-06-17"; // inclusive upper bound
const DATE_AFTER  = "2023-06-18";
const DATE_EMPTY  = "2099-01-01"; // far future — guaranteed to match nothing

/** Returns a Date object at noon UTC on a given YYYY-MM-DD string. */
function tsAt(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00Z`);
}

const DATES_LABELLED = [
  { label: "before", date: DATE_BEFORE },
  { label: "from",   date: DATE_FROM   },
  { label: "inside", date: DATE_INSIDE },
  { label: "to",     date: DATE_TO     },
  { label: "after",  date: DATE_AFTER  },
] as const;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_EMAIL = "csv-date-range-test-admin@ucfilters-test.internal";

let testUserId: number;
let insertedOrderIds:     number[] = [];
let insertedTicketIds:    string[] = [];
let insertedWaterTestIds: string[] = [];

// Maps: date string → CSV first-column ID (as string) of the fixture at that date.
const orderIdByDate     = new Map<string, string>();
const ticketIdByDate    = new Map<string, string>();
const waterTestIdByDate = new Map<string, string>();

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Date-range filter — admin CSV exports", () => {
  before(async () => {
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: TEST_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "CsvDateRange",
        lastName: "Test",
        isAdmin: false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert test admin user");
    testUserId = inserted.id;

    process.env["UC_ADMIN_EMAILS"] = TEST_EMAIL;

    // Five orders — one at each test date
    for (const { label, date } of DATES_LABELLED) {
      const [row] = await db
        .insert(ucOrdersTable)
        .values({
          userId:           String(testUserId),
          status:           "pending",
          total:            "0",
          currency:         "KES",
          paymentMethod:    "cod",
          paymentReference: "",
          promoCode:        "",
          discountPercent:  0,
          discountAmount:   0,
          shippingAddress:  {
            firstName: "CsvDateRange",
            lastName:  label,
            address1:  "1 Test Rd",
            city:      "Nairobi",
            country:   "KE",
            phone:     "+254700000000",
          },
          webhookRecovery: false,
          dateCreated:     tsAt(date),
        })
        .returning({ id: ucOrdersTable.id });
      if (!row) throw new Error(`Failed to insert ${label} order`);
      insertedOrderIds.push(row.id);
      orderIdByDate.set(date, String(row.id));
    }

    // Five tickets — one at each test date
    for (const { label, date } of DATES_LABELLED) {
      const id = `TKT-CSVDR-${label}-${testUserId}`;
      await db.insert(ucTicketsTable).values({
        id,
        userId:               String(testUserId),
        productModel:         `TestModel-${label}`,
        issueDescription:     `CSV date range test ticket: ${label}`,
        preferredContactTime: "Any time",
        photos:               [],
        videos:               [],
        status:               "submitted",
        createdAt:            tsAt(date),
      });
      insertedTicketIds.push(id);
      ticketIdByDate.set(date, id);
    }

    // Five water-test bookings — one at each test date
    for (const { label, date } of DATES_LABELLED) {
      const id = `WT-CSVDR-${label}-${testUserId}`;
      await db.insert(ucWaterTestsTable).values({
        id,
        userId:      String(testUserId),
        name:        `CsvDateRange ${label}`,
        address:     "1 Test Rd, Nairobi",
        phone:       "+254700000000",
        waterSource: "Municipal",
        concerns:    `CSV date range test booking: ${label}`,
        photos:      [],
        videos:      [],
        status:      "pending",
        createdAt:   tsAt(date),
      });
      insertedWaterTestIds.push(id);
      waterTestIdByDate.set(date, id);
    }
  });

  after(async () => {
    if (insertedOrderIds.length) {
      await db.delete(ucOrdersTable).where(inArray(ucOrdersTable.id, insertedOrderIds));
    }
    if (insertedTicketIds.length) {
      await db.delete(ucTicketsTable).where(inArray(ucTicketsTable.id, insertedTicketIds));
    }
    if (insertedWaterTestIds.length) {
      await db.delete(ucWaterTestsTable).where(inArray(ucWaterTestsTable.id, insertedWaterTestIds));
    }
    if (testUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, testUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  /**
   * Registers boundary/exclusion/empty tests for one CSV endpoint.
   *
   * @param endpointPath - e.g. "/api/uc/admin/orders.csv"
   * @param idByDate     - map from DATE_xxx string → the fixture's CSV id cell
   */
  function runCsvBoundaryTests(
    endpointPath: string,
    idByDate: Map<string, string>,
  ): void {
    async function fetchCsvIds(qs: string): Promise<string[]> {
      const { status, headers, text } = await apiFetch(`${endpointPath}?${qs}`);
      assert.equal(status, 200, `Expected 200 from ${endpointPath}?${qs}, got ${status}: ${text}`);
      assert.ok(
        headers.get("content-type")?.startsWith("text/csv"),
        `Expected text/csv from ${endpointPath}, got: ${headers.get("content-type")}`,
      );
      return csvFirstColumnIds(text);
    }

    const range = `from=${DATE_FROM}&to=${DATE_TO}`;

    it("from-boundary row is included in the CSV", async () => {
      const ids = await fetchCsvIds(range);
      assert.ok(
        ids.includes(idByDate.get(DATE_FROM)!),
        `Row at from-boundary (${DATE_FROM}) should be included. CSV IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("to-boundary row is included in the CSV", async () => {
      const ids = await fetchCsvIds(range);
      assert.ok(
        ids.includes(idByDate.get(DATE_TO)!),
        `Row at to-boundary (${DATE_TO}) should be included. CSV IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row inside the range is included in the CSV", async () => {
      const ids = await fetchCsvIds(range);
      assert.ok(
        ids.includes(idByDate.get(DATE_INSIDE)!),
        `Row inside range (${DATE_INSIDE}) should be included. CSV IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row before the from-date is excluded from the CSV", async () => {
      const ids = await fetchCsvIds(range);
      assert.ok(
        !ids.includes(idByDate.get(DATE_BEFORE)!),
        `Row before from-date (${DATE_BEFORE}) must not appear. CSV IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row after the to-date is excluded from the CSV", async () => {
      const ids = await fetchCsvIds(range);
      assert.ok(
        !ids.includes(idByDate.get(DATE_AFTER)!),
        `Row after to-date (${DATE_AFTER}) must not appear. CSV IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("a far-future range yields a CSV with none of our fixture rows", async () => {
      const ids = await fetchCsvIds(`from=${DATE_EMPTY}&to=${DATE_EMPTY}`);
      for (const [date, id] of idByDate) {
        assert.ok(
          !ids.includes(id),
          `Fixture row at ${date} must not appear in the far-future range CSV`,
        );
      }
    });

    it("?from= only excludes earlier rows and keeps later ones", async () => {
      const ids = await fetchCsvIds(`from=${DATE_FROM}`);
      assert.ok(!ids.includes(idByDate.get(DATE_BEFORE)!), "before-row must be excluded");
      for (const date of [DATE_FROM, DATE_INSIDE, DATE_TO, DATE_AFTER]) {
        assert.ok(ids.includes(idByDate.get(date)!), `row at ${date} must be included with ?from= only`);
      }
    });

    it("?to= only excludes later rows and keeps earlier ones", async () => {
      const ids = await fetchCsvIds(`to=${DATE_TO}`);
      assert.ok(!ids.includes(idByDate.get(DATE_AFTER)!), "after-row must be excluded");
      for (const date of [DATE_BEFORE, DATE_FROM, DATE_INSIDE, DATE_TO]) {
        assert.ok(ids.includes(idByDate.get(date)!), `row at ${date} must be included with ?to= only`);
      }
    });

    it("invalid ?from= returns 400, not a CSV", async () => {
      const { status } = await apiFetch(`${endpointPath}?from=not-a-date`);
      assert.equal(status, 400);
    });
  }

  describe("GET /api/uc/admin/orders.csv — date-range filter", () => {
    runCsvBoundaryTests("/api/uc/admin/orders.csv", orderIdByDate);
  });

  describe("GET /api/uc/admin/tickets.csv — date-range filter", () => {
    runCsvBoundaryTests("/api/uc/admin/tickets.csv", ticketIdByDate);
  });

  describe("GET /api/uc/admin/water-tests.csv — date-range filter", () => {
    runCsvBoundaryTests("/api/uc/admin/water-tests.csv", waterTestIdByDate);
  });
});
