/**
 * Tests for date-range filtering on the six admin endpoints:
 *   GET /api/uc/admin/orders
 *   GET /api/uc/admin/tickets
 *   GET /api/uc/admin/water-tests
 *   (and the three parallel .csv endpoints share the same parseDateRange helper)
 *
 * Covers:
 *   1. Rows on the from-date and to-date boundaries are included
 *   2. Rows inside the range are included; rows outside are excluded
 *   3. ?from=not-a-date returns 400 with a clear message
 *   4. ?to=2024-02-30 (invalid calendar date) returns 400
 *   5. A range with no matching rows returns an empty array, not an error
 *
 * Uses the real DB (same pattern as feedback-export.test.ts).
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
  process.env["SESSION_SECRET"] ??= "test-secret-for-date-range-tests";
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
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, init);
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}

function authHeader(claims: { id: number | string; email: string }) {
  return `Bearer ${issueToken({ ...claims, firstName: "DateRange", lastName: "Test" })}`;
}

// ── Test date constants ───────────────────────────────────────────────────────
// June 2024 — well in the past so these dates can't accidentally collide with
// any test that uses current timestamps.

const DATE_BEFORE = "2024-06-14";
const DATE_FROM   = "2024-06-15"; // inclusive lower bound
const DATE_INSIDE = "2024-06-16"; // clearly inside the range
const DATE_TO     = "2024-06-17"; // inclusive upper bound
const DATE_AFTER  = "2024-06-18";
const DATE_EMPTY  = "2099-01-01"; // far future — guaranteed to match nothing

/** Returns a Date object at noon UTC on a given YYYY-MM-DD string. */
function tsAt(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00Z`);
}

// Ordered list used both for fixture insertion and for building the indexByDate maps.
const DATES_LABELLED = [
  { label: "before", date: DATE_BEFORE },
  { label: "from",   date: DATE_FROM   },
  { label: "inside", date: DATE_INSIDE },
  { label: "to",     date: DATE_TO     },
  { label: "after",  date: DATE_AFTER  },
] as const;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_EMAIL = "date-range-test-admin@ucfilters-test.internal";

let testUserId: number;
let insertedOrderIds:     number[] = [];
let insertedTicketIds:    string[] = [];
let insertedWaterTestIds: string[] = [];

// Maps populated after insertion; used by the shared runBoundaryTests helper.
const orderIndexByDate    = new Map<string, number | string>();
const ticketIndexByDate   = new Map<string, number | string>();
const waterTestIndexByDate = new Map<string, number | string>();

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Date-range filter — admin endpoints", () => {
  before(async () => {
    // ── Create the admin test user ──────────────────────────────────────────
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: TEST_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "DateRange",
        lastName: "Test",
        isAdmin: false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert test admin user");
    testUserId = inserted.id;

    // Admin auth uses the UC_ADMIN_EMAILS env var, same as all other tests.
    process.env["UC_ADMIN_EMAILS"] = TEST_EMAIL;

    // ── Insert five orders — one at each test date ──────────────────────────
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
            firstName: "DateRange",
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
    }

    // ── Insert five tickets — one at each test date ─────────────────────────
    for (const { label, date } of DATES_LABELLED) {
      const id = `TKT-DR-TEST-${label}-${testUserId}`;
      await db.insert(ucTicketsTable).values({
        id,
        userId:               String(testUserId),
        productModel:         `TestModel-${label}`,
        issueDescription:     `Date range test ticket: ${label}`,
        preferredContactTime: "Any time",
        photos:               [],
        videos:               [],
        status:               "submitted",
        createdAt:            tsAt(date),
      });
      insertedTicketIds.push(id);
    }

    // ── Insert five water-test bookings — one at each test date ────────────
    for (const { label, date } of DATES_LABELLED) {
      const id = `WT-DR-TEST-${label}-${testUserId}`;
      await db.insert(ucWaterTestsTable).values({
        id,
        userId:      String(testUserId),
        name:        `DateRange ${label}`,
        address:     "1 Test Rd, Nairobi",
        phone:       "+254700000000",
        waterSource: "Municipal",
        concerns:    `Date range test booking: ${label}`,
        photos:      [],
        videos:      [],
        status:      "pending",
        createdAt:   tsAt(date),
      });
      insertedWaterTestIds.push(id);
    }

    // ── Build lookup maps (date string → inserted ID) ──────────────────────
    DATES_LABELLED.forEach(({ date }, i) => {
      orderIndexByDate.set(date,    insertedOrderIds[i]!);
      ticketIndexByDate.set(date,   insertedTicketIds[i]!);
      waterTestIndexByDate.set(date, insertedWaterTestIds[i]!);
    });
  });

  after(async () => {
    if (insertedOrderIds.length) {
      await db
        .delete(ucOrdersTable)
        .where(inArray(ucOrdersTable.id, insertedOrderIds));
    }
    if (insertedTicketIds.length) {
      await db
        .delete(ucTicketsTable)
        .where(inArray(ucTicketsTable.id, insertedTicketIds));
    }
    if (insertedWaterTestIds.length) {
      await db
        .delete(ucWaterTestsTable)
        .where(inArray(ucWaterTestsTable.id, insertedWaterTestIds));
    }
    if (testUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, testUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  // ── parseDateRange: invalid-date rejection tests ──────────────────────────
  // parseDateRange is shared by all six endpoints; testing on /admin/orders
  // is sufficient since any failure there indicates a shared-helper failure.

  describe("parseDateRange — invalid ?from= / ?to= rejection", () => {
    it("?from=not-a-date → 400 with a message mentioning 'from'", async () => {
      const { status, body } = await apiFetch(
        "/api/uc/admin/orders?from=not-a-date",
        { headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) } },
      );
      assert.equal(status, 400);
      assert.ok(
        typeof body === "object" && body !== null && "error" in body,
        `Expected JSON { error: '...' }, got: ${JSON.stringify(body)}`,
      );
      assert.ok(
        (body as { error: string }).error.toLowerCase().includes("from"),
        `Error message should mention '?from=', got: ${JSON.stringify(body)}`,
      );
    });

    it("?to=not-a-date → 400 with a message mentioning 'to'", async () => {
      const { status, body } = await apiFetch(
        "/api/uc/admin/orders?to=not-a-date",
        { headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) } },
      );
      assert.equal(status, 400);
      assert.ok(
        typeof body === "object" && body !== null && "error" in body,
        `Expected JSON { error: '...' }, got: ${JSON.stringify(body)}`,
      );
      assert.ok(
        (body as { error: string }).error.toLowerCase().includes("to"),
        `Error message should mention '?to=', got: ${JSON.stringify(body)}`,
      );
    });

    it("?from=2024-02-30 (invalid calendar date) → 400", async () => {
      const { status, body } = await apiFetch(
        "/api/uc/admin/orders?from=2024-02-30",
        { headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) } },
      );
      assert.equal(status, 400);
      assert.ok(
        typeof body === "object" && body !== null && "error" in body,
        `Expected JSON { error: '...' }, got: ${JSON.stringify(body)}`,
      );
    });

    it("?to=2024-02-30 (invalid calendar date) → 400", async () => {
      const { status, body } = await apiFetch(
        "/api/uc/admin/orders?to=2024-02-30",
        { headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) } },
      );
      assert.equal(status, 400);
      assert.ok(
        typeof body === "object" && body !== null && "error" in body,
        `Expected JSON { error: '...' }, got: ${JSON.stringify(body)}`,
      );
    });
  });

  // ── Shared boundary/exclusion/empty helper ────────────────────────────────
  /**
   * Registers boundary, exclusion, and empty-result tests for one JSON endpoint.
   *
   * @param endpointPath - e.g. "/api/uc/admin/orders"
   * @param idField      - the JSON key holding the row ID (always "id")
   * @param indexByDate  - map from DATE_xxx string → the fixture ID at that date
   */
  function runBoundaryTests(
    endpointPath: string,
    indexByDate: Map<string, number | string>,
  ): void {
    const auth = () => authHeader({ id: testUserId, email: TEST_EMAIL });

    /** Fetch the endpoint with ?qs, assert 200, return only our fixture IDs. */
    async function fetchFixtureIds(qs: string): Promise<(number | string)[]> {
      const { status, body } = await apiFetch(
        `${endpointPath}?${qs}`,
        { headers: { Authorization: auth() } },
      );
      assert.equal(
        status,
        200,
        `Expected 200 from ${endpointPath}?${qs}, got ${status}: ${JSON.stringify(body)}`,
      );
      assert.ok(
        Array.isArray(body),
        `Expected array from ${endpointPath}?${qs}, got: ${JSON.stringify(body)}`,
      );
      const allFixtureIds = new Set([...indexByDate.values()]);
      return (body as Array<Record<string, unknown>>)
        .filter(r => allFixtureIds.has(r["id"] as number | string))
        .map(r => r["id"] as number | string);
    }

    it("from-boundary row is included in results", async () => {
      const ids = await fetchFixtureIds(`from=${DATE_FROM}&to=${DATE_TO}`);
      assert.ok(
        ids.includes(indexByDate.get(DATE_FROM)!),
        `Row at from-boundary (${DATE_FROM}) should be included. Found IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("to-boundary row is included in results", async () => {
      const ids = await fetchFixtureIds(`from=${DATE_FROM}&to=${DATE_TO}`);
      assert.ok(
        ids.includes(indexByDate.get(DATE_TO)!),
        `Row at to-boundary (${DATE_TO}) should be included. Found IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row inside the range is included in results", async () => {
      const ids = await fetchFixtureIds(`from=${DATE_FROM}&to=${DATE_TO}`);
      assert.ok(
        ids.includes(indexByDate.get(DATE_INSIDE)!),
        `Row inside range (${DATE_INSIDE}) should be included. Found IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row before the from-date is excluded from results", async () => {
      const ids = await fetchFixtureIds(`from=${DATE_FROM}&to=${DATE_TO}`);
      assert.ok(
        !ids.includes(indexByDate.get(DATE_BEFORE)!),
        `Row before from-date (${DATE_BEFORE}) must not appear. Found IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("row after the to-date is excluded from results", async () => {
      const ids = await fetchFixtureIds(`from=${DATE_FROM}&to=${DATE_TO}`);
      assert.ok(
        !ids.includes(indexByDate.get(DATE_AFTER)!),
        `Row after to-date (${DATE_AFTER}) must not appear. Found IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("a range with no matching rows returns 200 with an empty array", async () => {
      const { status, body } = await apiFetch(
        `${endpointPath}?from=${DATE_EMPTY}&to=${DATE_EMPTY}`,
        { headers: { Authorization: auth() } },
      );
      assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(
        Array.isArray(body),
        `Expected an array for empty-range result, got: ${JSON.stringify(body)}`,
      );
      // No fixture IDs should appear — and since DATE_EMPTY is the year 2099,
      // the array should be empty in practice.
      assert.equal(
        (body as unknown[]).length,
        0,
        `Expected [] for far-future range, got ${(body as unknown[]).length} rows`,
      );
    });
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  describe("GET /api/uc/admin/orders — date-range filter", () => {
    runBoundaryTests("/api/uc/admin/orders", orderIndexByDate);
  });

  // ── Half-bounded ranges ───────────────────────────────────────────────────
  // parseDateRange is shared by all six endpoints, so covering /admin/orders
  // is sufficient for the null-bound wiring.

  describe("GET /api/uc/admin/orders — half-bounded ranges", () => {
    const auth = () => authHeader({ id: testUserId, email: TEST_EMAIL });

    async function fetchFixtureIds(qs: string): Promise<(number | string)[]> {
      const { status, body } = await apiFetch(
        `/api/uc/admin/orders?${qs}`,
        { headers: { Authorization: auth() } },
      );
      assert.equal(
        status,
        200,
        `Expected 200 from /api/uc/admin/orders?${qs}, got ${status}: ${JSON.stringify(body)}`,
      );
      assert.ok(Array.isArray(body), `Expected array, got: ${JSON.stringify(body)}`);
      const allFixtureIds = new Set([...orderIndexByDate.values()]);
      return (body as Array<Record<string, unknown>>)
        .filter(r => allFixtureIds.has(r["id"] as number | string))
        .map(r => r["id"] as number | string);
    }

    it("?from= only: includes rows on and after the from-date", async () => {
      const ids = await fetchFixtureIds(`from=${DATE_FROM}`);
      for (const date of [DATE_FROM, DATE_INSIDE, DATE_TO, DATE_AFTER]) {
        assert.ok(
          ids.includes(orderIndexByDate.get(date)!),
          `Row at ${date} should be included with ?from=${DATE_FROM} only. Found IDs: ${JSON.stringify(ids)}`,
        );
      }
    });

    it("?from= only: excludes rows before the from-date", async () => {
      const ids = await fetchFixtureIds(`from=${DATE_FROM}`);
      assert.ok(
        !ids.includes(orderIndexByDate.get(DATE_BEFORE)!),
        `Row at ${DATE_BEFORE} must be excluded with ?from=${DATE_FROM} only. Found IDs: ${JSON.stringify(ids)}`,
      );
    });

    it("?to= only: includes rows on and before the to-date", async () => {
      const ids = await fetchFixtureIds(`to=${DATE_TO}`);
      for (const date of [DATE_BEFORE, DATE_FROM, DATE_INSIDE, DATE_TO]) {
        assert.ok(
          ids.includes(orderIndexByDate.get(date)!),
          `Row at ${date} should be included with ?to=${DATE_TO} only. Found IDs: ${JSON.stringify(ids)}`,
        );
      }
    });

    it("?to= only: excludes rows after the to-date", async () => {
      const ids = await fetchFixtureIds(`to=${DATE_TO}`);
      assert.ok(
        !ids.includes(orderIndexByDate.get(DATE_AFTER)!),
        `Row at ${DATE_AFTER} must be excluded with ?to=${DATE_TO} only. Found IDs: ${JSON.stringify(ids)}`,
      );
    });
  });

  // ── Tickets ───────────────────────────────────────────────────────────────

  describe("GET /api/uc/admin/tickets — date-range filter", () => {
    runBoundaryTests("/api/uc/admin/tickets", ticketIndexByDate);
  });

  // ── Water-tests ───────────────────────────────────────────────────────────

  describe("GET /api/uc/admin/water-tests — date-range filter", () => {
    runBoundaryTests("/api/uc/admin/water-tests", waterTestIndexByDate);
  });
});
