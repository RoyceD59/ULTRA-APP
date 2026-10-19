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

The owner subsequently selected complete WooCommerce disconnection, including
replacement of Woo-backed customer authentication and historical order syncing,
rather than the products/new-orders-only option.

**Why:** The owner explicitly instructed this after WooCommerce purchase
eligibility blocked Companion checkout, and explicitly chose complete
disconnection on 2026-10-10.

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

Replace retired WooCommerce success-path tests with explicit disconnection
checks while preserving supported app-owned coverage.

**Why:** The owner explicitly selected “Replace retired tests; preserve
app-owned coverage” after learning that old tests required remote order
creation, webhook ingestion and inventory writeback to succeed.

**How to apply:** Do not reconnect WooCommerce or skip failing checks to make
validation pass. Keep current local payment, receipt, ownership and recovery
contracts tested; use no-contact/no-write checks for retired entry points.