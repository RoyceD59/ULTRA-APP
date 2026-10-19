/** Projection only: a fulfillment status must never be represented as payment proof. */
export function orderEvidence(order: {
  status: string; paymentMethod: string; paymentConfirmedAt?: Date | string | null;
  codCollectionStatus?: string | null; checkoutState?: string | null; wcOrderId?: number | null;
  shippingAddress?: Record<string, string> | null;
}) {
  const paymentStatus = ["cancelled", "failed", "refunded", "declined"].includes(order.status) ? order.status
    : order.codCollectionStatus === "collected" || !!order.paymentConfirmedAt ? "paid"
    : order.paymentMethod === "cod" ? "awaiting_collection"
    : order.paymentMethod === "free" && order.checkoutState === "confirmed" ? "no_payment_required" : "unverified";
  const synchronizationStatus = ["remote_attempted", "remote_unknown", "remote_total_mismatch"].includes(order.checkoutState ?? "")
    ? "reconciliation_required" : order.wcOrderId ? "linked"
    : order.checkoutState === "confirmed" ? "local_only" : "not_started";
  return { checkoutState: order.checkoutState ?? null, paymentConfirmedAt: order.paymentConfirmedAt ?? null,
    paymentStatus, synchronizationStatus, wcOrderId: order.wcOrderId ?? null,
    fulfillment: order.shippingAddress?.fulfillment === "collection" ? "collection" : "delivery" };
}