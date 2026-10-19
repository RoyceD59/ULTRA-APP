---
name: Global impact consistency scope
description: Consistency applies to supported releases and shared totals, not personal data or historical assumptions.
---

Consistency work concerns supported Companion frontend releases and shared
global impact only. Personal impact, orders, rewards, hydration history,
permissions and customer history must stay account-specific. Do not change
impact formulas or purchase eligibility without separate approval.

**Why:** The user explicitly requested common releases/global figures while
excluding changes to customer-owned records and calculation rules.

**How to apply:** Compare snapshot identity and refresh evidence before
concluding that differences are account-dependent. Report source, packaged,
published, Expo Go and physical installed-binary evidence separately.
Production publication, native distribution and OTA activation need separate
approval; consistency source work does not authorize them.

Missing or malformed historical adjustment evidence is not permission to
reset adjustments to zero, including when an older API reported a zero
fallback.

**Why:** The requested migration must preserve historical values and never
overwrite newer shared adjustments.

**How to apply:** Require verified legacy input or explicit authorized
initialization. Preserve shared authority and audit history across rollout
and rollback.
