---
name: Woo-backed Companion identities
description: Identity rule for giving WooCommerce-authenticated customers durable Companion data safely.
---

WooCommerce-authenticated customers that need Companion-owned data must receive a dedicated local customer identity marked with explicit WooCommerce provenance. Reuse only a local identity already marked with that provenance. Never attach an existing password or social account solely because its email matches.

**Why:** Woo-only principals intentionally occupy a non-database ID range to prevent privilege and ownership confusion, while rewards, QR tokens, devices, and impact records require a database-backed customer. Email-only linking could hand an unrelated local account to a Woo identity.

**How to apply:** For customer features requiring database ownership, provision or resolve the Woo-provenance identity under a normalized-email lock. Treat a same-email password/social row as a conflict requiring an explicit recovery flow, not an automatic link.