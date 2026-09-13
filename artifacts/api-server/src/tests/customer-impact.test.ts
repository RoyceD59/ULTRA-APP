import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import app from "../app.js";
import { db, ucRegisteredFiltersTable, ucUsersTable, ucWaterImpactLedgerTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
let base: string;
let customerId: number;
let otherCustomerId: number;
let adminId: number;
let filterId: number;
let otherFilterId: number;
let customerEmail: string;
let adminEmail: string;

const tokenFor = (id: number, email: string) =>
  `Bearer ${issueToken({ id, email, firstName: "Impact", lastName: "Tester" })}`;

async function call(path: string, init: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  return { status: response.status, body: await response.json() as any };
}

describe("customer water-impact ledger", () => {
  before(async () => {
    process.env.SESSION_SECRET ??= "customer-impact-test-secret";
    const suffix = `${Date.now()}-${process.pid}`;
    const passwordHash = await bcrypt.hash("Test1234!", 4);
    const [customer] = await db.insert(ucUsersTable).values({
      email: `customer-impact-${suffix}@test.invalid`, passwordHash, firstName: "Impact", lastName: "Customer",
    }).returning();
    const [other] = await db.insert(ucUsersTable).values({
      email: `other-impact-${suffix}@test.invalid`, passwordHash, firstName: "Other", lastName: "Customer",
    }).returning();
    const [admin] = await db.insert(ucUsersTable).values({
      email: `admin-impact-${suffix}@test.invalid`, passwordHash, firstName: "Impact", lastName: "Admin", isAdmin: true,
    }).returning();
    customerId = customer!.id; otherCustomerId = other!.id; adminId = admin!.id;
    customerEmail = customer!.email; adminEmail = admin!.email;
    const [filter] = await db.insert(ucRegisteredFiltersTable).values({
      userId: customerId, productId: 71001, productName: "100 L test filter",
      ratedCapacityLitres: 100, activatedAt: new Date(), source: "legacy",
    }).returning();
    const [otherFilter] = await db.insert(ucRegisteredFiltersTable).values({
      userId: otherCustomerId, productId: 71002, productName: "Other filter",
      ratedCapacityLitres: 100, activatedAt: new Date(), source: "legacy",
    }).returning();
    filterId = filter!.id; otherFilterId = otherFilter!.id;
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(ucWaterImpactLedgerTable)
      .where(inArray(ucWaterImpactLedgerTable.registeredFilterId, [filterId, otherFilterId]));
    await db.delete(ucRegisteredFiltersTable).where(inArray(ucRegisteredFiltersTable.id, [filterId, otherFilterId]));
    await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, [customerId, otherCustomerId, adminId]));
  });

  it("accepts the capacity boundary once, rejects an over-capacity refill, and retries idempotently", async () => {
    const headers = { Authorization: tokenFor(customerId, customerEmail), "Content-Type": "application/json" };
    const body = { registeredFilterId: filterId, litres: 100, idempotencyKey: "impact-boundary-entry" };
    const first = await call("/uc/customer/impact", { method: "POST", headers, body: JSON.stringify(body) });
    const repeated = await call("/uc/customer/impact", { method: "POST", headers, body: JSON.stringify(body) });
    const overCapacity = await call("/uc/customer/impact", {
      method: "POST", headers,
      body: JSON.stringify({ registeredFilterId: filterId, litres: 1, idempotencyKey: "impact-over-capacity" }),
    });

    assert.equal(first.status, 201);
    assert.equal(first.body.impact.totalLitres, 100);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.repeated, true);
    assert.equal(overCapacity.status, 409);
    assert.equal(overCapacity.body.remainingCapacityLitres, 0);
    assert.match(overCapacity.body.error, /replacement is required/i);
    const entries = await db.select().from(ucWaterImpactLedgerTable)
      .where(and(eq(ucWaterImpactLedgerTable.userId, customerId), eq(ucWaterImpactLedgerTable.idempotencyKey, "impact-boundary-entry")));
    assert.equal(entries.length, 1);
  });

  it("does not let a customer record litres against another customer's filter", async () => {
    const result = await call("/uc/customer/impact", {
      method: "POST",
      headers: { Authorization: tokenFor(customerId, customerEmail), "Content-Type": "application/json" },
      body: JSON.stringify({ registeredFilterId: otherFilterId, litres: 1, idempotencyKey: "impact-foreign-filter" }),
    });
    assert.equal(result.status, 404);
  });

  it("exposes actual customer ledger totals and dated entries to ProjectHub admins", async () => {
    const result = await call(`/uc/admin/rewards/impact?search=${encodeURIComponent(customerEmail)}`, {
      headers: { Authorization: tokenFor(adminId, adminEmail) },
    });
    assert.equal(result.status, 200);
    const customer = result.body.customers.find((row: { id: number }) => row.id === customerId);
    assert.equal(Number(customer.total_litres), 100);
    assert.equal(Number(customer.entry_count), 1);

    const detail = await call(`/uc/admin/rewards/impact/${customerId}`, {
      headers: { Authorization: tokenFor(adminId, adminEmail) },
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.impact.totalLitres, 100);
    assert.equal(detail.body.impact.history[0].litres, 100);
    assert.ok(detail.body.impact.history[0].createdAt);
  });
});