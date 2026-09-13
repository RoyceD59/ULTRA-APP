---
name: Woo customer identity
description: Security and account-continuity rules for WooCommerce-authenticated Companion customers.
---

WooCommerce-authenticated Companion customers must receive a database-backed customer identity. Repeat Woo logins reuse the same Woo-provisioned identity, while an existing password or social account keeps its own authentication rules.

**Why:** Customer-owned features such as rewards and QR access require a real customer row. A synthetic Woo principal can sign in successfully but is rejected immediately by those endpoints. Automatically claiming an existing password/social account by matching email alone would create an account-takeover risk.

**How to apply:** Prefer an existing Companion account only after its own credential check. Provision new Woo identities under an email-scoped transaction lock, store an unusable local-password sentinel, and require Woo authentication again on later logins.