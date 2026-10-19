---
name: WooCommerce catalogue pagination
description: Prevent silent truncation when resolving or locally filtering the live WooCommerce catalogue.
---

WooCommerce collection endpoints are paginated. Any category lookup or local
category fallback must retrieve all pages, with a finite safety bound that
returns an explicit failure if reached rather than showing a successful,
partial catalogue.

**Why:** Filtering only the first response page can hide matching products or
category records beyond that page while presenting an apparently valid empty or
incomplete result to the customer.

**How to apply:** Preserve complete paging whenever a store response is used
for customer-facing category resolution or filtering. Test at least one matching
record after the first WooCommerce page when altering this path.