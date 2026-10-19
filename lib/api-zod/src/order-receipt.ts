/** Pure receipt presentation shared by email and Companion. No customer storage. */
export const COD_PAYMENT_DETAILS = {
  mpesaTill: "568 0516",
  paybill: "542 542",
  paybillAccount: "071908000",
  phone: "0717774049",
} as const;

export function orderReceiptSerial(orderId: string | number, dateCreated?: string | Date): string {
  const candidate = dateCreated ? new Date(dateCreated) : new Date();
  const valid = Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  // Preserve the existing serial convention for already-issued receipts.
  const ymd = [valid.getFullYear(), String(valid.getMonth() + 1).padStart(2, "0"),
    String(valid.getDate()).padStart(2, "0")].join("");
  return `UC-${ymd}-${String(orderId).replace(/\D/g, "").padStart(6, "0")}`;
}

export function receiptPaymentLabel(method: string): string {
  return ({ mpesa: "M-Pesa", stripe: "Card (Stripe)", paystack: "Card (Paystack)",
    cod: "Cash on Delivery" } as Record<string, string>)[method] ?? method;
}

/** Only explicit paid evidence may label a receipt as paid. */
export function receiptPaymentState(status?: string): string {
  switch (status?.toLowerCase()) {
    case "paid": return "Paid";
    case "no_payment_required": return "No payment required";
    case "unverified": return "Payment unverified";
    case "declined": return "Payment declined";
    case "refunded": return "Refunded";
    case "failed": return "Payment failed";
    case "cancelled": return "Cancelled";
    default: return "Payment pending";
  }
}

/** Receipt display only; never used to authorize fulfillment or payment. */
export function receiptOrderPaymentStatus(order: {
  paymentMethod: string; status: string; paymentStatus?: string;
  codCollectionStatus?: string | null;
  paymentConfirmedAt?: string | Date | null;
  checkoutState?: string | null;
}): string {
  if (["refunded", "cancelled", "failed", "declined"].includes(order.status)) return order.status;
  if (order.paymentMethod === "cod") {
    // A Woo-normalized paid state or recorded confirmation timestamp is also
    // verified evidence. Collection tracking may not exist for a Woo order.
    return order.codCollectionStatus === "collected" || order.paymentStatus === "paid" || !!order.paymentConfirmedAt
      ? "paid" : "pending";
  }
  if (order.paymentStatus) return order.paymentStatus;
  if (order.paymentConfirmedAt) return "paid";
  if (order.paymentMethod === "free" && order.checkoutState === "confirmed") return "no_payment_required";
  // Operational fulfillment status never proves that money was received.
  return "unverified";
}

export function receiptMoney(value: string | number, currency: string): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `${currency} ${amount.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`
    : "Amount unavailable";
}

export interface ReceiptOrder {
  id: number | string;
  orderNumber?: number | string;
  dateCreated: string;
  currency: string;
  total: string;
  paymentMethod: string;
  paymentStatus?: string;
  paymentReference?: string;
  receiptSerial?: string;
  discountAmount?: number;
  promoCode?: string;
  lineItems: { name?: string; quantity?: number; total?: string }[];
  shippingAddress?: {
    firstName?: string; lastName?: string; address1?: string; address2?: string;
    city?: string; country?: string; fulfillment?: string; shippingAmount?: string;
  };
}

export interface CustomerReceipt {
  serial: string;
  orderNumber: string;
  date: string;
  customerName: string;
  paymentMethod: string;
  paymentState: string;
  paymentReference?: string;
  fulfillment: string;
  address: string;
  items: { name: string; quantity: string; total: string }[];
  discount?: string;
  promoCode?: string;
  shipping?: string;
  total: string;
  codPaymentDue: boolean;
}

export function buildCustomerReceipt(order: ReceiptOrder): CustomerReceipt {
  const address = order.shippingAddress;
  const date = new Date(order.dateCreated);
  const paymentState = receiptPaymentState(order.paymentStatus);
  const collection = address?.fulfillment === "collection";
  return {
    serial: order.receiptSerial ?? orderReceiptSerial(order.orderNumber ?? order.id, order.dateCreated),
    orderNumber: String(order.orderNumber ?? order.id),
    date: Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString("en-KE", {
      day: "numeric", month: "short", year: "numeric",
    }),
    customerName: [address?.firstName, address?.lastName].filter(Boolean).join(" "),
    paymentMethod: receiptPaymentLabel(order.paymentMethod),
    paymentState,
    ...(order.paymentReference ? { paymentReference: order.paymentReference } : {}),
    fulfillment: collection ? "Free collection" : "Delivery",
    address: collection ? "Collection details will be confirmed by our team."
      : [address?.address1, address?.address2, address?.city, address?.country].filter(Boolean).join(", ") || "To be confirmed",
    items: order.lineItems.map((item) => ({
      name: item.name || "Item",
      quantity: item.quantity == null ? "—" : String(item.quantity),
      total: item.total == null || item.total === "" ? "Amount unavailable" : receiptMoney(item.total, order.currency),
    })),
    ...(Number(order.discountAmount) > 0 ? {
      discount: receiptMoney(order.discountAmount!, order.currency),
      promoCode: order.promoCode,
    } : {}),
    ...(address?.shippingAmount != null ? { shipping: receiptMoney(address.shippingAmount, order.currency) } : {}),
    total: receiptMoney(order.total, order.currency),
    codPaymentDue: order.paymentMethod === "cod" && paymentState === "Payment pending",
  };
}

export function customerReceiptText(receipt: CustomerReceipt): string {
  return [
    "Ultra Clear Filters — Order receipt",
    receipt.serial, `Order #${receipt.orderNumber} · ${receipt.date}`,
    ...(receipt.customerName ? [receipt.customerName] : []),
    "", ...(receipt.items.length
      ? receipt.items.map((item) => `${item.name} × ${item.quantity} — ${item.total}`)
      : ["No items listed"]),
    ...(receipt.discount ? [`Discount${receipt.promoCode ? ` (${receipt.promoCode})` : ""}: -${receipt.discount}`] : []),
    ...(receipt.shipping ? [`Delivery: ${receipt.shipping}`] : []),
    `Total: ${receipt.total}`, `${receipt.paymentMethod} — ${receipt.paymentState}`,
    ...(receipt.paymentReference ? [`Payment reference: ${receipt.paymentReference}`] : []),
    `${receipt.fulfillment}: ${receipt.address}`,
    ...(receipt.codPaymentDue ? ["Payment is due on delivery. This receipt is not proof of payment.",
      `M-Pesa Till: ${COD_PAYMENT_DETAILS.mpesaTill}`,
      `Paybill: ${COD_PAYMENT_DETAILS.paybill} · Account: ${COD_PAYMENT_DETAILS.paybillAccount}`] : []),
    "", `Questions? Call ${COD_PAYMENT_DETAILS.phone} or email support@ucfilters.co.ke`,
  ].join("\n");
}

export function receiptEscapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

/** Complete private print document: no scripts, external assets or app navigation. */
export function customerReceiptHtml(receipt: CustomerReceipt): string {
  const esc = receiptEscapeHtml;
  const row = (label: string, value: string) => `<div class="row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(receipt.serial)} — Ultra Clear receipt</title>
<style>
@page{size:A4;margin:15mm}*{box-sizing:border-box}
body{margin:0;background:#fff;color:#1a1a1a;font:15px/1.6 Arial,sans-serif}
main{max-width:640px;margin:auto;padding:20px}header{border-bottom:3px solid #52b6dc;margin-bottom:20px}
h1{color:#005d8f;font-size:25px;margin:0}h2{font-size:19px;margin:12px 0}
p{overflow-wrap:anywhere} .row{display:flex;justify-content:space-between;gap:16px;padding:6px 0;flex-wrap:wrap}
.row strong{text-align:right;overflow-wrap:anywhere;max-width:100%}
.item{border-bottom:1px solid #e5e7eb;padding:12px 0;break-inside:avoid}
.total{border-top:2px solid #005d8f;color:#005d8f;font-size:20px;font-weight:bold;margin-top:12px}
.note{background:#fff7ed;padding:12px;border-left:3px solid #92400e}
footer{border-top:1px solid #e5e7eb;margin-top:24px;font-size:13px}
@media print{main{padding:0}}
</style></head><body><main>
<header><h1>Ultra Clear Filters</h1><h2>Order receipt</h2><p>${esc(receipt.serial)}</p></header>
${row("Order", `#${receipt.orderNumber}`)}${row("Date", receipt.date)}
${receipt.customerName ? row("Customer", receipt.customerName) : ""}
${row("Payment", receipt.paymentMethod)}${row("Payment status", receipt.paymentState)}
${receipt.paymentReference ? row("Payment reference", receipt.paymentReference) : ""}
<h2>Items ordered</h2>
${receipt.items.length ? receipt.items.map((item) => `<div class="item"><strong>${esc(item.name)}</strong>${row(`Quantity: ${item.quantity}`, item.total)}</div>`).join("") : "<p>No items listed</p>"}
${receipt.discount ? row(`Discount${receipt.promoCode ? ` (${receipt.promoCode})` : ""}`, `-${receipt.discount}`) : ""}
${receipt.shipping ? row("Delivery", receipt.shipping) : ""}
<div class="total">${row("Total", receipt.total)}</div>
<h2>${esc(receipt.fulfillment)}</h2><p>${esc(receipt.address)}</p>
${receipt.codPaymentDue ? `<div class="note"><strong>Payment due on delivery</strong><p>This receipt is not proof of payment.</p>
<p>M-Pesa Till: ${COD_PAYMENT_DETAILS.mpesaTill}<br>Paybill: ${COD_PAYMENT_DETAILS.paybill}<br>Account: ${COD_PAYMENT_DETAILS.paybillAccount}</p></div>` : ""}
<footer>Quote your receipt number when contacting us.<br>Call ${COD_PAYMENT_DETAILS.phone} · support@ucfilters.co.ke</footer>
</main></body></html>`;
}
