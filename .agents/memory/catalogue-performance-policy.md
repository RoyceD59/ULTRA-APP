---
name: Catalogue performance boundaries
description: Why public browsing acceleration must remain separate from commerce authority and release evidence.
---

Optimize public catalogue browsing separately from transaction-time price and
stock verification. A browsing snapshot is not authority for an order.

**Why:** The approved speed plan requires complete catalogue results and verified
transaction inputs; shortening a wait must not silently substitute an old price,
stock state, partial list or demonstration data on provider failure.

The owner requests that Companion supersede WooCommerce development:
disconnect WooCommerce from Companion and adapt the ProjectHub product schema
to Companion's new schema. Product ownership must be shared between Companion
and ProjectHub, not split between an app-owned catalogue and WooCommerce
purchase eligibility.

**Why:** The owner explicitly instructed this after WooCommerce purchase
eligibility blocked Companion checkout.

**How to apply:** Use this as the migration requirement, not evidence that the
existing implementation or published app has already been disconnected.
Preserve verified identity, stock and transaction checks under the shared
app-owned authority rather than merely bypassing a failed WooCommerce check.

The owner's Excel SKU file supersedes WooCommerce pricing. Use its CATALOGUE
RETAIL values to initialize persistent product prices; future authorized editor
changes remain persistent. Do not overwrite WooCommerce prices implicitly.

**Why:** The owner explicitly stated, “THE PRICING SHOULD BE THE EXCEL FILE
ADDED. iT SUPERCEDE woocommerce.”

**How to apply:** Keep caches finite and failure-explicit, invalidate after
successful staff changes, and preserve transaction-time verification. Local
cache benchmarks and compressed-size estimates are not deployed or
physical-phone improvement evidence; evaluate those separately with release
approval.