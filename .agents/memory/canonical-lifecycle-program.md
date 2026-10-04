---
name: Canonical lifecycle program
description: Approved product rules for reconciling Ultra Clear customers, purchases, filter lifecycle history, and impact.
---

Use one server-owned canonical lifecycle model for authenticated customer identity, purchases, filter registrations, maintenance history, receipts, referrals, and impact. Companion and ProjectHub must read the same records.

**Why:** The user approved this approach to ensure old and new signed-in customers can register filters without creating competing order, receipt, history, or impact totals.

**How to apply:** Preserve current records through additive migration, shadow reconciliation, dual writes, and progressive rollout. Never reduce known maintenance history or let one physical purchase line create duplicate verified impact.

Identity resolution may normalize, lock, and classify candidates, but it must never authorize account reuse. Password, session, or provider proof stays in the trusted route boundary, and mixed active/deleted or cross-contact candidates fail closed.

**Why:** A caller-asserted proof label or a weak email/phone match can turn reconciliation into account takeover.

**How to apply:** Hold the shared email/phone advisory locks through create or link commit. Registration creates only when no candidate exists; authenticated/provider flows must independently bind proof to the selected customer.

Canonical purchase dual writes are default-off. When enabled, provider callbacks and order-status transitions must reconcile before acknowledging success or publishing customer/team events.

**Why:** Acknowledging first makes a failed shadow write impossible to heal reliably and can leave primary and canonical state permanently inconsistent.

**How to apply:** Reconcile in the primary transaction when possible. Duplicate and retry paths must heal the winning durable order. Retryable canonical conflicts must return non-success without transferring ownership.

Woo COD checkout keys are idempotency handles, not authorization credentials. One owner and one request may claim the remote Woo order attempt; followers never issue another Woo POST.

**Why:** Global key lookup can disclose another customer's order, while same-owner concurrent callers can otherwise create duplicate remote orders.

**How to apply:** Serialize claims with a transaction-scoped advisory lock, reject cross-owner reuse generically, distinguish creator from follower, and let only the creator contact WooCommerce.

Unmatched legacy purchases may be submitted, but they require ProjectHub staff review before activation and must not contribute to public impact while pending or rejected.

**Why:** This includes legitimate older customers while protecting global totals from unsupported or duplicate registrations.

**How to apply:** Make review decisions idempotent and audited, expose customer-visible status/reasons, and route ambiguous ownership to a reconciliation queue rather than guessing.

Nearby location tiers are calculated on the device at 0–2 km, then 2–5 km, then 5–10 km. Exact customer coordinates must not be persisted, logged, placed in URLs, sent to analytics, or sent to the location API.

**Why:** The user wants proximity-based results, while the approved design requires privacy-safe location handling.

**How to apply:** Fetch active verified location coordinates, calculate and sort locally, emit only coarse tier outcomes, and provide manual city/country search when permission is unavailable.

Staff fulfillment actions must preserve independently established payment classification. Shipping or readiness for collection never proves COD cash collection, and legacy paid status must not be replaced by a fabricated provider-confirmation timestamp.

**Why:** Legacy paid orders may have no confirmation timestamp. Reclassifying them as pending when shipping can reverse their Hydrate contributions, while inventing a timestamp would falsely strengthen receipt evidence.

**How to apply:** Preserve payment classification before replacing payment-bearing legacy statuses with fulfillment statuses. Map collection readiness explicitly in canonical fulfillment, and test legacy paid and uncollected COD orders with canonical dual writes enabled.