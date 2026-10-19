import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { db, ucOrdersTable, ucUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
let adminId: number;
let customerId: number;
let orderId: number;
let token: string;
let customerToken: string;
let base: string;

before(async () => {
  process.env.SESSION_SECRET ??= "recovery-status-test-secret";
  const { default: app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/uc/admin/orders`;
  const users = await db.insert(ucUsersTable).values([
    { email: "recovery-status-admin@test.invalid", passwordHash: "unused", firstName: "Admin", lastName: "Test", isAdmin: true },
    { email: "recovery-status-customer@test.invalid", passwordHash: "unused", firstName: "Customer", lastName: "Test", isAdmin: false },
  ]).returning();
  adminId = users[0]!.id;
  customerId = users[1]!.id;
  token = issueToken({ id: adminId, email: users[0]!.email, firstName: "Admin", lastName: "Test" });
  customerToken = issueToken({ id: customerId, email: users[1]!.email, firstName: "Customer", lastName: "Test" });
  const [order] = await db.insert(ucOrdersTable).values({
    userId: "recovery-status-owner@test.invalid", status: "pending", total: "3000",
    currency: "KES", paymentMethod: "paystack", paymentReference: "recovery-status-ref",
    webhookRecovery: true,
  }).returning();
  orderId = order!.id;
});

after(async () => {
  if (orderId) await db.delete(ucOrdersTable).where(eq(ucOrdersTable.id, orderId));
  if (adminId) await db.delete(ucUsersTable).where(eq(ucUsersTable.id, adminId));
  if (customerId) await db.delete(ucUsersTable).where(eq(ucUsersTable.id, customerId));
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

async function patch(status: unknown, auth: string | null = token, id: string | number = orderId) {
  return fetch(`${base}/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ status }),
  });
}

async function count() {
  const response = await fetch(`${base}/recovery-count`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  return (await response.json() as { count: number }).count;
}

describe("recovery order status resolution", () => {
  it("requires admin access for status updates and counts", async () => {
    for (const auth of [null, customerToken]) {
      assert.equal((await patch("completed", auth)).status, 403);
      assert.equal((await fetch(`${base}/recovery-count`, {
        headers: auth ? { Authorization: `Bearer ${auth}` } : {},
      })).status, 403);
    }
  });

  it("rejects invalid statuses, IDs, missing orders and refund shortcuts", async () => {
    for (const status of ["refunded", "invalid", null, 42]) assert.equal((await patch(status)).status, 400);
    for (const id of ["invalid", 0, -1, 1.5]) assert.equal((await patch("completed", token, id)).status, 400);
    assert.equal((await patch("completed", token, 2147483647)).status, 404);
  });

  it("persists processing and completed, reduces the count, and preserves recovery history", async () => {
    const initialCount = await count();
    assert.equal((await patch("processing")).status, 200);
    assert.equal(await count(), initialCount - 1);
    assert.equal((await patch("completed")).status, 200);
    assert.equal(await count(), initialCount - 1);
    assert.equal((await patch("completed")).status, 200);
    assert.equal(await count(), initialCount - 1);
    const [stored] = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.id, orderId));
    assert.equal(stored!.status, "completed");
    assert.equal(stored!.webhookRecovery, true);
    assert.equal(stored!.userId, "recovery-status-owner@test.invalid");
    assert.equal(stored!.paymentReference, "recovery-status-ref");
    assert.equal(stored!.customerStage, null);
    const response = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const orders = await response.json() as { id: number; status: string; webhookRecovery: boolean }[];
    assert.deepEqual(orders.filter(order => order.id === orderId).map(order => [order.status, order.webhookRecovery]), [["completed", true]]);
  });

  it("does not allow a refunded order to be reclassified", async () => {
    await db.update(ucOrdersTable).set({ status: "refunded" }).where(eq(ucOrdersTable.id, orderId));
    assert.equal((await patch("processing")).status, 409);
    const [stored] = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.id, orderId));
    assert.equal(stored!.status, "refunded");
  });
});