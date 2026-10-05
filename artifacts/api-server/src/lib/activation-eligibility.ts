/** Acceptance and payment are different evidence; COD need not be paid to be installed. */
export function activationEligibility(order: {
  status: string; paymentMethod: string; checkoutState?: string | null;
  paymentConfirmedAt?: unknown; codCollectionStatus?: string | null;
  customerStage?: string | null; datePaid?: unknown;
}, source: "app" | "store"): { eligible: boolean; reason: string | null } {
  if (["failed", "declined", "cancelled", "refunded", "pending-wc"].includes(order.status)
    || order.status === "pending" && !(order.paymentMethod === "cod" && order.checkoutState === "confirmed"))
    return { eligible: false, reason: "This order is failed, cancelled, refunded or still awaiting acceptance/payment." };
  if (order.checkoutState && order.checkoutState !== "confirmed")
    return { eligible: false, reason: "Checkout synchronization or payment is unresolved. Contact the team before activation." };
  const fulfilled = ["shipped", "delivered", "completed"].includes(order.status)
    || ["shipped", "delivered"].includes(order.customerStage ?? "");
  const paid = source === "app" ? !!order.paymentConfirmedAt || order.codCollectionStatus === "collected"
    : typeof order.datePaid === "string" && Number.isFinite(Date.parse(order.datePaid));
  const codAccepted = order.paymentMethod === "cod" &&
    (fulfilled || order.checkoutState === "confirmed" || order.customerStage === "accepted" ||
      (source === "store" && order.status === "processing"));
  return paid || codAccepted || fulfilled
    ? { eligible: true, reason: null }
    : { eligible: false, reason: "No verified payment or accepted COD/fulfillment evidence is available." };
}

export function validInstallationDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
    && value <= new Date().toISOString().slice(0, 10);
}

export function purchaseUnitIds(source: string, orderId: number, lineId: number, quantity: number) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !Number.isSafeInteger(lineId) || lineId <= 0 ||
      !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000) return [];
  return Array.from({ length: quantity }, (_, i) => `${source}:${orderId}:${lineId}:${i + 1}`);
}