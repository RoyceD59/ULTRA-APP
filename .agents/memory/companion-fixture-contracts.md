---
name: Companion fixture contract drift
description: Distinguish stale test boundaries from production regressions without weakening fail-closed rules.
---

Public-page fixtures must supply both the authoritative editorial catalogue
and its detail responses, separately from operational catalogue data.
Extracted checkout handlers need an explicit, fresh account/recovery scope
alongside their provider boundaries.

**Why:** Stale WooCommerce-only fixtures and incomplete handler closures caused
many apparent product-publication and payment failures even though the current
code required newer boundaries. Changing production fallbacks to satisfy those
fixtures would have weakened publication and payment safety.

**How to apply:** Compare failing fixtures with the current API and closure
contracts first. Retain rejection tests for retired provenance, missing
authoritative editorial data, unresolved payments and account changes. When
two tests assert conflicting content, inspect the latest intentional source
change before restoring old customer-facing prose merely to pass a test.
