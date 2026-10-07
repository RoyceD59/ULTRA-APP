import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerReceipt, customerReceiptHtml, customerReceiptText,
  receiptOrderPaymentStatus, orderReceiptSerial,
} from "../src/order-receipt.js";

const order = {
  id: 181, dateCreated: "2026-10-07T09:00:00Z", currency: "KES", total: "4100.50",
  paymentMethod: "cod", paymentStatus: "pending", discountAmount: 400, promoCode: "WATER10",
  lineItems: [{ name: "Hydra Flux", quantity: 2, total: "4000.50" }],
  shippingAddress: { firstName: "Test", lastName: "Customer", address1: "Test address",
    city: "Nairobi", fulfillment: "delivery", shippingAmount: "500" },
};

describe("private customer receipt", () => {
  it("uses saved totals without recomputing or charging shipping a second time", () => {
    const receipt = buildCustomerReceipt(order);
    assert.equal(receipt.total, "KES 4,100.5");
    assert.equal(receipt.shipping, "KES 500");
    assert.equal(receipt.discount, "KES 400");
    assert.equal(receipt.items[0]?.quantity, "2");
    assert.equal(receipt.serial, "UC-20261007-000181");
    assert.ok(customerReceiptHtml(receipt).includes("KES 4,100.5"));
    assert.ok(customerReceiptText(receipt).includes("Total: KES 4,100.5"));
  });

  it("keeps COD pending even if an operational status says processing", () => {
    assert.equal(receiptOrderPaymentStatus({ paymentMethod: "cod", status: "processing" }), "pending");
    assert.equal(receiptOrderPaymentStatus({ paymentMethod: "cod", status: "processing", paymentStatus: "paid" }), "paid");
    assert.equal(receiptOrderPaymentStatus({ paymentMethod: "cod", status: "completed", codCollectionStatus: "collected" }), "paid");
    assert.equal(receiptOrderPaymentStatus({ paymentMethod: "cod", status: "refunded", codCollectionStatus: "collected" }), "refunded");
    const receipt = buildCustomerReceipt(order);
    assert.equal(receipt.paymentState, "Payment pending");
    assert.ok(customerReceiptText(receipt).includes("not proof of payment"));
    assert.ok(customerReceiptHtml(receipt).includes("Payment due on delivery"));
  });

  it("does not treat a payment reference as proof of payment", () => {
    const receipt = buildCustomerReceipt({ ...order, paymentMethod: "mpesa", paymentReference: "TESTREF" });
    assert.equal(receipt.paymentState, "Payment pending");
    assert.equal(receipt.codPaymentDue, false);
  });
  it("preserves evidence-based statuses rather than inferring payment from fulfillment", () => {
    assert.equal(receiptOrderPaymentStatus({ paymentMethod: "mpesa", status: "completed" }), "unverified");
    assert.equal(receiptOrderPaymentStatus({ paymentMethod: "mpesa", status: "processing", paymentConfirmedAt: order.dateCreated }), "paid");
    assert.equal(receiptOrderPaymentStatus({ paymentMethod: "free", status: "processing", checkoutState: "confirmed" }), "no_payment_required");
    assert.equal(buildCustomerReceipt({ ...order, paymentMethod: "free", paymentStatus: "no_payment_required" }).paymentState, "No payment required");
    assert.equal(buildCustomerReceipt({ ...order, paymentMethod: "mpesa", paymentStatus: "unverified" }).paymentState, "Payment unverified");
  });

  it("shows paid and refunded without unpaid COD instructions", () => {
    for (const [paymentStatus, label] of [["paid", "Paid"], ["refunded", "Refunded"]]) {
      const receipt = buildCustomerReceipt({ ...order, paymentStatus });
      assert.equal(receipt.paymentState, label);
      assert.equal(receipt.codPaymentDue, false);
    }
  });

  it("uses the store order number and honors the already-issued serial", () => {
    const receipt = buildCustomerReceipt({ ...order, orderNumber: 9001, receiptSerial: "UC-20261006-009001" });
    assert.equal(receipt.orderNumber, "9001");
    assert.equal(receipt.serial, "UC-20261006-009001");
    assert.equal(orderReceiptSerial(9001, order.dateCreated), "UC-20261007-009001");
  });

  it("supports free collection, empty items, and unavailable amounts", () => {
    const receipt = buildCustomerReceipt({ ...order, total: "not-a-number", lineItems: [],
      shippingAddress: { fulfillment: "collection", shippingAmount: "0" } });
    assert.equal(receipt.fulfillment, "Free collection");
    assert.equal(receipt.total, "Amount unavailable");
    assert.equal(receipt.shipping, "KES 0");
    assert.ok(customerReceiptHtml(receipt).includes("No items listed"));
    assert.ok(!receipt.address.includes("Test address"));
  });

  it("escapes all customer fields in the isolated print document", () => {
    const injection = '<img src=x onerror="alert(1)">';
    const receipt = buildCustomerReceipt({ ...order, paymentReference: injection, promoCode: injection,
      lineItems: [{ name: injection, quantity: 1, total: "5" }],
      shippingAddress: { firstName: injection, address1: injection } });
    const html = customerReceiptHtml(receipt);
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("<script"));
    assert.ok(html.includes("&lt;img"));
    assert.ok(html.includes("overflow-wrap:anywhere"));
    assert.ok(customerReceiptText(receipt).includes(injection));
  });
});
