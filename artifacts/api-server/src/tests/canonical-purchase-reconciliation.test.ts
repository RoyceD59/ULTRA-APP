import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { pool } from "@workspace/db";
import {
  reconcileCanonicalPurchase,
  RECONCILIATION_REASONS,
} from "../lib/canonical-purchase-reconciliation.js";

let sequence = 0;
const createdOrderIds: number[] = [];
const createdUserIds: number[] = [];
const createdCanonicalIds: number[] = [];

async function createOrder(options: {
  total?: string;
  paymentReference?: string;
  receipt?: string;
  wcOrderId?: number | null;
  productId?: number;
  paymentConfirmed?: boolean;
  discountAmount?: number;
  rawUserId?: string;
} = {}): Promise<number> {
  sequence++;
  const client = await pool.connect();
  try {
    const user = await client.query<{ id: number }>(
      `INSERT INTO uc_users (email,password_hash,first_name)
       VALUES ($1,$2,$3) RETURNING id`,
      [`canonical-${sequence}@test.invalid`, "test-hash", "Canonical"],
    );
    const userId = user.rows[0]!.id;
    const order = await client.query<{ id: number }>(
      `INSERT INTO uc_orders
         (user_id,status,total,currency,payment_method,payment_reference,mpesa_receipt,wc_order_id)
       VALUES ($1,'processing',$2,'KES','mpesa',$3,$4,$5)
       RETURNING id`,
      [
        options.rawUserId ?? String(userId),
        options.total ?? "125.50",
        options.paymentReference ?? `provider-${sequence}`,
        options.receipt ?? `receipt-${sequence}`,
        options.wcOrderId ?? null,
      ],
    );
    const orderId = order.rows[0]!.id;
    createdOrderIds.push(orderId);
    createdUserIds.push(userId);
    if (options.paymentConfirmed) {
      await client.query("UPDATE uc_orders SET payment_confirmed_at=now() WHERE id=$1", [orderId]);
    }
    if (options.discountAmount !== undefined) {
      await client.query("UPDATE uc_orders SET discount_amount=$1 WHERE id=$2", [options.discountAmount, orderId]);
    }
    await client.query(
      `INSERT INTO uc_order_items (order_id,product_id,name,quantity,total)
       VALUES ($1,$2,'Hydra Flux',2,'100.00')`,
      [orderId, options.productId ?? 1],
    );
    await client.query(
      `INSERT INTO uc_order_items (order_id,product_id,name,quantity,total)
       VALUES ($1,3,'Viva Drop',1,'25.50')`,
      [orderId],
    );
    return orderId;
  } finally {
    client.release();
  }
}

async function cleanup(): Promise<void> {
  if (!createdOrderIds.length) return;
  const orderIds = [...createdOrderIds];
  const userIds = [...createdUserIds];
  const canonicalIds = [...createdCanonicalIds];
  await pool.query(
    `DELETE FROM uc_reconciliation_conflicts
     WHERE source='uc_orders' AND source_reference LIKE ANY($1::text[])`,
    [orderIds.map((id) => `order:${id}:%`)],
  );
  await pool.query(
    `DELETE FROM uc_canonical_purchase_lines
     WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE companion_order_id = ANY($1::int[]))`,
    [orderIds],
  );
  await pool.query("DELETE FROM uc_canonical_purchases WHERE companion_order_id = ANY($1::int[])", [orderIds]);
  if (canonicalIds.length) {
    await pool.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id = ANY($1::bigint[])", [canonicalIds]);
    await pool.query("DELETE FROM uc_canonical_purchases WHERE id = ANY($1::bigint[])", [canonicalIds]);
  }
  await pool.query(
    `DELETE FROM uc_canonical_purchase_lines
     WHERE source_order_item_id IN (SELECT id FROM uc_order_items WHERE order_id = ANY($1::int[]))`,
    [orderIds],
  );
  await pool.query("DELETE FROM uc_order_items WHERE order_id = ANY($1::int[])", [orderIds]);
  await pool.query("DELETE FROM uc_orders WHERE id = ANY($1::int[])", [orderIds]);
  await pool.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id IN (SELECT id FROM uc_canonical_purchases WHERE customer_id = ANY($1::int[]))", [userIds]);
  await pool.query("DELETE FROM uc_canonical_purchases WHERE customer_id = ANY($1::int[])", [userIds]);
  await pool.query("DELETE FROM uc_users WHERE id = ANY($1::int[])", [userIds]);
  createdOrderIds.length = 0;
  createdUserIds.length = 0;
  createdCanonicalIds.length = 0;
}

beforeEach(cleanup);
after(async () => {
  await cleanup();
  await pool.end();
});

describe("canonical purchase shadow reconciliation", () => {
  it("ordinary retry has empty conflictReasons", async () => {
    const orderId = await createOrder();
    const first = await reconcileCanonicalPurchase({ orderId, correlationId: "corr-a" });
    const second = await reconcileCanonicalPurchase({ orderId, correlationId: "corr-a" });
    assert.equal(first.created, true);
    assert.equal(second.canonicalPurchaseId, first.canonicalPurchaseId);
    assert.equal(second.repeated, true);
    assert.deepEqual(second.conflictReasons, []);
    const lines = await pool.query(
      "SELECT id FROM uc_canonical_purchase_lines WHERE purchase_id=$1",
      [first.canonicalPurchaseId],
    );
    assert.equal(lines.rowCount, 2);
  });

  it("rejects whitespace leading-zero exponent and unknown source owners without mutating owned candidates", async () => {
    for (const [index, rawUserId] of [" 1", "01", "1e3", "+1", "1.0", "0"].entries()) {
      const orderId = await createOrder({ paymentReference: `owner-parse-${index}` });
      const first = await reconcileCanonicalPurchase({ orderId });
      const before = await pool.query(
        "SELECT payment_status,identity_snapshot,updated_at FROM uc_canonical_purchases WHERE id=$1",
        [first.canonicalPurchaseId],
      );
      await pool.query("UPDATE uc_orders SET user_id=$1 WHERE id=$2", [rawUserId, orderId]);
      const retry = await reconcileCanonicalPurchase({ orderId });
      assert.equal(retry.canonicalPurchaseId, first.canonicalPurchaseId);
      assert.equal(retry.conflictReasons.includes(RECONCILIATION_REASONS.UNKNOWN_SOURCE_OWNER), true);
      const after = await pool.query(
        "SELECT payment_status,identity_snapshot,updated_at FROM uc_canonical_purchases WHERE id=$1",
        [first.canonicalPurchaseId],
      );
      assert.deepEqual(after.rows[0], before.rows[0]);
    }
  });

  it("sole trusted receipt attaches after strong keys are absent", async () => {
    const firstOrder = await createOrder({ paymentReference: "receipt-owner-ref", receipt: "TRUSTED-1", paymentConfirmed: true });
    const first = await reconcileCanonicalPurchase({ orderId: firstOrder });
    createdCanonicalIds.push(first.canonicalPurchaseId);
    await pool.query(
      "UPDATE uc_canonical_purchases SET companion_order_id=NULL,payment_provider=NULL,payment_reference=NULL WHERE id=$1",
      [first.canonicalPurchaseId],
    );
    const secondOrder = await createOrder({ paymentReference: "receipt-retry-ref", receipt: "TRUSTED-1", paymentConfirmed: true });
    const owner = await pool.query("SELECT user_id FROM uc_orders WHERE id=$1", [firstOrder]);
    await pool.query("UPDATE uc_orders SET user_id=$1 WHERE id=$2", [owner.rows[0]!.user_id, secondOrder]);
    const second = await reconcileCanonicalPurchase({ orderId: secondOrder });
    assert.equal(second.canonicalPurchaseId, first.canonicalPurchaseId);
    assert.deepEqual(second.conflictReasons, []);
  });

  it("same-linked order removes stale NULL/source lines and updates quantity/name/unit/total", async () => {
    const orderId = await createOrder({ paymentReference: "authoritative-refresh" });
    const first = await reconcileCanonicalPurchase({ orderId });
    await pool.query(
      `INSERT INTO uc_canonical_purchase_lines
       (purchase_id,product_id,product_name,quantity,line_total_minor)
       VALUES ($1,999,'Imported stale',1,777)`,
      [first.canonicalPurchaseId],
    );
    await pool.query(
      "UPDATE uc_order_items SET quantity=1,name='Updated product',total='80.00' WHERE order_id=$1 AND product_id=1",
      [orderId],
    );
    const refreshed = await reconcileCanonicalPurchase({ orderId });
    assert.deepEqual(refreshed.conflictReasons, []);
    const lines = await pool.query(
      "SELECT product_name,quantity,line_total_minor FROM uc_canonical_purchase_lines WHERE purchase_id=$1 ORDER BY id",
      [first.canonicalPurchaseId],
    );
    assert.equal(lines.rows.some((line) => line.product_name === "Imported stale"), false);
    assert.equal(lines.rows.some((line) => line.product_name === "Updated product" && line.quantity === 1 && line.line_total_minor === 8000), true);
  });

  it("cross-representation same-total different-product conflicts", async () => {
    const firstOrder = await createOrder({ paymentReference: "product-owner" });
    const first = await reconcileCanonicalPurchase({ orderId: firstOrder });
    const secondOrder = await createOrder({ paymentReference: "product-representation", productId: 999 });
    await pool.query("UPDATE uc_canonical_purchases SET companion_order_id=NULL,payment_provider='mpesa',payment_reference='product-representation' WHERE id=$1", [first.canonicalPurchaseId]);
    const result = await reconcileCanonicalPurchase({ orderId: secondOrder });
    assert.equal(result.conflictReasons.includes(RECONCILIATION_REASONS.PRODUCT_MISMATCH), true);
    assert.equal(result.canonicalPurchaseId, first.canonicalPurchaseId);
  });

  it("subtotal+derived delivery+non-PII snapshot projection", async () => {
    const orderId = await createOrder({ paymentReference: "components", discountAmount: 10 });
    const result = await reconcileCanonicalPurchase({ orderId });
    const row = await pool.query("SELECT subtotal_minor,delivery_minor,identity_snapshot FROM uc_canonical_purchases WHERE id=$1", [result.canonicalPurchaseId]);
    assert.equal(row.rows[0]!.subtotal_minor, 12550);
    assert.equal(row.rows[0]!.delivery_minor, 1000);
    assert.deepEqual(Object.keys(row.rows[0]!.identity_snapshot).sort(), ["customerId", "orderId", "source"]);
  });

  it("currency mismatch", async () => {
    const orderId = await createOrder({ paymentReference: "currency-owner" });
    const result = await reconcileCanonicalPurchase({ orderId });
    await pool.query("UPDATE uc_orders SET currency='USD' WHERE id=$1", [orderId]);
    const retry = await reconcileCanonicalPurchase({ orderId });
    assert.equal(retry.canonicalPurchaseId, result.canonicalPurchaseId);
    assert.equal(retry.conflictReasons.includes(RECONCILIATION_REASONS.CURRENCY_MISMATCH), true);
  });

  it("ambiguous receipt concurrent serialization", async () => {
    const firstOrder = await createOrder({ paymentReference: "ambiguous-a", receipt: "AMBIGUOUS", paymentConfirmed: true });
    const secondOrder = await createOrder({ paymentReference: "ambiguous-b", receipt: "AMBIGUOUS", paymentConfirmed: true });
    await Promise.all([reconcileCanonicalPurchase({ orderId: firstOrder }), reconcileCanonicalPurchase({ orderId: secondOrder })]);
    const conflicts = await pool.query("SELECT count(*)::int AS count FROM uc_reconciliation_conflicts WHERE source_reference LIKE ANY($1::text[])", [[`order:${firstOrder}:%`, `order:${secondOrder}:%`]]);
    assert.equal(conflicts.rows[0]!.count > 0, true);
  });

  it("simultaneous strong and trusted receipt split persists every candidate", async () => {
    const firstOrder = await createOrder({ paymentReference: "split-strong", wcOrderId: 901 });
    const first = await reconcileCanonicalPurchase({ orderId: firstOrder });
    const secondOrder = await createOrder({ paymentReference: "split-receipt", receipt: "SPLIT-R", paymentConfirmed: true });
    const second = await reconcileCanonicalPurchase({ orderId: secondOrder });
    const thirdOrder = await createOrder({ paymentReference: "split-source", receipt: "SPLIT-R", wcOrderId: 901, paymentConfirmed: true });
    const third = await reconcileCanonicalPurchase({ orderId: thirdOrder });
    assert.equal(third.conflictReasons.includes(RECONCILIATION_REASONS.KEY_COLLISION), true);
    const rows = await pool.query(
      `SELECT count(*)::int AS count FROM uc_reconciliation_conflicts
       WHERE source_reference LIKE $1 AND reason=$2`,
      [`order:${thirdOrder}:%`, RECONCILIATION_REASONS.KEY_COLLISION],
    );
    assert.equal(rows.rows[0]!.count, 2);
    assert.notEqual(first.canonicalPurchaseId, second.canonicalPurchaseId);
  });

  it("does not create a second purchase for a duplicate provider reference", async () => {
    const firstOrder = await createOrder({ paymentReference: "first-provider-ref" });
    const first = await reconcileCanonicalPurchase({ orderId: firstOrder });
    const secondOrder = await createOrder({ paymentReference: "second-provider-ref" });
    await pool.query(
      "UPDATE uc_canonical_purchases SET payment_provider='mpesa', payment_reference='second-provider-ref' WHERE id=$1",
      [first.canonicalPurchaseId],
    );
    const second = await reconcileCanonicalPurchase({ orderId: secondOrder });
    assert.equal(second.canonicalPurchaseId, first.canonicalPurchaseId);
    assert.equal(second.conflictReasons.includes(RECONCILIATION_REASONS.KEY_COLLISION), true);
    const count = await pool.query(
      "SELECT count(*)::int AS count FROM uc_canonical_purchases WHERE id=$1",
      [first.canonicalPurchaseId],
    );
    assert.equal(count.rows[0]!.count, 1);
  });

  it("does not globally deduplicate receipts and records a weak receipt conflict", async () => {
    const firstOrder = await createOrder({ receipt: "SHARED-RECEIPT", paymentReference: "" });
    const first = await reconcileCanonicalPurchase({ orderId: firstOrder });
    const secondOrder = await createOrder({ receipt: "SHARED-RECEIPT", paymentReference: "" });
    const second = await reconcileCanonicalPurchase({ orderId: secondOrder });
    assert.notEqual(second.canonicalPurchaseId, first.canonicalPurchaseId);
    assert.equal(second.conflictReasons.includes(RECONCILIATION_REASONS.AMBIGUOUS_RECEIPT), true);
    const conflicts = await pool.query(
      "SELECT reason FROM uc_reconciliation_conflicts WHERE reason=$1 AND source_reference LIKE $2",
      [RECONCILIATION_REASONS.AMBIGUOUS_RECEIPT, `order:${secondOrder}:%`],
    );
    assert.equal(conflicts.rowCount, 1);
  });

  it("keeps a cross-customer provider collision isolated and queued", async () => {
    const firstOrder = await createOrder({ paymentReference: "first-cross-ref" });
    const first = await reconcileCanonicalPurchase({ orderId: firstOrder });
    const secondOrder = await createOrder({ paymentReference: "second-cross-ref" });
    await pool.query(
      "UPDATE uc_canonical_purchases SET payment_provider='mpesa', payment_reference='second-cross-ref' WHERE id=$1",
      [first.canonicalPurchaseId],
    );
    const second = await reconcileCanonicalPurchase({ orderId: secondOrder });
    assert.equal(second.canonicalPurchaseId, first.canonicalPurchaseId);
    assert.equal(second.conflictReasons.includes(RECONCILIATION_REASONS.CROSS_CUSTOMER), true);
    const owners = await pool.query(
      "SELECT customer_id FROM uc_canonical_purchases WHERE id=$1",
      [first.canonicalPurchaseId],
    );
    const firstOwner = await pool.query("SELECT user_id::int AS user_id FROM uc_orders WHERE id=$1", [firstOrder]);
    assert.equal(owners.rows[0]!.customer_id, firstOwner.rows[0]!.user_id);
  });

  it("queues an amount mismatch without rewriting the canonical amount", async () => {
    const orderId = await createOrder({ paymentReference: "amount-ref" });
    const first = await reconcileCanonicalPurchase({ orderId });
    await pool.query("UPDATE uc_orders SET total='999.00' WHERE id=$1", [orderId]);
    const second = await reconcileCanonicalPurchase({ orderId });
    assert.equal(second.canonicalPurchaseId, first.canonicalPurchaseId);
    assert.equal(second.conflictReasons.includes(RECONCILIATION_REASONS.AMOUNT_MISMATCH), true);
    const purchase = await pool.query(
      "SELECT total_minor FROM uc_canonical_purchases WHERE id=$1",
      [first.canonicalPurchaseId],
    );
    assert.equal(purchase.rows[0]!.total_minor, 12550);
  });

  it("rolls back the projection when an invalid source amount is encountered", async () => {
    const orderId = await createOrder({ total: "not-money", paymentReference: "rollback-ref" });
    await assert.rejects(
      () => reconcileCanonicalPurchase({ orderId }),
      (error: { code?: string }) => error.code === "INVALID_AMOUNT",
    );
    const purchases = await pool.query(
      "SELECT count(*)::int AS count FROM uc_canonical_purchases WHERE companion_order_id=$1", [orderId],
    );
    assert.equal(purchases.rows[0]!.count, 0);
  });

  it("serializes concurrent retries into one purchase and line set", async () => {
    const orderId = await createOrder({ paymentReference: "concurrent-ref" });
    const results = await Promise.all([
      reconcileCanonicalPurchase({ orderId }),
      reconcileCanonicalPurchase({ orderId }),
      reconcileCanonicalPurchase({ orderId }),
    ]);
    assert.equal(new Set(results.map((result) => result.canonicalPurchaseId)).size, 1);
    const purchases = await pool.query(
      "SELECT count(*)::int AS count FROM uc_canonical_purchases WHERE companion_order_id=$1", [orderId],
    );
    const lines = await pool.query(
      `SELECT count(*)::int AS count FROM uc_canonical_purchase_lines
       WHERE purchase_id=(SELECT id FROM uc_canonical_purchases WHERE companion_order_id=$1)`, [orderId],
    );
    assert.equal(purchases.rows[0]!.count, 1);
    assert.equal(lines.rows[0]!.count, 2);
  });
});
