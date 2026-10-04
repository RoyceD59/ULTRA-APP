import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { db, ucEnquiriesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// Synthetic key only; never read workspace credentials.
const TEST_KEY = "synthetic-enquiries-admin-test-key";
let server: Server;
let baseUrl: string;
let ids: number[] = [];
const dates = [
  "2040-02-28T23:59:59.999Z",
  "2040-02-29T00:00:00.000Z",
  "2040-02-29T23:59:59.999Z",
  "2040-03-01T00:00:00.000Z",
  "2040-03-01T00:00:00.000Z",
];

before(async () => {
  process.env.ADMIN_SECRET = TEST_KEY;
  process.env.SESSION_SECRET ??= "synthetic-enquiries-session-test-key";
  const { default: app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const inserted = await db.insert(ucEnquiriesTable).values(dates.map((date, i) => ({
    productId: `enquiries-admin-test-${i}`,
    productName: "Test RO Home System",
    name: "Synthetic Enquiry",
    email: "enquiry@example.invalid",
    phone: "+254700000000",
    message: "Please send product details.",
    createdAt: new Date(date),
  }))).returning({ id: ucEnquiriesTable.id });
  ids = inserted.map((row) => row.id);
});

after(async () => {
  if (ids.length) await db.delete(ucEnquiriesTable).where(inArray(ucEnquiriesTable.id, ids));
  delete process.env.ADMIN_SECRET;
  if (server) await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
});

function get(query = "", key: string | null = TEST_KEY) {
  return fetch(`${baseUrl}/api/uc/enquiries${query}`, {
    headers: key === null ? {} : { "X-Admin-Key": key },
  });
}

describe("GET /api/uc/enquiries", () => {
  it("rejects absent and incorrect keys, including validation bypass attempts", async () => {
    for (const key of [null, "", "wrong", `${TEST_KEY}extra`]) {
      const response = await get("?from=invalid", key);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { error: "Missing or invalid X-Admin-Key" });
    }
    const response = await fetch(`${baseUrl}/api/uc/enquiries?X-Admin-Key=${TEST_KEY}`);
    assert.equal(response.status, 401);
  });

  it("fails closed when ADMIN_SECRET is absent, empty, or whitespace", async () => {
    try {
      for (const secret of [undefined, "", "   "]) {
        if (secret === undefined) delete process.env.ADMIN_SECRET;
        else process.env.ADMIN_SECRET = secret;
        const response = await get();
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: "Enquiry admin access is not configured" });
      }
    } finally {
      process.env.ADMIN_SECRET = TEST_KEY;
    }
  });

  it("returns all saved enquiries newest first with contact fields and dates", async () => {
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const rows = await response.json();
    assert.deepEqual(rows.filter((row: { id: number }) => ids.includes(row.id)).map((row: { id: number }) => row.id),
      [...ids].reverse());
    assert.deepEqual(rows.find((row: { id: number }) => row.id === ids[0]), {
      id: ids[0], productId: "enquiries-admin-test-0", productName: "Test RO Home System",
      name: "Synthetic Enquiry", email: "enquiry@example.invalid", phone: "+254700000000",
      message: "Please send product details.", createdAt: dates[0],
    });
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].createdAt >= rows[i].createdAt);
    }
  });

  it("includes the full UTC end day and excludes both outside boundaries", async () => {
    const response = await get("?from=2040-02-29&to=2040-02-29");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map((row: { id: number }) => row.id), [ids[2], ids[1]]);
  });

  it("allows either date bound independently and returns [] for no matches", async () => {
    const fromResponse = await get("?from=2040-03-01");
    const fromRows = await fromResponse.json();
    assert.equal(fromResponse.status, 200);
    assert.deepEqual(fromRows.filter((row: { id: number }) => ids.includes(row.id)).map((row: { id: number }) => row.id),
      [ids[4], ids[3]]);
    const toResponse = await get("?to=2040-02-28");
    assert.equal(toResponse.status, 200);
    assert.deepEqual((await toResponse.json()).filter((row: { id: number }) => ids.includes(row.id)).map((row: { id: number }) => row.id),
      [ids[0]]);
    const empty = await get("?from=1900-01-01&to=1900-01-01");
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), []);
  });

  it("rejects malformed, impossible, duplicate, and reversed date bounds", async () => {
    for (const query of [
      "?from=", "?to=2040-2-29", "?from=2041-02-29", "?to=2040-04-31",
      "?from=2040-13-01", "?from=tomorrow", "?from=2040-03-01&to=2040-02-29",
      "?from=2040-02-28&from=2040-02-29", "?to=2040-02-29T12:00:00Z",
    ]) {
      const response = await get(query);
      assert.equal(response.status, 400, query);
    }
  });

  it("reports a database failure rather than returning a misleading empty array", async () => {
    const selectMock = mock.method(db, "select", () => { throw new Error("synthetic database failure"); });
    try {
      const response = await get();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Enquiries are temporarily unavailable" });
    } finally {
      selectMock.mock.restore();
    }
  });
});