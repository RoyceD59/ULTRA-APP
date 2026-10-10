---
name: Woo customer identity
description: Security and account-continuity rules for WooCommerce-authenticated Companion customers.
---

While a release still supports WooCommerce authentication, its Companion
customers must receive a database-backed customer identity. Repeat Woo logins
reuse that identity; an existing password or social account keeps its own
authentication rules.

**Why:** Customer-owned features such as rewards and QR access require a real customer row. A synthetic Woo principal can sign in successfully but is rejected immediately by those endpoints. Automatically claiming an existing password/social account by matching email alone would create an account-takeover risk.

**How to apply:** Prefer an existing Companion account only after its own credential check. Provision new Woo identities under an email-scoped transaction lock, store an unusable local-password sentinel, and require Woo authentication again on later logins.

The owner has selected complete WooCommerce disconnection, including customer
authentication and historical order syncing. Migrate these identities without
relinking by email alone or losing their customer-owned records; do not treat
the historical Woo-login rule as a permanent product requirement.

**Why:** The owner explicitly selected complete disconnection on 2026-10-10.

**How to apply:** Preserve the account-continuity protections during migration.
Do not claim that legacy sentinel-password accounts can already authenticate
locally or that source changes alone prove migration/publication.