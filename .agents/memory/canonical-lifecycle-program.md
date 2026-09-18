---
name: Canonical lifecycle program
description: Approved product rules for reconciling Ultra Clear customers, purchases, filter lifecycle history, and impact.
---

Use one server-owned canonical lifecycle model for authenticated customer identity, purchases, filter registrations, maintenance history, receipts, referrals, and impact. Companion and ProjectHub must read the same records.

**Why:** The user approved this approach to ensure old and new signed-in customers can register filters without creating competing order, receipt, history, or impact totals.

**How to apply:** Preserve current records through additive migration, shadow reconciliation, dual writes, and progressive rollout. Never reduce known maintenance history or let one physical purchase line create duplicate verified impact.

Unmatched legacy purchases may be submitted, but they require ProjectHub staff review before activation and must not contribute to public impact while pending or rejected.

**Why:** This includes legitimate older customers while protecting global totals from unsupported or duplicate registrations.

**How to apply:** Make review decisions idempotent and audited, expose customer-visible status/reasons, and route ambiguous ownership to a reconciliation queue rather than guessing.

Nearby location tiers are calculated on the device at 0–2 km, then 2–5 km, then 5–10 km. Exact customer coordinates must not be persisted, logged, placed in URLs, sent to analytics, or sent to the location API.

**Why:** The user wants proximity-based results, while the approved design requires privacy-safe location handling.

**How to apply:** Fetch active verified location coordinates, calculate and sort locally, emit only coarse tier outcomes, and provide manual city/country search when permission is unavailable.