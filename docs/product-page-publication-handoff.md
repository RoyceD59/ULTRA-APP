# Product-page publication handoff

## Current decision: no-go pending scoped prerequisite approval

The owner requested the new product pages across web and Expo. The existing
photo approval covers Sweet Home, Viva Drop and Gym Buddy only.

The production artifact builders still select the security-reviewed frozen
archive, not the current development sources. Anonymous checks confirmed that
the live browser loads build `1791820215559-828`, and both the custom API and
the registered production origin return 404 for `/api/uc/product-records`.

## Compatibility finding

A read-only comparison against the selected archive found that the merged
product-page feature is not a standalone screen replacement. It also adds
variant-aware cart persistence, API inputs, server-side pricing validation and
order-line metadata. The frozen archive predates those contracts.

An in-memory attempt to apply the original feature's reviewed changes found
unmatched predecessor contexts in the API product/checkout route, API startup,
client checkout and client API wrapper. The cart changes alone matched, but that
does not establish compatibility with the frozen server. No archive was
rewritten or selected by this check.

Copying the current product screen alone, or selecting the entire current
working tree, is not an acceptable repair. The former can mismatch variant/cart
contracts; the latter would include unrelated and unfinished functionality.

## Required scope decision

Prepare the matching product catalogue, SKU/stock/price validation, variant/cart
and additive order-line prerequisites together with the three approved pages.
Keep payment-provider and unfinished guest-payment changes excluded. Preserve
the predecessor archive, supported static releases and existing canonical/API
origins. Publication remains a separate user action.

After that scope is approved, the candidate must pass:

- Exact source/scope verification and dependency-security gates.
- API/shared/client typechecks against the candidate, not just development.
- Product-record, exact-SKU/variant, cart persistence and pricing tests.
- Compatible API and coordinated web/Android/iOS exports.
- Browser checks of the prepared product pages and checkout entry.
- Rollback retention and a single coordinated client activation boundary.

Only then can the release selection advance and a Publish action be offered.
After the user publishes, verify live API records, approved gallery slots,
browser bundle selection and both native manifests. Export evidence is not a
physical-device check or proof of live publication.

## Changes made during this investigation

No application source, secret, production database, release selector, DNS,
payment provider or deployment was changed. This document records the blocker
and proposed narrow scope; it is not completed release evidence.
