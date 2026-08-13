/**
 * Tests for GET /api/uc/admin/orders.csv — zero-line-item edge case.
 *
 * Covers:
 *   1. Row count equals order count when one order has no line items.
 *   2. The zero-item row has the correct number of empty item columns
 *      (padded to the max item count found in the result set).
 *   3. The multi-item row populates all item columns correctly.
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
  ucOrderItemsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-orders-csv-tests";
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
  return `Bearer ${issueToken({ ...claims, firstName: "Orders", lastName: "Test" })}`;
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
      // Row ended right after a comma — trailing empty cell
      cells.push("");
      break;
    }
    if (row[i] === '"') {
      // Quoted field
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
        // If this comma was the last character, the next iteration handles
        // the trailing empty cell via the i === row.length branch above.
      }
    }
  }
  return cells;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_EMAIL = "orders-csv-test-admin@ucfilters-test.internal";

let testUserId: number;
let insertedOrderIds: number[] = [];

// Number of static columns before the item columns in the CSV header/rows.
// id, userId, status, dateCreated, total, currency, paymentMethod,
// paymentReference, promoCode, discountPercent, discountAmount, webhookRecovery,
// shippingName, shippingPhone, shippingAddress, shippingCity, shippingCountry
const STATIC_COL_COUNT = 17;

// Columns per line item: productId, name, qty, total
const COLS_PER_ITEM = 4;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/uc/admin/orders.csv — zero-item edge case", () => {
  before(async () => {
    // Insert a test admin user
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: TEST_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "Orders",
        lastName: "Test",
        isAdmin: false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert test user");
    testUserId = inserted.id;

    // Grant admin access via env var
    process.env["UC_ADMIN_EMAILS"] = TEST_EMAIL;

    // Order A — no line items
    const [orderA] = await db
      .insert(ucOrdersTable)
      .values({
        userId: String(testUserId),
        status: "pending",
        total: "0",
        currency: "KES",
        paymentMethod: "cod",
        paymentReference: "",
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {
          firstName: "Zero",
          lastName: "Items",
          address1: "1 Empty Rd",
          city: "Nairobi",
          country: "KE",
          phone: "+254700000001",
        },
        webhookRecovery: false,
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderA) throw new Error("Failed to insert order A");

    // Order B — two line items
    const [orderB] = await db
      .insert(ucOrdersTable)
      .values({
        userId: String(testUserId),
        status: "processing",
        total: "4598",
        currency: "KES",
        paymentMethod: "mpesa",
        paymentReference: `TEST-REF-${Date.now()}`,
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {
          firstName: "Two",
          lastName: "Items",
          address1: "2 Item Ave",
          city: "Mombasa",
          country: "KE",
          phone: "+254700000002",
        },
        webhookRecovery: false,
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderB) throw new Error("Failed to insert order B");

    insertedOrderIds = [orderA.id, orderB.id];

    // Insert two line items on order B
    await db.insert(ucOrderItemsTable).values([
      {
        orderId: orderB.id,
        productId: 1,
        name: "Hydra Flux",
        quantity: 1,
        total: "3499",
      },
      {
        orderId: orderB.id,
        productId: 22,
        name: "Bottle Filter Cartridge",
        quantity: 1,
        total: "1099",
      },
    ]);
  });

  after(async () => {
    // Cascade delete removes order items via FK; delete orders first
    if (insertedOrderIds.length > 0) {
      await db
        .delete(ucOrderItemsTable)
        .where(inArray(ucOrderItemsTable.orderId, insertedOrderIds));
      await db
        .delete(ucOrdersTable)
        .where(inArray(ucOrdersTable.id, insertedOrderIds));
    }
    if (testUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, testUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  it("returns 200 with CSV content-type", async () => {
    const { status, headers } = await apiFetch("/api/uc/admin/orders.csv", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });
    assert.equal(status, 200);
    assert.ok(
      headers.get("content-type")?.startsWith("text/csv"),
      `Expected text/csv, got: ${headers.get("content-type")}`,
    );
  });

  it("data row count equals order count (no crash on zero-item order)", async () => {
    const { text } = await apiFetch("/api/uc/admin/orders.csv", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });

    // Split on CRLF, drop trailing empty line, skip header
    const lines = text.split("\r\n").filter(l => l.trim());
    const dataLines = lines.slice(1); // skip header

    // Filter to only our fixture orders (other tests may have left rows)
    const ourRows = dataLines.filter(l => {
      const cells = parseCsvRow(l);
      return (
        cells[0] !== undefined &&
        insertedOrderIds.includes(Number(cells[0]))
      );
    });

    assert.equal(
      ourRows.length,
      2,
      `Expected 2 data rows for our fixture orders, got ${ourRows.length}`,
    );
  });

  it("zero-item order row has the correct number of empty item columns", async () => {
    const { text } = await apiFetch("/api/uc/admin/orders.csv", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });

    const lines = text.split("\r\n").filter(l => l.trim());
    const headerLine = lines[0]!;
    const headerCells = parseCsvRow(headerLine);

    // The header must have item column headers for each item slot
    const totalHeaderCols = headerCells.length;
    const itemColCount = totalHeaderCols - STATIC_COL_COUNT;

    // With order B having 2 items, maxItems = 2 → 8 item columns
    assert.equal(
      itemColCount,
      2 * COLS_PER_ITEM,
      `Expected ${2 * COLS_PER_ITEM} item columns in header, got ${itemColCount}`,
    );

    // Find the zero-item order row (order A)
    const dataLines = lines.slice(1);
    const zeroItemRow = dataLines.find(l => {
      const cells = parseCsvRow(l);
      return cells[0] !== undefined && Number(cells[0]) === insertedOrderIds[0];
    });
    assert.ok(zeroItemRow, "Could not find the zero-item order row in the CSV");

    const rowCells = parseCsvRow(zeroItemRow!);

    // Row must have the same total column count as the header
    assert.equal(
      rowCells.length,
      totalHeaderCols,
      `Zero-item row has ${rowCells.length} columns, expected ${totalHeaderCols}`,
    );

    // All item columns in the zero-item row must be empty strings
    const itemCells = rowCells.slice(STATIC_COL_COUNT);
    for (let i = 0; i < itemCells.length; i++) {
      assert.equal(
        itemCells[i],
        "",
        `Item cell [${i}] of zero-item row must be empty, got: "${itemCells[i]}"`,
      );
    }
  });

  it("multi-item order row populates all item columns correctly", async () => {
    const { text } = await apiFetch("/api/uc/admin/orders.csv", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });

    const lines = text.split("\r\n").filter(l => l.trim());
    const headerCells = parseCsvRow(lines[0]!);
    const totalHeaderCols = headerCells.length;

    // Find the multi-item order row (order B)
    const dataLines = lines.slice(1);
    const multiItemRow = dataLines.find(l => {
      const cells = parseCsvRow(l);
      return cells[0] !== undefined && Number(cells[0]) === insertedOrderIds[1];
    });
    assert.ok(multiItemRow, "Could not find the multi-item order row in the CSV");

    const rowCells = parseCsvRow(multiItemRow!);

    // Row must have the same total column count as the header
    assert.equal(
      rowCells.length,
      totalHeaderCols,
      `Multi-item row has ${rowCells.length} columns, expected ${totalHeaderCols}`,
    );

    // Item 1: Hydra Flux, qty 1, total 3499
    const item1Start = STATIC_COL_COUNT;
    assert.equal(rowCells[item1Start],     "1",           "item_1_productId must be 1");
    assert.equal(rowCells[item1Start + 1], "Hydra Flux",  "item_1_name must be Hydra Flux");
    assert.equal(rowCells[item1Start + 2], "1",           "item_1_qty must be 1");
    assert.equal(rowCells[item1Start + 3], "3499",        "item_1_total must be 3499");

    // Item 2: Bottle Filter Cartridge, qty 1, total 1099
    const item2Start = STATIC_COL_COUNT + COLS_PER_ITEM;
    assert.equal(rowCells[item2Start],     "22",                       "item_2_productId must be 22");
    assert.equal(rowCells[item2Start + 1], "Bottle Filter Cartridge",  "item_2_name must be Bottle Filter Cartridge");
    assert.equal(rowCells[item2Start + 2], "1",                        "item_2_qty must be 1");
    assert.equal(rowCells[item2Start + 3], "1099",                     "item_2_total must be 1099");
  });
});
