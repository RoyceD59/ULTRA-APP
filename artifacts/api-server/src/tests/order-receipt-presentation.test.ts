import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOrderReceiptEmail } from "../lib/email.js";
import { buildCustomerReceipt, receiptOrderPaymentStatus, customerReceiptHtml, customerReceiptText } from "@workspace/api-zod/order-receipt";

const params = {
  orderId: 181, firstName: "Test", email: "receipt-test@example.invalid",
  total: "4100.5", currency: "KES", paymentMethod: "cod", paymentStatus: "pending",
  dateCreated: "2026-10-07T09:00:00Z", discountAmount: 400, promoCode: "WATER10",
  lineItems: [{ name: "Hydra Flux", quantity: 2, total: "4000.5" }],
  shippingAddress: { firstName: "Test", fulfillment: "delivery", address1: "Test address",
    city: "Nairobi", shippingAmount: "500" },
};

describe("receipt email and confirmation consistency", () => {
  it("uses the same serial, totals, discount, shipping and payment state", () => {
    const email = buildOrderReceiptEmail(params);
    const page = buildCustomerReceipt({ ...params, id: params.orderId });
    for (const value of [page.serial, page.total, page.shipping!, page.discount!, page.paymentState]) {
      assert.ok(email.html.includes(value), value);
      assert.ok(email.text.includes(value), value);
    }
    assert.ok(email.html.includes("not proof of payment"));
  });
  it("shows paid COD without instructing the customer to pay again", () => {
    const email = buildOrderReceiptEmail({ ...params, paymentStatus: "paid" });
    assert.ok(email.html.includes("Paid"));
    assert.ok(!email.html.includes("How to pay"));
  });
  it("keeps Woo-confirmed COD paid across email, page, PDF and WhatsApp without a local collection record", () => {
    // normalizeOrder projects Woo date_paid to this authoritative paid field.
    const wooOrder = { ...params, id: params.orderId, status: "completed", paymentStatus: "paid", codCollectionStatus: null };
    const page = buildCustomerReceipt({ ...wooOrder, paymentStatus: receiptOrderPaymentStatus(wooOrder) });
    const email = buildOrderReceiptEmail(wooOrder);
    assert.equal(page.paymentState, "Paid");
    assert.equal(page.codPaymentDue, false);
    for (const output of [email.html, email.text, customerReceiptHtml(page), customerReceiptText(page)]) {
      assert.ok(output.includes("Paid"));
      assert.ok(output.includes(page.serial));
      assert.ok(output.includes(page.total));
      assert.ok(!output.includes("Payment due on delivery"));
      assert.ok(!output.includes("How to pay"));
      assert.ok(!output.includes("not proof of payment"));
    }
    const unverified = { ...wooOrder, paymentStatus: "pending", paymentReference: "cod-internal-retry-key" };
    assert.equal(receiptOrderPaymentStatus(unverified), "pending");
  });
  it("never shows COD's internal retry key as a payment reference", () => {
    const email = buildOrderReceiptEmail({ ...params, paymentReference: "cod-internal-retry-key" });
    assert.ok(!email.html.includes("cod-internal-retry-key"));
    assert.ok(!email.text.includes("cod-internal-retry-key"));
  });
  it("escapes customer, item, address and promotion content", () => {
    const unsafe = '<img src=x onerror="alert(1)">';
    const email = buildOrderReceiptEmail({ ...params, firstName: unsafe, promoCode: unsafe,
      shippingAddress: { address1: unsafe }, lineItems: [{ name: unsafe, quantity: 1, total: "100" }] });
    assert.ok(!email.html.includes("<img"));
    assert.ok(email.html.includes("&lt;img"));
  });
  it("has fluid tables, inline wrapping, mobile padding and legible item text without style blocks", () => {
    const email = buildOrderReceiptEmail(params);
    const stripped = email.html.replace(/<style>[\s\S]*?<\/style>/g, "");
    assert.ok(!stripped.includes('width="600"'));
    assert.ok(stripped.includes("table-layout:fixed"));
    assert.ok(stripped.includes("overflow-wrap:anywhere"));
    assert.ok(stripped.includes("padding:24px 16px"));
    assert.ok(stripped.includes("font-size:14px"));
  });
});
