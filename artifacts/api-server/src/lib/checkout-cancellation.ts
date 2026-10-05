import { pool } from "@workspace/db";
import { verifyPaymentOnServer } from "../routes/uc.js";

export type PaymentVerifier = typeof verifyPaymentOnServer;
type ReleaseResult = "released" | "already_cancelled" | "retained";

function releasable(order: any) {
  return order.checkout_snapshot && order.status === "pending" &&
    ["payment_pending", "payment_initiating"].includes(order.checkout_state) &&
    !order.payment_confirmed_at && !order.wc_order_id && !order.remote_attempted_at &&
    !order.mpesa_receipt && !order.webhook_recovery;
}

function neverInitiated(order: any) {
  const snapshot = order.checkout_snapshot;
  return order.checkout_state === "payment_pending" && !order.payment_reference &&
    snapshot.paymentNotStarted === true && !snapshot.provider && !snapshot.paymentStartedAt &&
    (snapshot.paymentAttempts ?? []).every((attempt: any) => attempt.outcome === "terminal_failure");
}

/** Provider I/O happens before locking. The release transaction must still find
 * the exact same attempt and an unpaid, unfulfilled order after that I/O. */
export async function releaseUnsuccessfulCheckout(
  order: any,
  source: "customer" | "abandoned_cleanup",
  verify: PaymentVerifier = verifyPaymentOnServer,
): Promise<ReleaseResult> {
  if (order.status === "cancelled") return "already_cancelled";
  if (!releasable(order)) return "retained";
  const uninitiated = neverInitiated(order);
  let evidence: Awaited<ReturnType<PaymentVerifier>> | undefined;
  if (!uninitiated) {
    if (!order.payment_reference || !["paystack", "mpesa", "stripe"].includes(order.payment_method)) return "retained";
    evidence = await verify(order.payment_method, order.payment_reference);
    if (evidence.ok || evidence.failureFinal !== true) return "retained";
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [order.user_id, order.checkout_idempotency_key]);
    const result = await client.query("SELECT * FROM uc_orders WHERE id=$1 FOR UPDATE", [order.id]);
    const current = result.rows[0];
    if (current?.status === "cancelled") { await client.query("COMMIT"); return "already_cancelled"; }
    if (!current || !releasable(current) || current.payment_reference !== order.payment_reference ||
        current.payment_method !== order.payment_method || current.checkout_state !== order.checkout_state ||
        current.checkout_snapshot.paymentAttemptId !== order.checkout_snapshot.paymentAttemptId ||
        (uninitiated && !neverInitiated(current))) {
      await client.query("COMMIT"); return "retained";
    }
    // Active-use rows count toward limits. Preserve their full evidence in the
    // immutable order's release audit before removing them from those counts.
    const uses = await client.query(`DELETE FROM uc_promotion_uses
      WHERE operation='checkout' AND operation_ref=$1 AND user_id=$2 RETURNING *`,
      [String(current.id), Number(current.user_id) || 0]);
    const benefits = current.referral_benefit_id ? await client.query(`UPDATE uc_referral_benefits
      SET status='available',used_order_id=NULL,used_at=NULL
      WHERE id=$1 AND used_order_id=$2 AND status='used' RETURNING id`,
      [current.referral_benefit_id, current.id]) : null;
    const audit = { source, releasedAt: new Date().toISOString(),
      outcome: uninitiated ? "never_initiated" : "terminal_failure",
      method: current.payment_method, reference: current.payment_reference,
      attemptId: current.checkout_snapshot.paymentAttemptId, evidence,
      promotionUses: uses.rows, referralBenefitId: current.referral_benefit_id ?? null,
      referralRestored: !!benefits?.rows[0] };
    await client.query(`UPDATE uc_orders SET status='cancelled',checkout_state='cancelled',
      referral_benefit_id=NULL,
      checkout_snapshot=jsonb_set(checkout_snapshot,'{benefitRelease}',$2::jsonb) WHERE id=$1`,
      [current.id, JSON.stringify(audit)]);
    await client.query("COMMIT");
    return "released";
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Release only a never-initiated or independently verified failed payment. */
export async function cancelCheckout(key: string, userId: string) {
  // Establish absence under the same lock as preparation, and leave a durable
  // barrier against an old request arriving after the customer starts editing.
  const client = await pool.connect();
  let order: any;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [userId, key]);
    const result = await client.query("SELECT * FROM uc_orders WHERE user_id=$1 AND checkout_idempotency_key=$2", [userId, key]);
    order = result.rows[0];
    if (!order) await client.query(`INSERT INTO uc_checkout_retirements(user_id,idempotency_key)
      VALUES($1,$2) ON CONFLICT(user_id,idempotency_key) DO NOTHING`, [userId, key]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  if (!order) return;
  if (!order.checkout_snapshot) throw new Error("Checkout cannot be cancelled here");
  if (await releaseUnsuccessfulCheckout(order, "customer") === "retained") {
    throw new Error("Payment may still complete or fulfillment needs reconciliation. Resume it or ask the team to resolve it before changing method.");
  }
}