import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { UpdateUcAdminOrderBody } from "@workspace/api-zod";
import { isAdminRequest } from "../lib/adminAuth.js";
import { reconcileCanonicalPurchaseDualWrite, CanonicalPurchaseDualWriteError } from "../lib/canonical-purchase-dual-write.js";
import { logger } from "../lib/logger.js";

const router = Router();

function completeShipping(address: Record<string, string>): boolean {
  const name = address.firstName || address.name;
  return !!(name?.trim() && address.phone?.trim() &&
    (["collection", "pickup"].includes(address.fulfillment ?? "") ||
      ((address.address1 || address.address)?.trim() && address.city?.trim() && address.country?.trim())));
}

// Internal fulfilment only: no payment mutation, identity reassignment or customer push.
router.patch("/uc/admin/orders/:id", async (req: Request, res: Response): Promise<void> => {
  if (!await isAdminRequest(req.headers.authorization)) {
    res.status(403).json({ error: "Admin access required" }); return;
  }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    res.status(400).json({ error: "Invalid order id" }); return;
  }
  const parsed = UpdateUcAdminOrderBody.strict().safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) {
    res.status(400).json({ error: "Provide a valid status, shippingAddress or lineItems update" }); return;
  }
  const input = parsed.data;
  // Orval's numeric schemas do not enforce integer semantics.
  if (input.lineItems?.some(item => !Number.isInteger(item.productId) ||
      !Number.isInteger(item.quantity) || !item.name.trim() ||
      Object.keys(item).some(key => !["productId", "name", "quantity", "total"].includes(key))) ||
      (input.shippingAddress && Object.keys(input.shippingAddress).length > 50)) {
    res.status(400).json({ error: "Items require integer product IDs and quantities and a non-empty name; shipping is limited to 50 fields" }); return;
  }
  const client = await pool.connect().catch(err => {
    logger.error({ err, orderId: id }, "Failed to connect for admin order update");
    res.status(500).json({ error: "Failed to update order" });
    return null;
  });
  if (!client) return;
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM uc_orders WHERE id=$1 FOR UPDATE", [id]);
    const order = found.rows[0];
    if (!order) { await client.query("ROLLBACK"); res.status(404).json({ error: "Order not found" }); return; }
    if (order.status === "refunded") {
      await client.query("ROLLBACK"); res.status(409).json({ error: "Refunded orders cannot be edited" }); return;
    }
    const shippingAddress: Record<string, string> = {
      ...(order.shipping_address ?? {}),
      ...Object.fromEntries(Object.entries(input.shippingAddress ?? {}).map(([key, value]) => [key, value.trim()])),
    };
    const items = input.lineItems ?? (await client.query(
      "SELECT product_id AS \"productId\", name, quantity, total FROM uc_order_items WHERE order_id=$1 ORDER BY id", [id],
    )).rows;
    const enriching = order.webhook_recovery && (input.lineItems !== undefined || input.shippingAddress !== undefined);
    if ((enriching || (order.webhook_recovery && input.status === "dispatched")) &&
        (!items.length || !completeShipping(shippingAddress))) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Confirm at least one item, customer name and phone, and delivery address, city and country (or select pickup) before saving enrichment or dispatching" }); return;
    }
    if (order.webhook_recovery && input.status === "dispatched" && !enriching && !order.recovery_enriched_at) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Save recovery enrichment before dispatching" }); return;
    }
    if (input.lineItems) {
      await client.query("DELETE FROM uc_order_items WHERE order_id=$1", [id]);
      for (const item of input.lineItems) {
        await client.query(
          "INSERT INTO uc_order_items (order_id,product_id,name,quantity,total) VALUES ($1,$2,$3,$4,$5)",
          [id, item.productId, item.name.trim(), item.quantity, item.total],
        );
      }
    }
    // Internal dispatch must not erase established payment evidence or imply
    // COD cash collection. Preserve the same classification as customer fulfilment.
    const paymentStatus = order.payment_confirmed_at || order.cod_collection_status === "collected"
      ? "paid"
      : order.payment_method === "cod" ? "pending"
      : order.fulfillment_payment_status ??
        (["processing", "completed", "paid"].includes(order.status) ? "paid" :
          ["failed", "cancelled"].includes(order.status) ? "failed" : "pending");
    const updated = await client.query(
      `UPDATE uc_orders SET status=$2, shipping_address=CASE WHEN $5 THEN $3::json ELSE shipping_address END,
         recovery_enriched_at=CASE WHEN $4 THEN now() ELSE recovery_enriched_at END,
         fulfillment_payment_status=CASE WHEN $2='dispatched' THEN $6 ELSE fulfillment_payment_status END
       WHERE id=$1 RETURNING status, recovery_enriched_at`, [
        id, input.status ?? order.status, JSON.stringify(shippingAddress), !!enriching, input.shippingAddress !== undefined, paymentStatus,
      ],
    );
    await reconcileCanonicalPurchaseDualWrite(id, `admin-order:${id}`, client);
    await client.query("COMMIT");
    logger.info({ orderId: id, status: updated.rows[0].status, enriched: !!enriching }, "Admin updated order fulfilment");
    res.json({ ok: true, id, status: updated.rows[0].status, recoveryEnrichedAt: updated.rows[0].recovery_enriched_at });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err, orderId: id }, "Failed to update admin order");
    res.status(err instanceof CanonicalPurchaseDualWriteError ? 503 : 500).json({
      error: err instanceof CanonicalPurchaseDualWriteError ? "Order reconciliation requires retry" : "Failed to update order",
    });
  } finally {
    client.release();
  }
});

export default router;