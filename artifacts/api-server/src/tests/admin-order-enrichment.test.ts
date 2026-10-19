import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { db, pool, ucOrdersTable, ucOrderItemsTable, ucUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";
import { reconcileCanonicalPurchase } from "../lib/canonical-purchase-reconciliation.js";

let server: http.Server;
let adminId: number;
let customerId: number;
let orderId: number;
let token: string;
const canonicalOrderIds: number[] = [];
const lines = [{ productId: 123, name: "Confirmed filter", quantity: 2, total: "2500.00" }];
const shipping = { firstName: "Customer", lastName: "Example", phone: "+254700000000", address1: "Delivery street", city: "Nairobi", country: "KE", fulfillment: "delivery" };

before(async () => {
  process.env.SESSION_SECRET ??= "admin-order-enrichment-test-secret";
  const { default: app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const users = await db.insert(ucUsersTable).values([
    { email: "enrichment-admin@test.invalid", passwordHash: "unused", firstName: "Admin", lastName: "Test", isAdmin: true },
    { email: "enrichment-customer@test.invalid", passwordHash: "unused", firstName: "Customer", lastName: "Test", isAdmin: false },
  ]).returning();
  adminId = users[0]!.id;
  customerId = users[1]!.id;
  token = issueToken({ id: adminId, email: users[0]!.email, firstName: "Admin", lastName: "Test" });
  const [order] = await db.insert(ucOrdersTable).values({
    userId: "recovered-customer@test.invalid", status: "paid", total: "3000",
    currency: "KES", paymentMethod: "paystack", paymentReference: "enrichment-test-ref",
    webhookRecovery: true, shippingAddress: { shippingAmount: "500", tracking: "preserve" },
  }).returning();
  orderId = order!.id;
});

after(async () => {
  await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id=ANY($1::int[])", [canonicalOrderIds]);
  await pool.query("DELETE FROM uc_orders WHERE id=ANY($1::int[])", [canonicalOrderIds]);
  await db.delete(ucOrdersTable).where(eq(ucOrdersTable.id, orderId));
  await db.delete(ucUsersTable).where(eq(ucUsersTable.id, adminId));
  await db.delete(ucUsersTable).where(eq(ucUsersTable.id, customerId));
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function patch(body: unknown, auth: string | null = token, id: number | string = orderId) {
  const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/uc/admin/orders/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function stored() {
  const [order] = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.id, orderId));
  const items = await db.select().from(ucOrderItemsTable).where(eq(ucOrderItemsTable.orderId, orderId));
  return { order: order!, items };
}

describe("admin order enrichment and internal dispatch", () => {
  it("denies missing and customer credentials even when the token claims admin", async () => {
    assert.equal((await patch({ status: "processing" }, null)).status, 403);
    const customer = issueToken({ id: customerId, email: "enrichment-customer@test.invalid", firstName: "Customer", lastName: "Test", isAdmin: true } as Parameters<typeof issueToken>[0]);
    assert.equal((await patch({ status: "processing" }, customer)).status, 403);
  });
  it("rejects invalid IDs, empty updates, refund shortcuts and unauthorized fields", async () => {
    for (const id of ["abc", 0, -1, 1.5]) assert.equal((await patch({ status: "paid" }, token, id)).status, 400);
    for (const body of [{}, { status: "refunded" }, { userId: "different" }, { total: "1" }, { lineItems: [] }]) {
      assert.equal((await patch(body)).status, 400);
    }
    assert.equal((await patch({ status: "paid" }, token, 2147483647)).status, 404);
  });
  it("requires confirmed recovery details before dispatch and leaves rejected enrichment unchanged", async () => {
    assert.equal((await patch({ status: "dispatched" })).status, 409);
    assert.equal((await patch({ lineItems: lines })).status, 409);
    assert.equal((await patch({ shippingAddress: shipping })).status, 409);
    const snapshot = await stored();
    assert.equal(snapshot.items.length, 0);
    assert.equal(snapshot.order.recoveryEnrichedAt, null);
    assert.deepEqual(snapshot.order.shippingAddress, { shippingAmount: "500", tracking: "preserve" });
  });
  it("rejects malformed items and address values", async () => {
    for (const changed of [{ productId: 1.5 }, { quantity: 1.5 }, { quantity: 0 }, { quantity: 1001 }, { name: "  " }, { total: "-10" }, { total: "NaN" }, { total: "1.234" }]) {
      assert.equal((await patch({ shippingAddress: shipping, lineItems: [{ ...lines[0], ...changed }] })).status, 400);
    }
    assert.equal((await patch({ shippingAddress: { phone: 123 }, lineItems: lines })).status, 400);
  });
  it("persists enrichment without changing paid amount, owner, provider reference or recovery provenance", async () => {
    const response = await patch({ shippingAddress: shipping, lineItems: lines });
    assert.equal(response.status, 200);
    assert.ok(response.body.recoveryEnrichedAt);
    const { order, items } = await stored();
    assert.equal(order.total, "3000");
    assert.equal(order.status, "paid");
    assert.equal(order.userId, "recovered-customer@test.invalid");
    assert.equal(order.paymentReference, "enrichment-test-ref");
    assert.equal(order.webhookRecovery, true);
    assert.equal(order.shippingAddress?.tracking, "preserve");
    assert.equal(items.length, 1);
    assert.equal(items[0]!.name, lines[0]!.name);
    const list = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/uc/admin/orders`, { headers: { Authorization: `Bearer ${token}` } });
    const saved = (await list.json()).find((row: { id: number }) => row.id === orderId);
    assert.ok(saved.recoveryEnrichedAt);
    assert.deepEqual(saved.lineItems, lines);
  });
  it("can re-open and replace items, partially edit shipping, then dispatch without sending a customer update", async () => {
    assert.equal((await patch({ lineItems: [{ ...lines[0], quantity: 1 }, { productId: 124, name: "Accessory", quantity: 1, total: "100" }], shippingAddress: { city: "Mombasa" } })).status, 200);
    assert.equal((await stored()).items.length, 2);
    const enrichedAt = (await stored()).order.recoveryEnrichedAt!.toISOString();
    assert.equal((await patch({ status: "dispatched" })).status, 200);
    const { order, items } = await stored();
    assert.equal(order.status, "dispatched");
    assert.equal(order.customerStage, null);
    assert.equal(order.recoveryEnrichedAt!.toISOString(), enrichedAt);
    assert.equal(order.shippingAddress?.city, "Mombasa");
    assert.equal(order.shippingAddress?.address1, shipping.address1);
    assert.equal(items.length, 2);
  });
  it("supports pickup enrichment without a delivery street", async () => {
    assert.equal((await patch({ shippingAddress: { fulfillment: "collection", address1: "", city: "", country: "" } })).status, 200);
    assert.equal((await stored()).order.shippingAddress?.fulfillment, "collection");
  });
  it("does not partially commit when inserting a replacement item fails", async () => {
    const original = await stored();
    await pool.query(`CREATE FUNCTION enrichment_test_reject_item() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.order_id = ${orderId} AND NEW.product_id = 999999 THEN RAISE EXCEPTION 'test insert rejection'; END IF; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER enrichment_test_reject_item BEFORE INSERT ON uc_order_items FOR EACH ROW EXECUTE FUNCTION enrichment_test_reject_item()");
    try {
      assert.equal((await patch({ status: "processing", shippingAddress: { city: "Not committed" }, lineItems: [{ productId: 999999, name: "Rejected", quantity: 1, total: "1" }] })).status, 500);
      const current = await stored();
      assert.deepEqual(current, original);
    } finally {
      await pool.query("DROP TRIGGER enrichment_test_reject_item ON uc_order_items");
      await pool.query("DROP FUNCTION enrichment_test_reject_item()");
    }
  });
  it("blocks all edits to refunded orders", async () => {
    await db.update(ucOrdersTable).set({ status: "refunded" }).where(eq(ucOrdersTable.id, orderId));
    assert.equal((await patch({ status: "paid" })).status, 409);
    assert.equal((await patch({ lineItems: lines, shippingAddress: shipping })).status, 409);
  });
  it("enriches a preexisting unresolved canonical recovery purchase and preserves ownership", async () => {
    const prior = process.env.UC_CANONICAL_DUAL_WRITES;
    process.env.UC_CANONICAL_DUAL_WRITES = "true";
    try {
      const [order] = await db.insert(ucOrdersTable).values({
        userId: "canonical-recovery@test.invalid", status: "paid", total: "3000", paymentMethod: "paystack",
        paymentReference: "canonical-admin-recovery-ref", webhookRecovery: true, paymentConfirmedAt: new Date(),
      }).returning();
      const id = order!.id;
      canonicalOrderIds.push(id);
      const created = await reconcileCanonicalPurchase({ orderId: id });
      assert.equal(created.created, true);
      assert.equal((await patch({ shippingAddress: shipping, lineItems: lines }, token, id)).status, 200);
      assert.equal((await patch({ status: "dispatched" }, token, id)).status, 200);
      const canonical = await pool.query("SELECT * FROM uc_canonical_purchases WHERE companion_order_id=$1", [id]);
      assert.equal(canonical.rows.length, 1);
      assert.equal(Number(canonical.rows[0].id), Number(created.canonicalPurchaseId));
      assert.equal(canonical.rows[0].customer_id, null);
      assert.equal(canonical.rows[0].payment_status, "paid");
      assert.equal(canonical.rows[0].fulfilment_status, "processing");
      const projectedLines = await pool.query("SELECT * FROM uc_canonical_purchase_lines WHERE purchase_id=$1", [created.canonicalPurchaseId]);
      assert.equal(projectedLines.rows.length, 1);
      assert.equal(projectedLines.rows[0].quantity, 2);
      assert.equal(Number(projectedLines.rows[0].line_total_minor), 250000);
    } finally {
      if (prior === undefined) delete process.env.UC_CANONICAL_DUAL_WRITES;
      else process.env.UC_CANONICAL_DUAL_WRITES = prior;
    }
  });
  it("preserves legacy paid, timestamp-confirmed, unpaid COD and pending payment classifications on dispatch", async () => {
    const prior = process.env.UC_CANONICAL_DUAL_WRITES;
    process.env.UC_CANONICAL_DUAL_WRITES = "true";
    try {
      for (const [index, scenario] of [
        { status: "paid", method: "paystack", confirmed: false, expected: "paid" },
        { status: "processing", method: "paystack", confirmed: false, expected: "paid" },
        { status: "pending", method: "paystack", confirmed: true, expected: "paid" },
        { status: "processing", method: "cod", confirmed: false, expected: "pending" },
        { status: "pending", method: "paystack", confirmed: false, expected: "pending" },
      ].entries()) {
        const confirmedAt = scenario.confirmed ? new Date() : null;
        const [order] = await db.insert(ucOrdersTable).values({
          userId: String(customerId), status: scenario.status, total: "3000", paymentMethod: scenario.method,
          paymentReference: `canonical-dispatch-${index}`, paymentConfirmedAt: confirmedAt,
        }).returning();
        const id = order!.id;
        canonicalOrderIds.push(id);
        await reconcileCanonicalPurchase({ orderId: id });
        assert.equal((await patch({ status: "dispatched" }, token, id)).status, 200);
        const canonical = await pool.query("SELECT payment_status,fulfilment_status FROM uc_canonical_purchases WHERE companion_order_id=$1", [id]);
        assert.equal(canonical.rows[0].payment_status, scenario.expected);
        assert.equal(canonical.rows[0].fulfilment_status, "processing");
        const [saved] = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.id, id));
        assert.equal(saved!.paymentConfirmedAt?.toISOString() ?? null, confirmedAt?.toISOString() ?? null);
        assert.equal(saved!.codCollectionStatus, null);
      }
    } finally {
      if (prior === undefined) delete process.env.UC_CANONICAL_DUAL_WRITES;
      else process.env.UC_CANONICAL_DUAL_WRITES = prior;
    }
  });
  it("still fails closed if an unresolved recovery matches a different canonical source order", async () => {
    const prior = process.env.UC_CANONICAL_DUAL_WRITES;
    process.env.UC_CANONICAL_DUAL_WRITES = "true";
    try {
      const [source] = await db.insert(ucOrdersTable).values({
        userId: "unresolved-owner@test.invalid", status: "paid", total: "3000", paymentMethod: "paystack",
        paymentReference: "canonical-collision-source", webhookRecovery: true,
      }).returning();
      canonicalOrderIds.push(source!.id);
      await reconcileCanonicalPurchase({ orderId: source!.id });
      await db.update(ucOrdersTable).set({ paymentReference: "" }).where(eq(ucOrdersTable.id, source!.id));
      const [other] = await db.insert(ucOrdersTable).values({
        userId: "unresolved-owner@test.invalid", status: "paid", total: "3000", paymentMethod: "paystack",
        paymentReference: "canonical-collision-source", webhookRecovery: true,
      }).returning();
      canonicalOrderIds.push(other!.id);
      assert.equal((await patch({ shippingAddress: shipping, lineItems: lines }, token, other!.id)).status, 503);
      const [saved] = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.id, other!.id));
      assert.equal(saved!.recoveryEnrichedAt, null);
      assert.equal((await db.select().from(ucOrderItemsTable).where(eq(ucOrderItemsTable.orderId, other!.id))).length, 0);
    } finally {
      if (prior === undefined) delete process.env.UC_CANONICAL_DUAL_WRITES;
      else process.env.UC_CANONICAL_DUAL_WRITES = prior;
    }
  });
});