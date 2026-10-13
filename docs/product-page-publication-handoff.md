# Product-page publication handoff

## Latest selected restoration — 13 October 2026

The selected candidate is now
`34478f5c5d1d91f49575aa902f45e30e1f79e52325f9a4fc8dcf92fe5731caf8`,
restoring the supplied HTML's layered presentation to the shared web/native
page. The previous sections below describe the preceding preparation history.

This candidate passed frozen API/Hub/Companion builds, shared and consumer
typechecks, web/Android/iOS exports and exact source/scope verification.
Build `1791912473158-25878` is a local verification build, **not publication
evidence**. The manifest includes `productPageStructure.version` =
`layered-product-pages-1`, the reference SHA, layers, groups, categories and
the unchanged three-product photo scope. The production preparer rejects a
client whose compiled structure manifest differs from the selected source.

The manifest also declares `videoSlotsPerProduct: 2`. In ProjectHub, open
**Products → a product → Product images & installation video** and use
**Upload video 1** or **Upload video 2**. Each MP4 can be up to 60 MB;
H.264/AAC is recommended. Remove only the selected clip before replacing it.
Both clips are shown alongside the images in the web and Expo galleries.
Backend slot claims are serialized; concurrent requests cannot overwrite a
slot or attach a third clip. Legacy attachments are mapped without rewriting
or deleting their rows. Real-clip upload and physical-phone playback remain
unverified; no clips were uploaded to customer products by this preparation.

After the owner publishes, verify the actual served `version.json` revision
and structure marker, the 21 public records, gallery loading and category
filtering, and the corresponding Expo Go release. Do not infer publication
from these local exports. Standalone installed binaries need their own
release; physical-phone and payment-provider checks are still unconfirmed.
The 11 editorial drafts, including replacement pages, stay private pending
staff review. Replacement navigation only exposes public records.

## Current decision: product-page release selected and prepared; not published

The main-workspace build selector now uses this candidate for the API,
ProjectHub and Companion. The production-preparation Companion build passed
with the currently served client retained as rollback, including all 56
referenced asset URLs and checksum evidence for 60 captured files. No rollback
gate was removed. A missing current rollback is captured from the live host
during build rather than replaced with an unrelated historical build.

Republication does not copy mutable reports into fixed client-asset paths.
Only the verified release tree is retained; capture observations are stored
additively by content hash. Repeated timestamps cannot collide, while missing
assets or different client bytes still block publication. This was checked
against an existing output and by rerunning the production-preparation build.

The development API routing helper now keeps Replit previews on the development
API. Sweet Home's mobile gallery and Gym Buddy's desktop gallery/specifications
rendered in screenshots. Viva Drop's screenshot captured initial loading; its
record and five images passed separate HTTP checks. Screenshots are not tests
of clicking options, checkout or a physical phone.

Production schema comparison reports no changes. Product-page source selection,
stage adoption and existing security/session/media fixtures pass. ProjectHub
also typechecks and builds against the exact selected archive.

Publication is still a user action. After publication, check all three pages,
their galleries/options and API/web/Expo release identity. A real phone check
is still needed; unrelated payment sandbox verification remains separate.

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
  `a1fe3ebfc306ba0bff912d2620be0065965d25b89e38cd2f50f1a08a87c3fbc7`
- Review directory: `infra/cloudflare/forest/product-page-review/`.
- Source manifest: 68 changed/added paths, 1,310 total regular source files.
- The dependency lockfile remained identical to the frozen parent.
- The existing frozen-source handoff verification passed.
- Candidate shared-library compilation passed.
- Candidate API and Companion typechecks now pass.
- The candidate server and API-build JavaScript syntax checks passed.

Earlier blockers included promotion-quote signatures, receipt import collisions,
payment-verification exports/result fields, a catalogue-cache caller contract,
fulfillment transitions, missing generated client models, cart fields and
shared client/session/QR caller signatures. These were reconciled. Only commerce
methods now advance in the shared API hook; retained customer, session and
rewards-QR methods keep their frozen contracts. Checkout quote/cancel/recovery
routes include the route-array definition, not just single-string route calls.

The latest product presentation was included in the review source; the unfinished
Ask-to-Pay action was removed there. Native sharing uses the existing native
Share API, avoiding a new native clipboard dependency. Four isolated regression
tests pass for approved galleries/identities, owned SKU/stock/price quotes,
recovery guards and variant cart persistence. No providers are called.

API/web/Android/iOS release builds have completed. Installed dependency backports
passed seven attack/ordinary-behaviour fixtures. All fifteen approved image URLs
returned HTTP 200 with image content types from the live image service.

Packaging verification caught and fixed an asynchronous output-copy race:
authored API records are copied only after the build finishes clearing `dist`.
The cold web server now includes its shared CommonJS helper and matching route
classifier. Local HTTP checks serve all three approved public HTML pages against
real development API records and return the matching native manifest.

Browser checkout, physical-device and coordinated rollback/activation checks
remain unverified. A development screenshot showed only the loading state,
which is not evidence of a rendered candidate page or working galleries.

## Production boundary

The release selector and development-only preview API routing were updated.
No secret, production database, DNS, provider setting or deployment was changed.
No payment-provider requests were made for this preparation.

The existing stage was adopted only after every archived source byte/mode and
installed backports were verified. Extra executable source is rejected; only
the exact standard Expo-generated declaration template is allowed.
Preserve the previous archive and rollback releases. The next step is the
user's Publish action and post-publication verification. Live stock initialization
requires its separately explicit, authorized stock-import procedure; preparing
source is not an inventory write or evidence of production availability.
