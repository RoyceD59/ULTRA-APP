---
name: Customer receipt delivery policy
description: Approved customer-facing receipt scope and payment-evidence distinction.
---

The user requested a final receipt delivered by email and shown on the order-confirmation page, usable for screenshots, WhatsApp sharing, and saving. They approved PDF saving and phone sharing, with unpaid orders clearly identified.

**Why:** A JSON order/export is not the customer-facing receipt the user wants, and confirming an order must not imply payment was received.

**How to apply:** Keep receipt values consistent across email, page, and exports. Treat a payment reference as a trace, never as independent proof of payment. Sharing is customer-initiated; do not introduce public receipt links or automatically send customer details to WhatsApp.

COD receipts must honor verified WooCommerce payment evidence even when no separate local collection record exists. A normalized paid state backed by Woo's paid date, a recorded payment-confirmation timestamp, or a collected status can establish payment; fulfillment status and retry references cannot.

**Why:** Requiring local collection tracking as the only evidence can make an already-paid Woo order ask the customer to pay again and make email and exported receipts disagree.

**How to apply:** Preserve the server's verified payment state across every receipt format, while continuing to show unpaid COD as payment due.
