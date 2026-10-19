---
name: Recovery order enrichment
description: Distinguish staff-confirmed dispatch details from customer ownership, payment and notification actions.
---

Staff enrichment confirms items and shipping for internal dispatch. It is not proof of authenticated customer ownership, a new payment, or permission to send a customer delivery notification. Retain recovery provenance for team traceability.

**Why:** A recovered payment may still identify the customer by email rather than a verified account, and internal dispatch preparation must not silently reassign purchases or claim money was collected.

**How to apply:** Keep account linking, payment collection/refunds, and customer-facing delivery updates in their separately authorized flows when extending recovery tooling.

Refreshing the exact same unresolved canonical source is not a new ownership claim; unresolved identity must still fail closed when adopting a different source purchase. Internal dispatch must preserve prior payment classification, including unpaid COD, rather than deriving payment from its new fulfilment label.

**Why:** Recovery payments can already have a canonical purchase with no account owner, and legacy paid orders may have no payment-confirmation timestamp. Treating every unresolved refresh as a collision blocks enrichment; treating dispatch as payment evidence misclassifies those orders.

**How to apply:** Cover preexisting unresolved recovery projections with canonical dual writes enabled, and preserve payment evidence when introducing internal fulfilment statuses.