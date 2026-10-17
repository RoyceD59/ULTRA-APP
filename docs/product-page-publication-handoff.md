# Product-page publication handoff

## 18 October 2026 — Companion test blocker cleared

The earlier **935 passed / 52 failed** result below is historical. After
repairing fixture/API-contract drift, stale assertions, two API import paths
and the optional-field accessible name, the full Companion suite reports
**990 passed, 0 failed, 0 skipped**. Shared-library and Companion typechecks
also passed. Payment safeguards and publication provenance checks remain
enforced; providers were simulated rather than contacted.

The Products development preview rendered after Metro settled, with no
browser page errors. Physical iOS/Android checks, the separate API/Expo Doctor
gates and selected frozen-release validation remain separate. No publication
or release-package change was made by this repair.

## 18 October 2026 — Products slideshow implemented in main source

The Products header now uses locally bundled shower, household and bottles
artwork, in the owner's specified left/middle/third mapping, cycling every
three seconds. Poster headlines and promotional footers are excluded; product
photography remains intact. The icon-only cart overlay, search, category chips,
Alison welcome and Home/Blog headers are preserved.

The slideshow waits for all three images before cycling, pauses when the shared
motion/focus/visibility policy disallows animation, and returns to the first
still frame when paused. This source work does not change product-detail pages,
the selected frozen package, release approval, or live activation.

Evidence: Companion typecheck passed. The full Companion suite completed with
987 tests: 935 passed and 52 failed outside the banner checks. Banner/loading
checks passed. Chromium verified all three images decode; 390/820/1440 layouts
had no horizontal overflow; cycling, reduced-motion reset and tab navigation
were exercised. No physical iOS/Android test was performed.

**Publication remains separate:** include these source/assets in the next
reviewed frozen candidate, preserve rollback assets, and revalidate the release
gates. Do not claim that the current selected package or live build contains
this banner merely because it now exists on main.

## Current preparation — catalogue image directory fix

Selected source:
`41d38f627258152d7cc7132b275f7c495e44e1ca1503391a165efed316e5212a`.
Local build: `1791957255767-6680`. **NOT PUBLISHED.**

The published API returned 404 for catalogue JPEGs with both browser and
native-style user agents. These files exist in the approved archive. Original
serving and derivative generation both used `process.cwd()/public/products`.
They now share a source/bundle-relative directory resolver. A missing packaged
directory fails explicitly at startup instead of silently publishing broken
image routes. No database schema, identity or payment behaviour changed.

The focused regression verifies JPEG originals, WebP derivatives and genuine
missing-file 404s while the process is outside the API directory. API/Hub builds,
all three Companion platform exports and exact stage verification passed.
A browser screenshot confirms that the development JPEG is served and decoded.

The live version endpoint now identifies the preceding source `59f5a238…`;
that archive is the published predecessor. This new fix has not been activated.
Uploaded gallery photos for Sweet Home, Viva Drop and Gym Buddy already return
200 image/jpeg at the published API; those responses alone do not establish
that the user's phone renders them.

**NO-GO for declaring the whole request complete:** the owner still reports
missing photos and failing iOS ratings. The exact photo screen and rating
failure step are needed; no matching failed rating submission was identified
in the available logs. Broad API tests and Expo Doctor are not green.

## Current preparation — photo names, native image path and rating feedback

Selected source:
`59f5a2386f58ede1500d56de7129b8e40b6a667e536a50c72927654f4552fa7c`.
Local build: `1791922548096-6587`. **NOT PUBLISHED.**

ProjectHub now includes the authored record editor in the frozen package,
including editable photo display names and whole-record gallery ordering.
Stored filenames/URLs and accessibility descriptions are not renamed.
The public JSON, initial HTML and shared web/native gallery expose those names.
The existing two video slots remain available.

API, Hub and all three Companion platform builds/typechecks passed, along with
exact stage/scope verification, photo-order round-trip checks, name validation
and projection checks, and native original-image/measured-frame unit checks.
The attempted targeted API integration command ignored its filename argument
and ran the full suite; it timed out with failures. It is not passing evidence.

The owner confirmed that Android opens, but the previous phone preview still
had missing photos on both platforms and failing iOS ratings. The new native
original-image path, measured frames, bounded loading and rating failure
feedback require phone verification. Do not call these native issues resolved
or claim all release checks pass. The compiled package is preparation only.

The actual published predecessor remains `34478f5c…`; unpublished candidates
are not rollback publication evidence.

## Latest selected restoration — 13 October 2026

The selected candidate is now
`c49a560276fd7114eff73fdaa44e09f47c467265e260411bcdf944a1f32ad9ad`,
restoring the supplied HTML's layered presentation to the shared web/native
page. The previous sections below describe the preceding preparation history.

This candidate passed frozen API/Hub/Companion builds, shared and consumer
typechecks, web/Android/iOS exports and exact source/scope verification.
Build `1791918978635-32131` is a local verification build, **not publication
evidence**. The manifest includes `productPageStructure.version` =
`layered-product-pages-1`, the reference SHA, layers, groups, categories and
the unchanged three-product photo scope. The production preparer rejects a
client whose compiled structure manifest differs from the selected source.

This candidate also releases the fallback layout when the interactive product
page mounts, repairs navigation in partially published groups and adds restock
request feedback with sign-in return routing. The gallery has explicit image
bounds and original-byte fallback. Actual Expo device image failure is not yet
identified; builds alone do not prove phone playback or image delivery.

The Android screenshot identified a separate startup exception: eager remote
push imports in Expo Go. This package uses local-only notification imports and
loads remote registration only where supported. Local reminders remain intact.
After publication, close the old Expo Go session and open the updated manifest;
then check Android startup and the approved iPhone photo galleries.

Chrome reproduction confirmed a zero-height product container in the published
predecessor. This candidate completes handoff before paint and preserves
fallback content until mounting. Native ATM/vendor rating corrections include
boolean optional-text guards, marker event isolation and non-blocking haptics.
Phone image delivery and actual native rating submission remain verification
steps after activating this package; do not count browser fixtures as native
device passes.

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
