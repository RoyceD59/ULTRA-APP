import type { Pool } from "pg";
import { orderEvidence } from "./order-evidence.js";

/** Explicit IDs only. No provider calls, data changes, ownership linking, or payment inference. */
export async function checkoutDiagnostics(db: Pick<Pool, "query">, ids: number[]) {
  const rows = (await db.query(`SELECT id,status,payment_method,payment_confirmed_at,cod_collection_status,checkout_state,
    wc_order_id,shipping_address,checkout_claim_id,remote_attempted_at,
    checkout_snapshot->>'paymentNotStarted' AS payment_not_started,
    checkout_snapshot->>'confirmationDispatch' AS receipt_dispatch
    FROM uc_orders WHERE id=ANY($1::int[]) ORDER BY id`, [ids])).rows;
  return { readOnly: true, checkedAt: new Date().toISOString(), requestedIds: ids,
    missingLocalIds: ids.filter(id => !rows.some(r => r.id === id)),
    orders: rows.map(row => ({
      id: row.id, status: row.status, ...orderEvidence({
        status: row.status, paymentMethod: row.payment_method, paymentConfirmedAt: row.payment_confirmed_at,
        codCollectionStatus: row.cod_collection_status, checkoutState: row.checkout_state, wcOrderId: row.wc_order_id,
        shippingAddress: row.shipping_address,
      }), hasClaimIdentity: !!row.checkout_claim_id, remoteAttemptRecorded: !!row.remote_attempted_at,
      paymentNotStarted: row.payment_not_started === "true",
      receiptDispatch: ["queuing", "queued", "queue_failed"].includes(row.receipt_dispatch) ? row.receipt_dispatch : "not_recorded",
      receiptNeedsReview: ["queuing", "queue_failed"].includes(row.receipt_dispatch),
      contactComplete: !!row.shipping_address?.address1?.trim() && !!row.shipping_address?.phone?.trim(),
      action: ["remote_attempted", "remote_unknown", "remote_total_mismatch"].includes(row.checkout_state)
        ? "Review the immutable claim and verified provider evidence. Do not repeat a charge or Woo create."
        : row.checkout_state === "confirmed" ? "Accepted local record. Check ProjectHub date/status/recovery filters if hidden."
        : "Pending or legacy record. A status alone does not prove payment.",
    })) };
}