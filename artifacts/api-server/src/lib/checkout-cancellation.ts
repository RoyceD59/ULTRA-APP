import { pool } from "@workspace/db";
import { verifyPaymentOnServer } from "../routes/uc.js";

/** Release only a never-initiated or independently verified failed payment.
 * Pending, unknown, successfully paid and remotely attempted orders stay bound. */
export async function cancelCheckout(key: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [userId,key]);
    const result = await client.query("SELECT * FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2 FOR UPDATE", [userId,key]);
    const order = result.rows[0];
    if (!order) { await client.query("COMMIT"); return; }
    if (!order.checkout_snapshot) throw new Error("Checkout cannot be cancelled here");
    if (order.status === "cancelled") { await client.query("COMMIT"); return; }
    if (["confirmed","remote_attempted","remote_unknown","remote_total_mismatch"].includes(order.checkout_state)) throw new Error("This order cannot be cancelled while fulfillment or reconciliation is in progress");
    const neverInitiated = order.checkout_state === "payment_pending" && !order.payment_reference;
    if (!neverInitiated) {
      const payment = await verifyPaymentOnServer(order.payment_method, order.payment_reference ?? "");
      if (!payment.failureFinal) throw new Error("Payment may still complete. Resume it or ask the team to resolve it before changing method.");
    }
    await client.query("DELETE FROM uc_promotion_uses WHERE operation='checkout' AND operation_ref=$1 AND user_id=$2", [String(order.id), Number(userId) || 0]);
    if (order.referral_benefit_id) await client.query(`UPDATE uc_referral_benefits SET status='available',used_order_id=NULL,used_at=NULL
      WHERE id=$1 AND used_order_id=$2 AND status='used'`,[order.referral_benefit_id,order.id]);
    await client.query("UPDATE uc_orders SET status='cancelled',checkout_state='cancelled',referral_benefit_id=NULL WHERE id=$1",[order.id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}