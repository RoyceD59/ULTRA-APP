# Product-page publication handoff

## Current decision: no-go pending candidate compatibility fixes

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

## Approved prerequisite scope

On 13 October 2026 the owner approved including the catalogue, pricing,
SKU/stock and variant-cart prerequisites. That approval is recorded; it is
not necessary to ask the same scope question again.

Prepare the matching product catalogue, SKU/stock/price validation, variant/cart
and additive order-line prerequisites together with the three approved pages.
Keep payment-provider and unfinished guest-payment changes excluded. Preserve
the predecessor archive, supported static releases and existing canonical/API
origins. Publication remains a separate user action.

Before selecting the approved-scope candidate, it must pass:

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

## Prepared review candidate — not a release

A deterministic source-review archive was prepared separately from the selected
archive. Its parent is the unchanged security-reviewed frozen package.

- Candidate SHA-256:
  `c1318f524643fe92bf2fd97ea5b6d52480bf366b2807f080bc7d44391489b85f`
- Review directory: `infra/cloudflare/forest/product-page-review/`.
- Source manifest: 62 changed/added paths, 1,308 total regular source files.
- The dependency lockfile remained identical to the frozen parent.
- The existing frozen-source handoff verification passed.
- Candidate shared-library compilation passed.
- Candidate API and Companion typechecks **failed**.
- The candidate server and API-build JavaScript syntax checks passed.

Remaining blockers include promotion-quote signatures, receipt import collisions,
payment-verification exports/result fields, a catalogue-cache caller contract,
fulfillment transitions, missing generated client models, cart fields and
shared client/session/QR caller signatures. The broad shared API-hook replacement
also pulled in unrelated client contracts; that must be narrowed or explicitly
reconciled rather than considered successful merely because the files copy.

The latest product presentation was included in the review source; the unfinished
Ask-to-Pay action was removed there. Native sharing uses the existing native
Share API, avoiding a new native clipboard dependency. These candidate edits
have not passed application validation or been activated.

No API/web/Android/iOS release exports or end-to-end checks have been completed
for this candidate. A development screenshot showed only the loading state,
which is not evidence of a rendered candidate page or working galleries.

## Production boundary

No running application source, secret, production database, release selector,
DNS, provider setting or deployment was changed. No payment-provider requests
were made for this preparation. There is no Publish-ready release.

Do not select this review archive or create its prepared-stage marker while
these checks fail. Preserve the previous archive and rollback releases. The
next step is to reconcile the shared contracts while keeping unrelated and
unfinished functionality out, then run the gates above. Live stock initialization
requires its separately explicit, authorized stock-import procedure; preparing
source is not an inventory write or evidence of production availability.
