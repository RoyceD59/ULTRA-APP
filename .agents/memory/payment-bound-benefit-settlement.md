---
name: Payment-bound benefit settlement
description: Durable rule for issuing rewards or discounts after external payment confirmation.
---

Payment-confirmed benefits must use a durable settlement record and an idempotent processor. A periodic reconciliation scan must also discover confirmed eligible orders missing settlement records.

**Why:** Even an awaited post-confirmation call leaves a crash window between committing the paid order and creating the follow-up work. Provider callbacks may also acknowledge errors rather than retry.

**How to apply:** For any new payment-triggered benefit, enqueue in the payment transaction when practical, make processing idempotent, and retain a scan that repairs missing handoffs from authoritative paid-order state.