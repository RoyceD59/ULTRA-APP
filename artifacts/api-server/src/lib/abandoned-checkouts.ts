import { pool } from "@workspace/db";
import { releaseUnsuccessfulCheckout, type PaymentVerifier } from "./checkout-cancellation.js";
import { logger } from "./logger.js";

/** Age only selects candidates; it is NEVER evidence that payment failed.
 * Keyset batches ensure permanently unknown old attempts cannot starve later
 * candidates. Each release rechecks the immutable attempt under a row lock. */
export async function reconcileAbandonedCheckouts(options: {
  before?: Date;
  verify?: PaymentVerifier;
  userIds?: string[];
} = {}) {
  const before = options.before ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = { checked: 0, released: 0, retained: 0, errors: 0 };
  let afterId = 0;
  for (;;) {
    const candidates = await pool.query(`SELECT * FROM uc_orders
      WHERE id>$1 AND date_created<$2 AND status='pending' AND checkout_snapshot IS NOT NULL
        AND checkout_state IN ('payment_pending','payment_initiating')
        AND payment_confirmed_at IS NULL AND remote_attempted_at IS NULL AND wc_order_id IS NULL
        AND (referral_benefit_id IS NOT NULL OR discount_percent>0 OR EXISTS (
          SELECT 1 FROM uc_promotion_uses u WHERE u.operation='checkout' AND u.operation_ref=uc_orders.id::text))
        AND ($3::text[] IS NULL OR user_id=ANY($3::text[]))
      ORDER BY id LIMIT 100`, [afterId, before, options.userIds ?? null]);
    if (!candidates.rows.length) break;
    for (const order of candidates.rows) {
      afterId = order.id;
      result.checked++;
      try {
        const outcome = await releaseUnsuccessfulCheckout(order, "abandoned_cleanup", options.verify);
        if (outcome === "released") result.released++;
        else result.retained++;
      } catch (err) {
        result.errors++;
        logger.error({ err, orderId: order.id }, "Abandoned checkout reconciliation failed; reservation retained");
      }
    }
  }
  return result;
}