/**
 * Tests for GET /api/uc/admin/tickets.csv and GET /api/uc/admin/water-tests.csv.
 *
 * Covers:
 *   Tickets CSV:
 *     1. Unfiltered export — returns all tickets regardless of status
 *     2. ?status=resolved returns only resolved tickets (not submitted ones)
 *     3. ?status=submitted returns only submitted tickets (not resolved ones)
 *     4. Invalid status value — returns a valid CSV with zero data rows (not an error)
 *     5. Returns 403 when no admin token is provided
 *     6. Returns 200 with CSV Content-Type and Content-Disposition headers
 *     7. CSV header row matches expected columns
 *
 *   Water-tests CSV:
 *     8. Unfiltered export — returns all water tests regardless of status
 *     9. ?status=completed returns only completed rows (not pending ones)
 *     10. ?status=pending returns only pending rows (not completed ones)
 *     11. Invalid status value — returns a valid CSV with zero data rows (not an error)
 *     12. Returns 403 when no admin token is provided
 *     13. Returns 200 with CSV Content-Type and Content-Disposition headers
 *     14. CSV header row matches expected columns
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
  ucTicketsTable,
  ucWaterTestsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-csv-status-filter-tests";
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
): Promise<{ status: number; headers: Headers; text: string }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, init);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

function authHeader(claims: { id: number | string; email: string }) {
  return `Bearer ${issueToken({ ...claims, firstName: "CSV", lastName: "Test" })}`;
}

/** Extract data rows (non-header, non-empty) whose first column matches one of our fixture IDs. */
function fixtureDataRows(csvText: string, fixtureIds: string[]): string[] {
  const idSet = new Set(fixtureIds);
  return csvText
    .split("\r\n")
    .filter(l => l.trim())
    .slice(1)                         // drop header
    .filter(l => idSet.has(l.split(",")[0]?.replace(/^"|"$/g, "") ?? ""));
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const TEST_EMAIL = "tickets-water-csv-test@ucfilters-test.internal";

let testUserId: number;
let insertedTicketIds: string[] = [];
let insertedWaterTestIds: string[] = [];

// ═══════════════════════════════════════════════════════════════════════════════
// TICKETS CSV
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/uc/admin/tickets.csv", () => {
  const TICKET_CSV_HEADERS =
    "id,userId,productModel,issueDescription,preferredContactTime,photoCount,videoCount,status,createdAt";

  before(async () => {
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: TEST_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "CSV",
        lastName: "Test",
        isAdmin: false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert test user for tickets CSV");
    testUserId = inserted.id;

    process.env["UC_ADMIN_EMAILS"] = TEST_EMAIL;

    // Two tickets: one "submitted", one "resolved"
    const ts = Date.now();
    const idSubmitted = `TKT-TEST-${ts}-S`;
    const idResolved  = `TKT-TEST-${ts}-R`;

    await db.insert(ucTicketsTable).values([
      {
        id: idSubmitted,
        userId: String(testUserId),
        productModel: "Sweet Home",
        issueDescription: "Water tastes off",
        preferredContactTime: "Morning",
        photos: [],
        videos: [],
        status: "submitted",
      },
      {
        id: idResolved,
        userId: String(testUserId),
        productModel: "Hydra Flux",
        issueDescription: "Filter leaking",
        preferredContactTime: "Afternoon",
        photos: ["photo1.jpg"],
        videos: [],
        status: "resolved",
      },
    ]);

    insertedTicketIds = [idSubmitted, idResolved];
  });

  after(async () => {
    if (insertedTicketIds.length > 0) {
      await db
        .delete(ucTicketsTable)
        .where(inArray(ucTicketsTable.id, insertedTicketIds));
    }
    if (testUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, testUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  it("returns 403 when no admin token is provided", async () => {
    const { status } = await apiFetch("/api/uc/admin/tickets.csv");
    assert.equal(status, 403);
  });

  it("returns 200 with CSV Content-Type and Content-Disposition headers", async () => {
    const { status, headers } = await apiFetch("/api/uc/admin/tickets.csv", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    assert.equal(status, 200);
    assert.ok(
      headers.get("content-type")?.startsWith("text/csv"),
      `Expected text/csv, got: ${headers.get("content-type")}`,
    );
    const cd = headers.get("content-disposition") ?? "";
    assert.ok(cd.includes("attachment"), `Content-Disposition must be attachment, got: ${cd}`);
    assert.ok(/tickets_/.test(cd), `Content-Disposition must include filename with 'tickets_', got: ${cd}`);
  });

  it("CSV header row matches expected columns", async () => {
    const { text } = await apiFetch("/api/uc/admin/tickets.csv", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    const firstLine = text.split("\r\n")[0];
    assert.equal(
      firstLine,
      TICKET_CSV_HEADERS,
      `Header mismatch — got: ${firstLine}`,
    );
  });

  it("unfiltered export contains both fixture tickets (submitted and resolved)", async () => {
    const { text } = await apiFetch("/api/uc/admin/tickets.csv", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    const rows = fixtureDataRows(text, insertedTicketIds);
    assert.equal(rows.length, 2, `Expected 2 fixture rows in unfiltered export, got ${rows.length}`);
  });

  it("?status=resolved returns only the resolved ticket", async () => {
    const { text } = await apiFetch("/api/uc/admin/tickets.csv?status=resolved", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    const rows = fixtureDataRows(text, insertedTicketIds);
    assert.equal(rows.length, 1, `Expected 1 fixture row in resolved export, got ${rows.length}`);
    assert.ok(
      rows[0]!.includes("resolved"),
      `Row must have status=resolved: ${rows[0]}`,
    );
    assert.ok(
      !rows[0]!.includes("submitted"),
      `Row must not contain status=submitted: ${rows[0]}`,
    );
  });

  it("?status=submitted returns only the submitted ticket", async () => {
    const { text } = await apiFetch("/api/uc/admin/tickets.csv?status=submitted", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    const rows = fixtureDataRows(text, insertedTicketIds);
    assert.equal(rows.length, 1, `Expected 1 fixture row in submitted export, got ${rows.length}`);
    assert.ok(
      rows[0]!.includes("submitted"),
      `Row must have status=submitted: ${rows[0]}`,
    );
  });

  it("invalid status value returns a valid CSV with zero fixture data rows", async () => {
    const { status, text } = await apiFetch(
      "/api/uc/admin/tickets.csv?status=nonexistent_status_xyz",
      { headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) } },
    );
    // Must be a 200 CSV response — the filter simply yields no matching rows
    assert.equal(status, 200);
    assert.ok(
      text.startsWith(TICKET_CSV_HEADERS),
      `Response must start with header row, got: ${text.slice(0, 80)}`,
    );
    const rows = fixtureDataRows(text, insertedTicketIds);
    assert.equal(
      rows.length,
      0,
      `Invalid status must yield zero fixture rows, got ${rows.length}`,
    );
  });

  it("CSV data rows include correct photoCount and videoCount values", async () => {
    const { text } = await apiFetch("/api/uc/admin/tickets.csv", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    const rows = fixtureDataRows(text, insertedTicketIds);
    // submitted ticket: 0 photos, 0 videos
    const submittedRow = rows.find(r => r.includes(insertedTicketIds[0]!));
    // resolved ticket: 1 photo, 0 videos
    const resolvedRow = rows.find(r => r.includes(insertedTicketIds[1]!));

    assert.ok(submittedRow, "Could not find submitted-ticket row");
    assert.ok(resolvedRow, "Could not find resolved-ticket row");

    // Columns: id(0), userId(1), productModel(2), issueDescription(3),
    //          preferredContactTime(4), photoCount(5), videoCount(6), status(7), createdAt(8)
    const submittedCells = submittedRow!.split(",");
    assert.equal(submittedCells[5], "0", `submitted ticket photoCount must be 0, got: ${submittedCells[5]}`);
    assert.equal(submittedCells[6], "0", `submitted ticket videoCount must be 0, got: ${submittedCells[6]}`);

    const resolvedCells = resolvedRow!.split(",");
    assert.equal(resolvedCells[5], "1", `resolved ticket photoCount must be 1, got: ${resolvedCells[5]}`);
    assert.equal(resolvedCells[6], "0", `resolved ticket videoCount must be 0, got: ${resolvedCells[6]}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WATER-TESTS CSV
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/uc/admin/water-tests.csv", () => {
  const WATER_TEST_CSV_HEADERS =
    "id,userId,name,address,phone,waterSource,concerns,photoCount,videoCount,status,createdAt";

  // Reuse the same test user created by the tickets describe block; but we need
  // a separate describe with its own before/after to keep fixtures isolated and
  // avoid teardown ordering issues.

  let waterTestUserId: number;
  const WATER_TEST_EMAIL = "water-csv-test@ucfilters-test.internal";

  before(async () => {
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: WATER_TEST_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "WaterCSV",
        lastName: "Test",
        isAdmin: false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert test user for water-tests CSV");
    waterTestUserId = inserted.id;

    process.env["UC_ADMIN_EMAILS"] = WATER_TEST_EMAIL;

    const ts = Date.now();
    const idPending   = `WT-TEST-${ts}-P`;
    const idCompleted = `WT-TEST-${ts}-C`;

    await db.insert(ucWaterTestsTable).values([
      {
        id: idPending,
        userId: String(waterTestUserId),
        name: "Alice Test",
        address: "1 Pending St, Nairobi",
        phone: "+254700000010",
        waterSource: "Municipal",
        concerns: "Tastes like chlorine",
        photos: [],
        videos: [],
        status: "pending",
      },
      {
        id: idCompleted,
        userId: String(waterTestUserId),
        name: "Bob Test",
        address: "2 Done Ave, Mombasa",
        phone: "+254700000011",
        waterSource: "Borehole",
        concerns: "High TDS",
        photos: ["sample.jpg", "sample2.jpg"],
        videos: ["sample.mp4"],
        status: "completed",
      },
    ]);

    insertedWaterTestIds = [idPending, idCompleted];
  });

  after(async () => {
    if (insertedWaterTestIds.length > 0) {
      await db
        .delete(ucWaterTestsTable)
        .where(inArray(ucWaterTestsTable.id, insertedWaterTestIds));
    }
    if (waterTestUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, waterTestUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  it("returns 403 when no admin token is provided", async () => {
    const { status } = await apiFetch("/api/uc/admin/water-tests.csv");
    assert.equal(status, 403);
  });

  it("returns 200 with CSV Content-Type and Content-Disposition headers", async () => {
    const { status, headers } = await apiFetch("/api/uc/admin/water-tests.csv", {
      headers: { Authorization: authHeader({ id: waterTestUserId, email: WATER_TEST_EMAIL }) },
    });
    assert.equal(status, 200);
    assert.ok(
      headers.get("content-type")?.startsWith("text/csv"),
      `Expected text/csv, got: ${headers.get("content-type")}`,
    );
    const cd = headers.get("content-disposition") ?? "";
    assert.ok(cd.includes("attachment"), `Content-Disposition must be attachment, got: ${cd}`);
    assert.ok(
      /water-tests_/.test(cd),
      `Content-Disposition must include filename with 'water-tests_', got: ${cd}`,
    );
  });

  it("CSV header row matches expected columns", async () => {
    const { text } = await apiFetch("/api/uc/admin/water-tests.csv", {
      headers: { Authorization: authHeader({ id: waterTestUserId, email: WATER_TEST_EMAIL }) },
    });
    const firstLine = text.split("\r\n")[0];
    assert.equal(
      firstLine,
      WATER_TEST_CSV_HEADERS,
      `Header mismatch — got: ${firstLine}`,
    );
  });

  it("unfiltered export contains both fixture water tests (pending and completed)", async () => {
    const { text } = await apiFetch("/api/uc/admin/water-tests.csv", {
      headers: { Authorization: authHeader({ id: waterTestUserId, email: WATER_TEST_EMAIL }) },
    });
    const rows = fixtureDataRows(text, insertedWaterTestIds);
    assert.equal(rows.length, 2, `Expected 2 fixture rows in unfiltered export, got ${rows.length}`);
  });

  it("?status=completed returns only the completed water test", async () => {
    const { text } = await apiFetch("/api/uc/admin/water-tests.csv?status=completed", {
      headers: { Authorization: authHeader({ id: waterTestUserId, email: WATER_TEST_EMAIL }) },
    });
    const rows = fixtureDataRows(text, insertedWaterTestIds);
    assert.equal(rows.length, 1, `Expected 1 fixture row in completed export, got ${rows.length}`);
    assert.ok(
      rows[0]!.includes("completed"),
      `Row must have status=completed: ${rows[0]}`,
    );
  });

  it("?status=pending returns only the pending water test", async () => {
    const { text } = await apiFetch("/api/uc/admin/water-tests.csv?status=pending", {
      headers: { Authorization: authHeader({ id: waterTestUserId, email: WATER_TEST_EMAIL }) },
    });
    const rows = fixtureDataRows(text, insertedWaterTestIds);
    assert.equal(rows.length, 1, `Expected 1 fixture row in pending export, got ${rows.length}`);
    assert.ok(
      rows[0]!.includes("pending"),
      `Row must have status=pending: ${rows[0]}`,
    );
  });

  it("invalid status value returns a valid CSV with zero fixture data rows", async () => {
    const { status, text } = await apiFetch(
      "/api/uc/admin/water-tests.csv?status=bogus_status_abc",
      { headers: { Authorization: authHeader({ id: waterTestUserId, email: WATER_TEST_EMAIL }) } },
    );
    assert.equal(status, 200);
    assert.ok(
      text.startsWith(WATER_TEST_CSV_HEADERS),
      `Response must start with header row, got: ${text.slice(0, 100)}`,
    );
    const rows = fixtureDataRows(text, insertedWaterTestIds);
    assert.equal(
      rows.length,
      0,
      `Invalid status must yield zero fixture rows, got ${rows.length}`,
    );
  });

  it("CSV data rows include correct photoCount and videoCount values", async () => {
    const { text } = await apiFetch("/api/uc/admin/water-tests.csv", {
      headers: { Authorization: authHeader({ id: waterTestUserId, email: WATER_TEST_EMAIL }) },
    });
    const rows = fixtureDataRows(text, insertedWaterTestIds);

    // pending: 0 photos, 0 videos
    const pendingRow = rows.find(r => r.includes(insertedWaterTestIds[0]!));
    // completed: 2 photos, 1 video
    const completedRow = rows.find(r => r.includes(insertedWaterTestIds[1]!));

    assert.ok(pendingRow,   "Could not find pending water-test row");
    assert.ok(completedRow, "Could not find completed water-test row");

    // Columns: id(0), userId(1), name(2), address(3), phone(4),
    //          waterSource(5), concerns(6), photoCount(7), videoCount(8), status(9), createdAt(10)
    // Note: address may contain commas so we split on the known IDs instead;
    // a simpler check is to verify the row contains the expected count values.
    assert.ok(
      pendingRow!.includes(",0,0,pending,"),
      `pending row must have photoCount=0, videoCount=0, status=pending: ${pendingRow}`,
    );
    assert.ok(
      completedRow!.includes(",2,1,completed,"),
      `completed row must have photoCount=2, videoCount=1, status=completed: ${completedRow}`,
    );
  });
});
