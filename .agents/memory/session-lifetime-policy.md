---
name: Customer session lifetime policy
description: Security rollout decision for bounded customer sessions and legacy tokens.
---

Customer sessions have an eight-hour lifetime, matching the existing team
session duration. Reject legacy tokens with no expiry rather than grandfathering
them indefinitely. Do not introduce refresh or logout infrastructure solely for
this hardening.

**Why:** Indefinitely valid stolen customer bearers must stop working. A default
at the shared issuer covers password, WooCommerce, social and replacement
sessions without a new authentication flow. Legacy tokens have no trustworthy
issue time from which to calculate a safe remaining lifetime.

**How to apply:** Keep issuance and verification fail-closed. Explain the
one-time sign-in requirement when publishing this change; do not describe
development verification as a production rollout.
