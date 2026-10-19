---
name: WooCommerce stock alert semantics
description: Correct low-stock alert behavior for WooCommerce managed and unmanaged products.
---

Only numeric WooCommerce stock quantities participate in low-stock threshold comparisons. A null quantity means stock management is disabled and must never be coerced to zero; an explicit `outofstock` status is still an actionable alert without a quantity.

**Why:** WooCommerce returns null for products that do not use quantity tracking, including ordinary in-stock products. Treating null as zero creates daily false out-of-stock incidents.

**How to apply:** Keep alert classification based on numeric quantity plus explicit stock status, and cover null/in-stock and null/out-of-stock behavior in scheduler tests.