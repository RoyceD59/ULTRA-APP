/**
 * Tests for GET /api/uc/admin/orders.csv — zero-line-item, status-filter edge cases,
 * and CSV/list-API parity verification.
 *
 * Fixtures
 * ─────────
 *   Order A  pending     / 0 items   ← zero-item fixture
 *   Order B  processing  / 2 items   ← multi-item fixture (excluded by pending filter)
 *   Order C  pending     / 1 item    ← same-status fixture with items
 *
 * Covers (unfiltered export)
 *   1. Row count equals order count when one order has no line items.
 *   2. The zero-item row has the correct number of empty item columns
 *      (padded to the max item count found in the result set, which is 2 via order B).
 *   3. The multi-item row populates all item columns correctly.
 *
 * Covers (?status=pending export — the core task-218 scenario)
 *   4. maxItems is computed only from the filtered orders (1, via order C).
 *   5. Order A's row is padded to 1 item width — all item cells empty.
 *   6. Order C's row contains the correct item data.
 *   7. Order B (processing) is absent from the filtered CSV.
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
// [0] = order A (pending, 0 items)
// [1] = order B (processing, 2 items)
// [2] = order C (pending, 1 item)
let insertedOrderIds: number[] = [];

// Number of static columns before the item columns in the CSV header/rows.
// id, userId, status, dateCreated, total, currency, paymentMethod,
// paymentReference, promoCode, discountPercent, discountAmount, webhookRecovery,
// shippingName, shippingPhone, shippingAddress, shippingCity, shippingCountry
const STATIC_COL_COUNT = 17;

// Columns per line item: productId, name, qty, total
const COLS_PER_ITEM = 4;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/uc/admin/orders.csv — zero-item edge case and status-filter padding", () => {
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

    // Order A — pending, no line items
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

    // Order B — processing, two line items (excluded from status=pending filter)
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

    // Order C — pending, one line item (same status as order A but has items,
    // so ?status=pending must pad order A's row to order C's item width)
    const [orderC] = await db
      .insert(ucOrdersTable)
      .values({
        userId: String(testUserId),
        status: "pending",
        total: "1999",
        currency: "KES",
        paymentMethod: "cod",
        paymentReference: "",
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {
          firstName: "One",
          lastName: "Item",
          address1: "3 Faucet Ln",
          city: "Kisumu",
          country: "KE",
          phone: "+254700000003",
        },
        webhookRecovery: false,
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderC) throw new Error("Failed to insert order C");

    insertedOrderIds = [orderA.id, orderB.id, orderC.id];

    // Two line items on order B
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

    // One line item on order C
    await db.insert(ucOrderItemsTable).values([
      {
        orderId: orderC.id,
        productId: 23,
        name: "Faucet Filter Cartridge",
        quantity: 2,
        total: "1999",
      },
    ]);
  });

  after(async () => {
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

  // ── Unfiltered export ───────────────────────────────────────────────────────

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
      3,
      `Expected 3 data rows for our fixture orders, got ${ourRows.length}`,
    );
  });

  it("zero-item order row is padded to match the global max-item width", async () => {
    const { text } = await apiFetch("/api/uc/admin/orders.csv", {
      headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) },
    });

    const lines = text.split("\r\n").filter(l => l.trim());
    const headerLine = lines[0]!;
    const headerCells = parseCsvRow(headerLine);

    // The header must have item column headers for each item slot.
    // maxItems across all fixtures = 2 (order B) → 8 item columns.
    const totalHeaderCols = headerCells.length;
    const itemColCount = totalHeaderCols - STATIC_COL_COUNT;

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

  // ── Status-filter export (?status=pending) ──────────────────────────────────
  //
  // The pending filter returns order A (0 items) and order C (1 item).
  // maxItems is computed only from the filtered set → 1.
  // Header must have STATIC_COL_COUNT + COLS_PER_ITEM columns.
  // Order A's row must be padded with one set of empty item columns.
  // Order B (processing, 2 items) must be absent — its larger item count
  // must NOT inflate the filtered export's column width.

  it("?status=pending returns 200 with CSV content-type", async () => {
    const { status, headers } = await apiFetch(
      "/api/uc/admin/orders.csv?status=pending",
      { headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) } },
    );
    assert.equal(status, 200);
    assert.ok(
      headers.get("content-type")?.startsWith("text/csv"),
      `Expected text/csv, got: ${headers.get("content-type")}`,
    );
  });

  it("?status=pending header item-column count reflects only the filtered orders", async () => {
    // Filtered set: order A (0 items) + order C (1 item) → maxItems = 1
    // Header must have STATIC_COL_COUNT + 1*COLS_PER_ITEM columns, NOT the
    // 2-item width that order B (processing) would introduce.
    const { text } = await apiFetch(
      "/api/uc/admin/orders.csv?status=pending",
      { headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) } },
    );

    const lines = text.split("\r\n").filter(l => l.trim());
    assert.ok(lines.length >= 1, "CSV must have at least a header row");

    const headerCells = parseCsvRow(lines[0]!);
    const expectedCols = STATIC_COL_COUNT + 1 * COLS_PER_ITEM;

    assert.equal(
      headerCells.length,
      expectedCols,
      `Header must have ${expectedCols} columns (maxItems=1 from pending orders only); ` +
        `got ${headerCells.length}`,
    );
  });

  it("?status=pending zero-item row (order A) is padded to match the pending-filtered header", async () => {
    const { text } = await apiFetch(
      "/api/uc/admin/orders.csv?status=pending",
      { headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) } },
    );

    const lines = text.split("\r\n").filter(l => l.trim());
    const totalHeaderCols = parseCsvRow(lines[0]!).length; // STATIC + 1*COLS_PER_ITEM

    // Find order A in the filtered result
    const dataLines = lines.slice(1);
    const orderARow = dataLines.find(l => {
      const cells = parseCsvRow(l);
      return cells[0] !== undefined && Number(cells[0]) === insertedOrderIds[0];
    });
    assert.ok(
      orderARow,
      "Could not find order A (pending, zero items) in the filtered CSV",
    );

    const rowCells = parseCsvRow(orderARow!);

    // Width must match header
    assert.equal(
      rowCells.length,
      totalHeaderCols,
      `Order A row has ${rowCells.length} columns but header has ${totalHeaderCols}`,
    );

    // Item columns (the padding) must all be empty
    const itemCells = rowCells.slice(STATIC_COL_COUNT);
    assert.equal(itemCells.length, COLS_PER_ITEM, "Expected exactly one item slot padded");
    for (let i = 0; i < itemCells.length; i++) {
      assert.equal(
        itemCells[i],
        "",
        `Padded item cell [${i}] of order A must be empty, got: "${itemCells[i]}"`,
      );
    }
  });

  it("?status=pending item-bearing row (order C) contains correct item data", async () => {
    const { text } = await apiFetch(
      "/api/uc/admin/orders.csv?status=pending",
      { headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) } },
    );

    const lines = text.split("\r\n").filter(l => l.trim());
    const totalHeaderCols = parseCsvRow(lines[0]!).length;

    const dataLines = lines.slice(1);
    const orderCRow = dataLines.find(l => {
      const cells = parseCsvRow(l);
      return cells[0] !== undefined && Number(cells[0]) === insertedOrderIds[2];
    });
    assert.ok(
      orderCRow,
      "Could not find order C (pending, one item) in the filtered CSV",
    );

    const rowCells = parseCsvRow(orderCRow!);

    // Width must match header
    assert.equal(
      rowCells.length,
      totalHeaderCols,
      `Order C row has ${rowCells.length} columns but header has ${totalHeaderCols}`,
    );

    // Item 1: Faucet Filter Cartridge, qty 2, total 1999
    const itemStart = STATIC_COL_COUNT;
    assert.equal(rowCells[itemStart],     "23",                      "item_1_productId must be 23");
    assert.equal(rowCells[itemStart + 1], "Faucet Filter Cartridge", "item_1_name must be Faucet Filter Cartridge");
    assert.equal(rowCells[itemStart + 2], "2",                       "item_1_qty must be 2");
    assert.equal(rowCells[itemStart + 3], "1999",                    "item_1_total must be 1999");
  });

  it("?status=pending excludes the processing order (order B) and its wider item count", async () => {
    const { text } = await apiFetch(
      "/api/uc/admin/orders.csv?status=pending",
      { headers: { Authorization: authHeader({ id: testUserId, email: TEST_EMAIL }) } },
    );

    const lines = text.split("\r\n").filter(l => l.trim());
    const dataLines = lines.slice(1);

    const orderBPresent = dataLines.some(l => {
      const cells = parseCsvRow(l);
      return cells[0] !== undefined && Number(cells[0]) === insertedOrderIds[1];
    });

    assert.equal(
      orderBPresent,
      false,
      "Order B (processing, 2 items) must not appear in a ?status=pending filtered CSV",
    );
  });
});

// ── Symmetric-count edge case ─────────────────────────────────────────────────

const SYMMETRIC_EMAIL = "orders-csv-symmetric-test@ucfilters-test.internal";

// Unique sentinel status that will never appear in real orders, used as a
// ?status= filter so every CSV request in this suite sees exactly our two
// fixtures regardless of whatever else is in the shared database.
const SYMMETRIC_STATUS = "sym-csv-test-two-items-each";

let symmetricUserId: number;
let symmetricOrderIds: number[] = [];

describe("GET /api/uc/admin/orders.csv — symmetric item count (no padding needed)", () => {
  before(async () => {
    // Insert a test admin user
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: SYMMETRIC_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "Symmetric",
        lastName: "Test",
        isAdmin: false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert symmetric test user");
    symmetricUserId = inserted.id;

    process.env["UC_ADMIN_EMAILS"] = SYMMETRIC_EMAIL;

    // Order C — two line items; sentinel status isolates this suite's result set
    const [orderC] = await db
      .insert(ucOrdersTable)
      .values({
        userId: String(symmetricUserId),
        status: SYMMETRIC_STATUS,
        total: "4598",
        currency: "KES",
        paymentMethod: "cod",
        paymentReference: "",
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {
          firstName: "Alpha",
          lastName: "Sym",
          address1: "3 Alpha St",
          city: "Nairobi",
          country: "KE",
          phone: "+254700000003",
        },
        webhookRecovery: false,
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderC) throw new Error("Failed to insert order C");

    // Order D — also two line items; same sentinel status
    const [orderD] = await db
      .insert(ucOrdersTable)
      .values({
        userId: String(symmetricUserId),
        status: SYMMETRIC_STATUS,
        total: "5998",
        currency: "KES",
        paymentMethod: "mpesa",
        paymentReference: `TEST-SYM-${Date.now()}`,
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {
          firstName: "Beta",
          lastName: "Sym",
          address1: "4 Beta Ave",
          city: "Mombasa",
          country: "KE",
          phone: "+254700000004",
        },
        webhookRecovery: false,
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderD) throw new Error("Failed to insert order D");

    symmetricOrderIds = [orderC.id, orderD.id];

    // Two line items on order C
    await db.insert(ucOrderItemsTable).values([
      {
        orderId: orderC.id,
        productId: 1,
        name: "Hydra Flux",
        quantity: 1,
        total: "3499",
      },
      {
        orderId: orderC.id,
        productId: 22,
        name: "Bottle Filter Cartridge",
        quantity: 1,
        total: "1099",
      },
    ]);

    // Two line items on order D (different products)
    await db.insert(ucOrderItemsTable).values([
      {
        orderId: orderD.id,
        productId: 11,
        name: "Sweet Home",
        quantity: 1,
        total: "3699",
      },
      {
        orderId: orderD.id,
        productId: 23,
        name: "Faucet Filter Cartridge",
        quantity: 1,
        total: "1999",
      },
    ]);
  });

  after(async () => {
    if (symmetricOrderIds.length > 0) {
      await db
        .delete(ucOrderItemsTable)
        .where(inArray(ucOrderItemsTable.orderId, symmetricOrderIds));
      await db
        .delete(ucOrdersTable)
        .where(inArray(ucOrdersTable.id, symmetricOrderIds));
    }
    if (symmetricUserId) {
      await db
        .delete(ucUsersTable)
        .where(eq(ucUsersTable.id, symmetricUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  // All requests use ?status=SYMMETRIC_STATUS so only our two fixture orders
  // appear in the response, regardless of whatever else is in the shared DB.
  const csvUrl = `/api/uc/admin/orders.csv?status=${SYMMETRIC_STATUS}`;

  it("returns 200 with CSV content-type", async () => {
    const { status, headers } = await apiFetch(csvUrl, {
      headers: {
        Authorization: authHeader({ id: symmetricUserId, email: SYMMETRIC_EMAIL }),
      },
    });
    assert.equal(status, 200);
    assert.ok(
      headers.get("content-type")?.startsWith("text/csv"),
      `Expected text/csv, got: ${headers.get("content-type")}`,
    );
  });

  it("result set contains exactly 2 rows — one per fixture order", async () => {
    const { text } = await apiFetch(csvUrl, {
      headers: {
        Authorization: authHeader({ id: symmetricUserId, email: SYMMETRIC_EMAIL }),
      },
    });

    const lines = text.split("\r\n").filter(l => l.trim());
    const dataLines = lines.slice(1);
    assert.equal(dataLines.length, 2, `Expected exactly 2 data rows, got ${dataLines.length}`);
  });

  it("header has exactly 2 × COLS_PER_ITEM item columns (maxItems = 2)", async () => {
    const { text } = await apiFetch(csvUrl, {
      headers: {
        Authorization: authHeader({ id: symmetricUserId, email: SYMMETRIC_EMAIL }),
      },
    });

    const lines = text.split("\r\n").filter(l => l.trim());
    const headerCells = parseCsvRow(lines[0]!);
    const itemColCount = headerCells.length - STATIC_COL_COUNT;

    assert.equal(
      itemColCount,
      2 * COLS_PER_ITEM,
      `Expected ${2 * COLS_PER_ITEM} item columns in header, got ${itemColCount}`,
    );
  });

  it("all rows have the same column count as the header", async () => {
    const { text } = await apiFetch(csvUrl, {
      headers: {
        Authorization: authHeader({ id: symmetricUserId, email: SYMMETRIC_EMAIL }),
      },
    });

    const lines = text.split("\r\n").filter(l => l.trim());
    const totalHeaderCols = parseCsvRow(lines[0]!).length;
    const dataLines = lines.slice(1);

    assert.equal(dataLines.length, 2, `Expected 2 data rows, got ${dataLines.length}`);

    for (const row of dataLines) {
      const cells = parseCsvRow(row);
      assert.equal(
        cells.length,
        totalHeaderCols,
        `Row for order ${cells[0]} has ${cells.length} columns, expected ${totalHeaderCols}`,
      );
    }
  });

  it("every item column is populated — no spurious empty padding", async () => {
    const { text } = await apiFetch(csvUrl, {
      headers: {
        Authorization: authHeader({ id: symmetricUserId, email: SYMMETRIC_EMAIL }),
      },
    });

    const lines = text.split("\r\n").filter(l => l.trim());
    const totalHeaderCols = parseCsvRow(lines[0]!).length;
    const dataLines = lines.slice(1);

    assert.equal(dataLines.length, 2, `Expected 2 data rows, got ${dataLines.length}`);

    for (const row of dataLines) {
      const cells = parseCsvRow(row);
      assert.equal(cells.length, totalHeaderCols);

      // All item columns (both slots) must be non-empty strings
      const itemCells = cells.slice(STATIC_COL_COUNT);
      for (let i = 0; i < itemCells.length; i++) {
        assert.notEqual(
          itemCells[i],
          "",
          `Order ${cells[0]}: item cell [${i}] must not be empty (no spurious padding)`,
        );
      }
    }
  });

  it("order C item columns match its two inserted line items", async () => {
    const { text } = await apiFetch(csvUrl, {
      headers: {
        Authorization: authHeader({ id: symmetricUserId, email: SYMMETRIC_EMAIL }),
      },
    });

    const lines = text.split("\r\n").filter(l => l.trim());
    const rowC = lines.slice(1).find(l => {
      const cells = parseCsvRow(l);
      return cells[0] !== undefined && Number(cells[0]) === symmetricOrderIds[0];
    });
    assert.ok(rowC, "Could not find order C row in CSV");

    const cells = parseCsvRow(rowC!);
    const i1 = STATIC_COL_COUNT;
    assert.equal(cells[i1],     "1",                      "order C item_1_productId");
    assert.equal(cells[i1 + 1], "Hydra Flux",             "order C item_1_name");
    assert.equal(cells[i1 + 2], "1",                      "order C item_1_qty");
    assert.equal(cells[i1 + 3], "3499",                   "order C item_1_total");

    const i2 = STATIC_COL_COUNT + COLS_PER_ITEM;
    assert.equal(cells[i2],     "22",                     "order C item_2_productId");
    assert.equal(cells[i2 + 1], "Bottle Filter Cartridge","order C item_2_name");
    assert.equal(cells[i2 + 2], "1",                      "order C item_2_qty");
    assert.equal(cells[i2 + 3], "1099",                   "order C item_2_total");
  });

  it("order D item columns match its two inserted line items", async () => {
    const { text } = await apiFetch(csvUrl, {
      headers: {
        Authorization: authHeader({ id: symmetricUserId, email: SYMMETRIC_EMAIL }),
      },
    });

    const lines = text.split("\r\n").filter(l => l.trim());
    const rowD = lines.slice(1).find(l => {
      const cells = parseCsvRow(l);
      return cells[0] !== undefined && Number(cells[0]) === symmetricOrderIds[1];
    });
    assert.ok(rowD, "Could not find order D row in CSV");

    const cells = parseCsvRow(rowD!);
    const i1 = STATIC_COL_COUNT;
    assert.equal(cells[i1],     "11",                      "order D item_1_productId");
    assert.equal(cells[i1 + 1], "Sweet Home",              "order D item_1_name");
    assert.equal(cells[i1 + 2], "1",                       "order D item_1_qty");
    assert.equal(cells[i1 + 3], "3699",                    "order D item_1_total");

    const i2 = STATIC_COL_COUNT + COLS_PER_ITEM;
    assert.equal(cells[i2],     "23",                      "order D item_2_productId");
    assert.equal(cells[i2 + 1], "Faucet Filter Cartridge", "order D item_2_name");
    assert.equal(cells[i2 + 2], "1",                       "order D item_2_qty");
    assert.equal(cells[i2 + 3], "1999",                    "order D item_2_total");
  });
});

// ── Asymmetric item-count edge case ───────────────────────────────────────────

const ASYM_EMAIL = "orders-csv-asymmetric-test@ucfilters-test.internal";

// Sentinel status isolates this suite's result set from the shared DB.
const ASYM_STATUS = "asym-csv-test-one-big-order";

// The five line items on the big order (order E), in insertion order.
const BIG_ORDER_ITEMS = [
  { productId: 1,  name: "Hydra Flux",               quantity: 1, total: "3499" },
  { productId: 22, name: "Bottle Filter Cartridge",  quantity: 2, total: "2198" },
  { productId: 11, name: "Sweet Home",               quantity: 1, total: "3699" },
  { productId: 23, name: "Faucet Filter Cartridge",  quantity: 1, total: "1999" },
  { productId: 24, name: "Shower Filter Cartridge",  quantity: 3, total: "4497" },
] as const;

let asymUserId: number;
let asymOrderIds: number[] = []; // [big 5-item order, 1-item order, 1-item order]

describe("GET /api/uc/admin/orders.csv — asymmetric item counts (one 5-item order, two 1-item orders)", () => {
  before(async () => {
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: ASYM_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "Asymmetric",
        lastName: "Test",
        isAdmin: false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert asymmetric test user");
    asymUserId = inserted.id;

    process.env["UC_ADMIN_EMAILS"] = ASYM_EMAIL;

    // Order E — five line items
    const [orderE] = await db
      .insert(ucOrdersTable)
      .values({
        userId: String(asymUserId),
        status: ASYM_STATUS,
        total: "15892",
        currency: "KES",
        paymentMethod: "mpesa",
        paymentReference: `TEST-ASYM-${Date.now()}`,
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {
          firstName: "Big",
          lastName: "Order",
          address1: "5 Bulk Blvd",
          city: "Nairobi",
          country: "KE",
          phone: "+254700000005",
        },
        webhookRecovery: false,
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderE) throw new Error("Failed to insert order E");

    // Order F — one line item
    const [orderF] = await db
      .insert(ucOrdersTable)
      .values({
        userId: String(asymUserId),
        status: ASYM_STATUS,
        total: "3499",
        currency: "KES",
        paymentMethod: "cod",
        paymentReference: "",
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {
          firstName: "Small",
          lastName: "One",
          address1: "6 Single St",
          city: "Mombasa",
          country: "KE",
          phone: "+254700000006",
        },
        webhookRecovery: false,
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderF) throw new Error("Failed to insert order F");

    // Order G — one line item
    const [orderG] = await db
      .insert(ucOrdersTable)
      .values({
        userId: String(asymUserId),
        status: ASYM_STATUS,
        total: "1099",
        currency: "KES",
        paymentMethod: "cod",
        paymentReference: "",
        promoCode: "",
        discountPercent: 0,
        discountAmount: 0,
        shippingAddress: {
          firstName: "Small",
          lastName: "Two",
          address1: "7 Single St",
          city: "Kisumu",
          country: "KE",
          phone: "+254700000007",
        },
        webhookRecovery: false,
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderG) throw new Error("Failed to insert order G");

    asymOrderIds = [orderE.id, orderF.id, orderG.id];

    // Five line items on order E
    await db.insert(ucOrderItemsTable).values(
      BIG_ORDER_ITEMS.map(it => ({ orderId: orderE.id, ...it })),
    );

    // One line item each on orders F and G
    await db.insert(ucOrderItemsTable).values([
      {
        orderId: orderF.id,
        productId: 1,
        name: "Hydra Flux",
        quantity: 1,
        total: "3499",
      },
      {
        orderId: orderG.id,
        productId: 22,
        name: "Bottle Filter Cartridge",
        quantity: 1,
        total: "1099",
      },
    ]);
  });

  after(async () => {
    if (asymOrderIds.length > 0) {
      await db
        .delete(ucOrderItemsTable)
        .where(inArray(ucOrderItemsTable.orderId, asymOrderIds));
      await db
        .delete(ucOrdersTable)
        .where(inArray(ucOrdersTable.id, asymOrderIds));
    }
    if (asymUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, asymUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  const csvUrl = `/api/uc/admin/orders.csv?status=${ASYM_STATUS}`;

  function asymAuth() {
    return { Authorization: authHeader({ id: asymUserId, email: ASYM_EMAIL }) };
  }

  it("returns 200 with exactly 3 data rows", async () => {
    const { status, headers, text } = await apiFetch(csvUrl, { headers: asymAuth() });
    assert.equal(status, 200);
    assert.ok(
      headers.get("content-type")?.startsWith("text/csv"),
      `Expected text/csv, got: ${headers.get("content-type")}`,
    );
    const dataLines = text.split("\r\n").filter(l => l.trim()).slice(1);
    assert.equal(dataLines.length, 3, `Expected 3 data rows, got ${dataLines.length}`);
  });

  it("header has exactly 5 × COLS_PER_ITEM item columns (maxItems = 5)", async () => {
    const { text } = await apiFetch(csvUrl, { headers: asymAuth() });
    const lines = text.split("\r\n").filter(l => l.trim());
    const headerCells = parseCsvRow(lines[0]!);
    const itemColCount = headerCells.length - STATIC_COL_COUNT;
    assert.equal(
      itemColCount,
      5 * COLS_PER_ITEM,
      `Expected ${5 * COLS_PER_ITEM} item columns in header, got ${itemColCount}`,
    );
  });

  it("the 5-item row populates all five item slots correctly", async () => {
    const { text } = await apiFetch(csvUrl, { headers: asymAuth() });
    const lines = text.split("\r\n").filter(l => l.trim());
    const totalHeaderCols = parseCsvRow(lines[0]!).length;

    const bigRow = lines.slice(1).find(l => {
      const cells = parseCsvRow(l);
      return cells[0] !== undefined && Number(cells[0]) === asymOrderIds[0];
    });
    assert.ok(bigRow, "Could not find the 5-item order row in the CSV");

    const cells = parseCsvRow(bigRow!);
    assert.equal(
      cells.length,
      totalHeaderCols,
      `5-item row has ${cells.length} columns, expected ${totalHeaderCols}`,
    );

    for (let n = 0; n < BIG_ORDER_ITEMS.length; n++) {
      const item = BIG_ORDER_ITEMS[n]!;
      const base = STATIC_COL_COUNT + n * COLS_PER_ITEM;
      assert.equal(cells[base],     String(item.productId), `item_${n + 1}_productId`);
      assert.equal(cells[base + 1], item.name,              `item_${n + 1}_name`);
      assert.equal(cells[base + 2], String(item.quantity),  `item_${n + 1}_qty`);
      assert.equal(cells[base + 3], item.total,             `item_${n + 1}_total`);
    }
  });

  it("each 1-item row has item 1 populated and items 2–5 empty", async () => {
    const { text } = await apiFetch(csvUrl, { headers: asymAuth() });
    const lines = text.split("\r\n").filter(l => l.trim());
    const totalHeaderCols = parseCsvRow(lines[0]!).length;

    const expectedByOrderId: Record<number, { productId: string; name: string; qty: string; total: string }> = {
      [asymOrderIds[1]!]: { productId: "1",  name: "Hydra Flux",              qty: "1", total: "3499" },
      [asymOrderIds[2]!]: { productId: "22", name: "Bottle Filter Cartridge", qty: "1", total: "1099" },
    };

    for (const orderId of [asymOrderIds[1]!, asymOrderIds[2]!]) {
      const row = lines.slice(1).find(l => {
        const cells = parseCsvRow(l);
        return cells[0] !== undefined && Number(cells[0]) === orderId;
      });
      assert.ok(row, `Could not find 1-item order ${orderId} row in the CSV`);

      const cells = parseCsvRow(row!);
      assert.equal(
        cells.length,
        totalHeaderCols,
        `1-item row for order ${orderId} has ${cells.length} columns, expected ${totalHeaderCols}`,
      );

      // Item 1 populated
      const exp = expectedByOrderId[orderId]!;
      const i1 = STATIC_COL_COUNT;
      assert.equal(cells[i1],     exp.productId, `order ${orderId} item_1_productId`);
      assert.equal(cells[i1 + 1], exp.name,      `order ${orderId} item_1_name`);
      assert.equal(cells[i1 + 2], exp.qty,       `order ${orderId} item_1_qty`);
      assert.equal(cells[i1 + 3], exp.total,     `order ${orderId} item_1_total`);

      // Items 2–5 all empty
      const paddingCells = cells.slice(STATIC_COL_COUNT + COLS_PER_ITEM);
      assert.equal(
        paddingCells.length,
        4 * COLS_PER_ITEM,
        `order ${orderId}: expected ${4 * COLS_PER_ITEM} padding cells, got ${paddingCells.length}`,
      );
      for (let i = 0; i < paddingCells.length; i++) {
        assert.equal(
          paddingCells[i],
          "",
          `order ${orderId}: padding cell [${i}] must be empty, got: "${paddingCells[i]}"`,
        );
      }
    }
  });
});

// ── Status filter alongside other active orders ───────────────────────────────
//
// Two orders share the same sentinel status with an equal item count (2 each),
// while a third order with a DIFFERENT status carries MORE items (3). The
// filtered CSV must be computed over only the filtered subset: 2 rows,
// maxItems = 2 (not 3), and no spurious empty padding.

const FILTERED_EMAIL = "orders-csv-filtered-test@ucfilters-test.internal";
const FILTERED_STATUS_MATCH = "filt-csv-test-match";
const FILTERED_STATUS_OTHER = "filt-csv-test-other";

let filteredUserId: number;
let filteredOrderIds: number[] = []; // [E, F, G] — E,F match; G is the outsider

describe("GET /api/uc/admin/orders.csv — status filter with other active orders", () => {
  before(async () => {
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: FILTERED_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "Filtered",
        lastName: "Test",
        isAdmin: false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert filtered test user");
    filteredUserId = inserted.id;

    process.env["UC_ADMIN_EMAILS"] = FILTERED_EMAIL;

    const baseOrder = {
      userId: String(filteredUserId),
      currency: "KES",
      paymentReference: "",
      promoCode: "",
      discountPercent: 0,
      discountAmount: 0,
      webhookRecovery: false,
    };

    // Order E — matching status, 2 items
    const [orderE] = await db
      .insert(ucOrdersTable)
      .values({
        ...baseOrder,
        status: FILTERED_STATUS_MATCH,
        total: "4598",
        paymentMethod: "cod",
        shippingAddress: {
          firstName: "Echo", lastName: "Filt", address1: "5 Echo St",
          city: "Nairobi", country: "KE", phone: "+254700000005",
        },
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderE) throw new Error("Failed to insert order E");

    // Order F — matching status, 2 items
    const [orderF] = await db
      .insert(ucOrdersTable)
      .values({
        ...baseOrder,
        status: FILTERED_STATUS_MATCH,
        total: "5698",
        paymentMethod: "mpesa",
        shippingAddress: {
          firstName: "Fox", lastName: "Filt", address1: "6 Fox Ave",
          city: "Mombasa", country: "KE", phone: "+254700000006",
        },
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderF) throw new Error("Failed to insert order F");

    // Order G — DIFFERENT status, 3 items (must not affect the filtered CSV)
    const [orderG] = await db
      .insert(ucOrdersTable)
      .values({
        ...baseOrder,
        status: FILTERED_STATUS_OTHER,
        total: "6097",
        paymentMethod: "cod",
        shippingAddress: {
          firstName: "Golf", lastName: "Filt", address1: "7 Golf Rd",
          city: "Kisumu", country: "KE", phone: "+254700000007",
        },
      })
      .returning({ id: ucOrdersTable.id });
    if (!orderG) throw new Error("Failed to insert order G");

    filteredOrderIds = [orderE.id, orderF.id, orderG.id];

    await db.insert(ucOrderItemsTable).values([
      // Order E — 2 items
      { orderId: orderE.id, productId: 1,  name: "Hydra Flux",              quantity: 1, total: "3499" },
      { orderId: orderE.id, productId: 22, name: "Bottle Filter Cartridge", quantity: 1, total: "1099" },
      // Order F — 2 items
      { orderId: orderF.id, productId: 11, name: "Sweet Home",              quantity: 1, total: "3699" },
      { orderId: orderF.id, productId: 23, name: "Faucet Filter Cartridge", quantity: 1, total: "1999" },
      // Order G — 3 items (outsider; would force 12 item columns if the
      // maxItems calculation leaked outside the filtered subset)
      { orderId: orderG.id, productId: 15, name: "J'adore",                  quantity: 1, total: "4399" },
      { orderId: orderG.id, productId: 24, name: "Shower Filter Cartridge",  quantity: 1, total: "1499" },
      { orderId: orderG.id, productId: 26, name: "Survivor Straw Cartridge", quantity: 1, total: "499"  },
    ]);
  });

  after(async () => {
    if (filteredOrderIds.length > 0) {
      await db
        .delete(ucOrderItemsTable)
        .where(inArray(ucOrderItemsTable.orderId, filteredOrderIds));
      await db
        .delete(ucOrdersTable)
        .where(inArray(ucOrdersTable.id, filteredOrderIds));
    }
    if (filteredUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, filteredUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  const filteredUrl = `/api/uc/admin/orders.csv?status=${FILTERED_STATUS_MATCH}`;

  function filteredAuth() {
    return {
      Authorization: authHeader({ id: filteredUserId, email: FILTERED_EMAIL }),
    };
  }

  it("returns 200 with CSV content-type", async () => {
    const { status, headers } = await apiFetch(filteredUrl, { headers: filteredAuth() });
    assert.equal(status, 200);
    assert.ok(
      headers.get("content-type")?.startsWith("text/csv"),
      `Expected text/csv, got: ${headers.get("content-type")}`,
    );
  });

  it("filtered CSV has exactly 2 rows — the different-status order is excluded", async () => {
    const { text } = await apiFetch(filteredUrl, { headers: filteredAuth() });

    const lines = text.split("\r\n").filter(l => l.trim());
    const dataLines = lines.slice(1);
    assert.equal(dataLines.length, 2, `Expected exactly 2 data rows, got ${dataLines.length}`);

    const rowIds = dataLines.map(l => Number(parseCsvRow(l)[0]));
    assert.ok(rowIds.includes(filteredOrderIds[0]!), "Order E row missing");
    assert.ok(rowIds.includes(filteredOrderIds[1]!), "Order F row missing");
    assert.ok(
      !rowIds.includes(filteredOrderIds[2]!),
      "Order G (different status) must not appear in the filtered CSV",
    );
  });

  it("maxItems is computed over the filtered subset only (8 item columns, not 12)", async () => {
    const { text } = await apiFetch(filteredUrl, { headers: filteredAuth() });

    const lines = text.split("\r\n").filter(l => l.trim());
    const headerCells = parseCsvRow(lines[0]!);
    const itemColCount = headerCells.length - STATIC_COL_COUNT;

    assert.equal(
      itemColCount,
      2 * COLS_PER_ITEM,
      `Expected ${2 * COLS_PER_ITEM} item columns (filtered maxItems = 2), got ${itemColCount} ` +
        `— the 3-item different-status order must not widen the header`,
    );
  });

  it("all rows match the header column count with no spurious padding", async () => {
    const { text } = await apiFetch(filteredUrl, { headers: filteredAuth() });

    const lines = text.split("\r\n").filter(l => l.trim());
    const totalHeaderCols = parseCsvRow(lines[0]!).length;
    const dataLines = lines.slice(1);

    assert.equal(dataLines.length, 2, `Expected 2 data rows, got ${dataLines.length}`);

    for (const row of dataLines) {
      const cells = parseCsvRow(row);
      assert.equal(
        cells.length,
        totalHeaderCols,
        `Row for order ${cells[0]} has ${cells.length} columns, expected ${totalHeaderCols}`,
      );

      // Both item slots are fully populated — no spurious empty padding
      const itemCells = cells.slice(STATIC_COL_COUNT);
      for (let i = 0; i < itemCells.length; i++) {
        assert.notEqual(
          itemCells[i],
          "",
          `Order ${cells[0]}: item cell [${i}] must not be empty (no spurious padding)`,
        );
      }
    }
  });
});

// ── CSV / list-API parity verification ───────────────────────────────────────
//
// The critical invariant: calling GET /api/uc/admin/orders and
// GET /api/uc/admin/orders.csv with identical query parameters must produce
// exactly the same set of order IDs, in the same order. A mismatch would be
// silent — the downloaded file looks plausible but contains the wrong rows.
//
// Fixtures
// ─────────
//   Order P  sentinel status  date: 2024-01-10  inside  Jan date range
//   Order Q  sentinel status  date: 2024-01-25  inside  Jan date range
//   Order R  sentinel status  date: 2024-03-05  outside Jan date range
//
// Tests
// ─────
//   1. status + date range → list IDs === CSV IDs (P and Q only)
//   2. status only, no date range → list IDs === CSV IDs (P, Q, and R)
//   3. no filters at all → list IDs === CSV IDs (fixture IDs are a subset)

const PARITY_EMAIL  = "orders-csv-parity-test@ucfilters-test.internal";
const PARITY_STATUS = `parity-csv-test-${Date.now()}`;

let parityUserId: number;
let parityOrderIds: number[] = []; // [P, Q, R]

describe("GET /api/uc/admin/orders.csv — CSV rows match list API response", () => {
  before(async () => {
    const [inserted] = await db
      .insert(ucUsersTable)
      .values({
        email: PARITY_EMAIL,
        passwordHash: "test-hash-not-real",
        firstName: "Parity",
        lastName: "Test",
        isAdmin: false,
      })
      .returning({ id: ucUsersTable.id });
    if (!inserted) throw new Error("Failed to insert parity test user");
    parityUserId = inserted.id;

    process.env["UC_ADMIN_EMAILS"] = PARITY_EMAIL;

    const baseOrder = {
      userId: String(parityUserId),
      status: PARITY_STATUS,
      currency: "KES",
      paymentMethod: "cod",
      paymentReference: "",
      promoCode: "",
      discountPercent: 0,
      discountAmount: 0,
      webhookRecovery: false,
      shippingAddress: {
        firstName: "Parity",
        lastName: "Test",
        address1: "1 Test Rd",
        city: "Nairobi",
        country: "KE",
        phone: "+254700000099",
      },
    };

    // Order P — inside the January date range
    const [orderP] = await db
      .insert(ucOrdersTable)
      .values({ ...baseOrder, total: "3499", dateCreated: new Date("2024-01-10T10:00:00Z") })
      .returning({ id: ucOrdersTable.id });
    if (!orderP) throw new Error("Failed to insert order P");

    // Order Q — also inside January
    const [orderQ] = await db
      .insert(ucOrdersTable)
      .values({ ...baseOrder, total: "1099", dateCreated: new Date("2024-01-25T14:00:00Z") })
      .returning({ id: ucOrdersTable.id });
    if (!orderQ) throw new Error("Failed to insert order Q");

    // Order R — outside January (March), must be excluded by the date filter
    const [orderR] = await db
      .insert(ucOrdersTable)
      .values({ ...baseOrder, total: "2599", dateCreated: new Date("2024-03-05T08:00:00Z") })
      .returning({ id: ucOrdersTable.id });
    if (!orderR) throw new Error("Failed to insert order R");

    parityOrderIds = [orderP.id, orderQ.id, orderR.id];

    // One line item per order (content doesn't affect the parity check)
    await db.insert(ucOrderItemsTable).values([
      { orderId: orderP.id, productId: 22, name: "Bottle Filter Cartridge", quantity: 1, total: "3499" },
      { orderId: orderQ.id, productId: 22, name: "Bottle Filter Cartridge", quantity: 1, total: "1099" },
      { orderId: orderR.id, productId: 2,  name: "Truva Go",                quantity: 1, total: "2599" },
    ]);
  });

  after(async () => {
    if (parityOrderIds.length > 0) {
      await db
        .delete(ucOrderItemsTable)
        .where(inArray(ucOrderItemsTable.orderId, parityOrderIds));
      await db
        .delete(ucOrdersTable)
        .where(inArray(ucOrdersTable.id, parityOrderIds));
    }
    if (parityUserId) {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, parityUserId));
    }
    delete process.env["UC_ADMIN_EMAILS"];
  });

  function parityAuth() {
    return { Authorization: authHeader({ id: parityUserId, email: PARITY_EMAIL }) };
  }

  /** Extract ordered IDs from a JSON list API response body. */
  function listIds(json: unknown): number[] {
    assert.ok(Array.isArray(json), "List API must return an array");
    return (json as { id: number }[]).map(o => o.id);
  }

  /** Extract ordered IDs from a CSV text (skips header; reads first column of each data row). */
  function csvIds(csvText: string): number[] {
    return csvText
      .split("\r\n")
      .filter(l => l.trim())
      .slice(1) // drop header
      .map(l => Number(parseCsvRow(l)[0]))
      .filter(id => !isNaN(id) && id > 0);
  }

  // ── Test 1: status + date range ──────────────────────────────────────────────

  it("status + date range: CSV IDs match list API IDs (both return P and Q only)", async () => {
    const qs = `?status=${PARITY_STATUS}&from=2024-01-01&to=2024-01-31`;

    const [listRes, csvRes] = await Promise.all([
      apiFetch(`/api/uc/admin/orders${qs}`,     { headers: parityAuth() }),
      apiFetch(`/api/uc/admin/orders.csv${qs}`, { headers: parityAuth() }),
    ]);

    assert.equal(listRes.status, 200, `List API must return 200, got ${listRes.status}`);
    assert.equal(csvRes.status,  200, `CSV endpoint must return 200, got ${csvRes.status}`);

    const fromList = listIds(JSON.parse(listRes.text));
    const fromCsv  = csvIds(csvRes.text);

    // Both must contain exactly the two in-range fixture orders
    const inRangeIds = [parityOrderIds[0]!, parityOrderIds[1]!].sort((a, b) => b - a); // desc
    assert.deepEqual(
      fromList.filter(id => parityOrderIds.includes(id)).sort((a, b) => b - a),
      inRangeIds,
      `List API must return only in-range fixture orders (P and Q); got ${JSON.stringify(fromList)}`,
    );
    assert.ok(
      !fromList.includes(parityOrderIds[2]!),
      `List API must NOT include order R (outside date range); got ${JSON.stringify(fromList)}`,
    );
    assert.ok(
      !fromCsv.includes(parityOrderIds[2]!),
      `CSV must NOT include order R (outside date range); got ${JSON.stringify(fromCsv)}`,
    );

    // The CSV IDs (for our fixtures) must exactly match the list IDs
    const ourListIds = fromList.filter(id => parityOrderIds.includes(id));
    const ourCsvIds  = fromCsv.filter(id => parityOrderIds.includes(id));
    assert.deepEqual(
      ourCsvIds,
      ourListIds,
      `CSV fixture IDs ${JSON.stringify(ourCsvIds)} must match list API fixture IDs ${JSON.stringify(ourListIds)}`,
    );
  });

  // ── Test 2: status only, no date range ──────────────────────────────────────

  it("status only (no date range): CSV IDs match list API IDs (all three fixtures)", async () => {
    const qs = `?status=${PARITY_STATUS}`;

    const [listRes, csvRes] = await Promise.all([
      apiFetch(`/api/uc/admin/orders${qs}`,     { headers: parityAuth() }),
      apiFetch(`/api/uc/admin/orders.csv${qs}`, { headers: parityAuth() }),
    ]);

    assert.equal(listRes.status, 200, `List API must return 200, got ${listRes.status}`);
    assert.equal(csvRes.status,  200, `CSV endpoint must return 200, got ${csvRes.status}`);

    const fromList = listIds(JSON.parse(listRes.text));
    const fromCsv  = csvIds(csvRes.text);

    // With sentinel status and no date filter, all three fixtures must appear
    assert.equal(
      fromList.length,
      3,
      `List API must return exactly 3 fixture orders; got ${fromList.length}: ${JSON.stringify(fromList)}`,
    );
    assert.equal(
      fromCsv.length,
      3,
      `CSV must contain exactly 3 fixture rows; got ${fromCsv.length}: ${JSON.stringify(fromCsv)}`,
    );

    // IDs and order must be identical between list and CSV
    assert.deepEqual(
      fromCsv,
      fromList,
      `CSV IDs ${JSON.stringify(fromCsv)} must exactly match list API IDs ${JSON.stringify(fromList)}`,
    );
  });

  // ── Test 3: no filters — both endpoints agree ────────────────────────────────

  it("no filters: all fixture order IDs present in both list API and CSV", async () => {
    const [listRes, csvRes] = await Promise.all([
      apiFetch("/api/uc/admin/orders",     { headers: parityAuth() }),
      apiFetch("/api/uc/admin/orders.csv", { headers: parityAuth() }),
    ]);

    assert.equal(listRes.status, 200, `List API must return 200, got ${listRes.status}`);
    assert.equal(csvRes.status,  200, `CSV endpoint must return 200, got ${csvRes.status}`);

    const fromList = listIds(JSON.parse(listRes.text));
    const fromCsv  = csvIds(csvRes.text);

    // Every fixture order ID must appear in both responses
    for (const id of parityOrderIds) {
      assert.ok(
        fromList.includes(id),
        `List API must include fixture order ${id}; got ${JSON.stringify(fromList)}`,
      );
      assert.ok(
        fromCsv.includes(id),
        `CSV must include fixture order ${id}; got ${JSON.stringify(fromCsv)}`,
      );
    }

    // The overall ID sets must match (same rows, same order)
    assert.deepEqual(
      fromCsv,
      fromList,
      `CSV IDs must exactly match list API IDs when no filters are applied.\n` +
        `  List (${fromList.length}): ${JSON.stringify(fromList)}\n` +
        `  CSV  (${fromCsv.length}): ${JSON.stringify(fromCsv)}`,
    );
  });
});
