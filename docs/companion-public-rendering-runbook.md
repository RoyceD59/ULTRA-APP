# Companion public-rendering rollout

## Current state

Implementation is available but public rendering is **off by default**. No
deployment, canonical-host redirect change, production benchmark or customer
mutation has been performed. The supported Companion hostname already appears
in the existing browser/Cloudflare configuration; this work does not select or
change it.

## Configuration and owner approval

Before rollout, confirm the canonical Companion origin with the owner, then set
these non-secret production environment variables using the workspace environment
configuration:

- `PUBLIC_WEB_RENDERING_ENABLED=true`
- `PUBLIC_WEB_CANONICAL_ORIGIN`: approved HTTPS origin only, without a path,
  credentials, query or fragment.
- `PUBLIC_WEB_API_ORIGIN`: authoritative API HTTP(S) origin only, without a path,
  credentials, query or fragment. Public production delivery should use HTTPS.

Do not use forwarded Host headers or development domains as canonical origins.
`BASE_PATH` still controls upstream local navigation/asset paths, not canonicals.
The existing Cloudflare Companion routing removes the artifact prefix for public
browser URLs; no Worker changes are needed for crawler documents or the icon.
With the flag enabled, missing/invalid origin configuration fails startup
explicitly. No secrets are needed by the public data adapter.

The API catalogue must support `publicationSafe=true` and return
`X-UC-Catalogue-Provenance: woocommerce-published`. Product detail operations
require `X-UC-Catalogue-Provenance: woocommerce-live` and `Cache-Control: no-store`.
Missing WooCommerce
configuration returns 503/no-store in this mode. An old API or demo catalogue
without this provenance is rejected, never indexed. The ordinary interactive
app's fallback catalogue remains unchanged.

## Pre-release checks

1. Build with the artifact's complete production environment and cleared Metro
   cache. Retain the current deployment and build configuration.
2. Record revision, build ID and canonical hostname. Confirm `/version.json`
   identifies the same script version served in document HTML.
3. Fetch raw HTML for `/`, `/products`, an existing catalogue product, `/blog`,
   a published article, `/support`, a published guide, `/map`, `/about`,
   `/water-test` and `/enquiry`. Verify visible content, unique titles,
   descriptions, HTTPS canonical/social URLs, H1, links, lang and JSON-LD.
4. Check nonexistent product records, unresolved numeric aliases, article and
   guide URLs return 404. An operational outage leaves a known record readable
   with unknown stock; numeric identity lookup and API-backed article/guide
   outages return 503/no-store, not an indexable empty response.
5. Request `/robots.txt` and `/sitemap.xml` with HTML and non-HTML Accept.
   Validate XML/MIME/status, public-only inventory and absolute sitemap URL.
   Verify `/favicon.png` returns the brand PNG.
6. Validate schema against verified visible data. Eligible record-backed offers
   use the supplied KES price; availability comes only from a verified fresh read.
   Null-priced and enquiry-only records have no Offers. Missing photos do not
   produce logo-based product images.
7. Exercise signed-out and signed-in startup, login/register/invite, password
   recovery/change, product registration, cart quantities and totals, COD,
   M-Pesa, Paystack initiation/return/callback reconciliation, rewards/QR,
   orders, profile and ProjectHub synchronization without changing analytics.
8. Test actual iOS/Android manifests, startup/splash and deep links; test browser
   cold direct entries, back/forward navigation, slow/failed JS, public-to-private
   metadata changes, keyboard behavior, and both desktop/mobile layouts.
9. Capture an authorized production baseline and three cold-cache mobile/desktop
   runs per representative template. Report medians and variation. Historical
   Lighthouse values are not results for this implementation.

## Rollback

Set `PUBLIC_WEB_RENDERING_ENABLED=false` and restart/redeploy the previous known-
good renderer if content parity, native delivery, auth or payments regress.
No database migration is required. Keep the known-good deployment and its
configuration available.

New builds no longer delete versioned JS/font/image directories. The build helper
archives valid legacy root manifests beneath their referenced build ID, but
**never overwrites those live root manifests**. New native manifests are staged
exclusively inside the new release directory. Until activation, a legacy
no-pointer server therefore keeps both native platforms and the browser on the
old release, including if staging fails partway through. Completed builds atomically publish
`static-build/active-build.json` **last**, after all bundles, assets, build
metadata and per-build native manifests exist. Running servers re-read this
pointer, selecting the same release for HTML, `/version.json` and native
manifests while old assets remain fetchable. Partial builds do not activate.

Restore the matching old code/configuration and active build together. To select
a retained, completed build with this server, run the checked activation helper:

```sh
cd artifacts/uc-companion
node -e "require('./scripts/active-static-build.cjs').activateStaticBuild(process.cwd(), process.argv[1])" APPROVED_BUILD_ID
```

Legacy releases may lack per-build native bundles/manifests. For those, restore
the complete known-good deployment/configuration rather than bypassing the
activation checks. Do not mix HTML with a different build's script or release
metadata. Do not delete the active pointer to force an unverified newest scan.

Only retire old build directories after the rollback window and in-flight clients
are safe. Disk cleanup is an owner-controlled operation, not part of SEO rollout.
Purge only affected public caches; private/customer APIs must remain no-store.
Verify analytics and protected flows after rollback, not just the visible page.

## Local checks

From the workspace root:

```sh
pnpm run typecheck:libs
pnpm --filter @workspace/uc-companion run typecheck
pnpm --filter @workspace/api-server run typecheck
cd artifacts/uc-companion
node --test scripts/__tests__/public-rendering.test.mjs scripts/__tests__/serve-public.test.mjs scripts/__tests__/public-web-browser.test.mjs scripts/__tests__/serve.test.mjs scripts/__tests__/serve-deep-links.test.mjs scripts/__tests__/browser-entry.test.mjs
```

## Record-driven product delivery — prepared 2026-10-07, not activated

The v2.4 JSON collection and its supplied schema are the only authored product
source. They are tracked under `server/records/`; the HTML demo is not parsed.
Ajv compiles a standalone validator, so frozen servers still run after stage
dependencies are removed. Verify it with:

```sh
node artifacts/uc-companion/scripts/generate-product-validator.cjs --check
```

The server validates all 21 records, identities, media-slot declarations and
topic memberships before using them. Its allowlist omits internal sections,
snapshot stock, placeholders and `confirm` claims. SEO `proposed` markers are
retained; preparation does not change them to approved. All 21 publishable
records have stable `/product/{slug}` addresses. Numeric aliases require exact,
unique SKU identity; a similar name is not evidence. A child SKU requires an
explicit verified parent ID. Unresolved aliases return 404, never a substitute.
No commerce ID or transaction-time price is rewritten.

Hydra Flux uses H1 `Hydra Flux`, subline
`750 ml Insulated Water Filter Bottle`, record price `KES 4,199`, title
`Hydra Flux 750 ml Insulated Water Filter Bottle | Ultra Clear`, and the supplied
description. The visible FAQs and FAQPage share the same questions and answers.
The hot-liquid filter-removal warning is retained.

All nine `/topic/{slug}` routes provide titles and declared related-product
links only. Article sections remain empty, with `noindex, follow`; they are
excluded from the indexing sitemap. Topic article publication requires supplied
copy and explicit approval. Held-back products and abbreviated accessories do
not acquire pages, schema, topic links or sitemap entries.

### Operational diagnostics and media limits

The development read on 2026-10-07 found **11 exact parent-SKU matches and 10
unmatched records**. All 11 matched products reported live InStock and a price
disagreement. These are observations at that time, not promised future stock.
No provider or upload writes were performed.

| Record | Exact commerce ID | Photo slots reported | Outstanding diagnostic |
| --- | --- | --- | --- |
| HDF | 8054 | 1–6 | Record/commerce price disagreement |
| TRG | 8070 | 1–6 | Record/commerce price disagreement |
| VDR | 8043 | 1–6 | Record/commerce price disagreement |
| GMB | None | None | Unmatched SKU; missing photo evidence |
| SVS | 9365 | 1 | Price disagreement; photo slots 2–6 absent |
| ECO | None | None | Unmatched SKU; missing photo evidence |
| FCT | 8042 | 1–6 | Record/commerce price disagreement |
| DSP | 8147 | 1–6 | Record/commerce price disagreement |
| ROH | None | None | Unmatched SKU; missing photo evidence |
| PHR | None | None | Unmatched SKU; missing photo evidence |
| UPR | 8978 | 1–6 | Record/commerce price disagreement |
| UP2 | None | None | Unmatched SKU; missing photo evidence |
| AQD | None | None | Unmatched SKU; missing photo evidence |
| PSH | None | None | Unmatched SKU; missing photo evidence |
| SHJ | 8053 | 1–6 | Record/commerce price disagreement |
| SHC | 8049 | 1–6 | Record/commerce price disagreement |
| SHD | 8051 | 1–6 | Record/commerce price disagreement |
| SHP | 9055 | 1–6 | Record/commerce price disagreement |
| DFX | None | None | Unmatched SKU; missing photo evidence; enquiry only |
| ROC | None | None | Unmatched SKU; missing photo evidence |
| ATM | None | None | Unmatched SKU; missing photo evidence; enquiry only |

Read the existing upload interface first, preserving six positions and supplied
alt text; fill a vacant slot only with an actual resolvable WooCommerce photo.
Never shift slot 6 into slot 2 or use an authored filename, placeholder or logo
as a product photo. URL resolution and operational provenance are not evidence
of an owner's visual approval, actual image decoding or WhatsApp crawler access.
Those checks are required before activation.

Repeat the bounded, anonymous, read-only audit against the approved API origin:

```sh
node artifacts/uc-companion/scripts/audit-product-records.cjs APPROVED_API_ORIGIN /tmp/product-record-diagnostics.json
```

The report contains product identifiers, observed catalogue prices, live stock,
photo-slot numbers and diagnostic codes only. Catalogue prices are observations,
not overrides for the record page or checkout.

### Browser handoff and release prerequisites

Cold HTML is semantic and uses document scrolling at phone, tablet and desktop
widths. The current component mounts the same public body, then removes the
server copy. Record-route styling is removed on private navigation; native
numeric detail and ordinary shells keep their previous presentation. Old
compiled bundles must not replace these pages with WooCommerce wording: without
the record-ready marker, the readable server document stays in place.

When preparing an approved release, deploy the matching API, server sources,
record files, generated validator and new browser bundle together. Do not
silently enable the existing flag on an older bundle. Resolve identity/photo
gaps and obtain an explicit decision about price disagreements first. The page
price remains authored; the existing cart uses fresh operational pricing and
shows a discrepancy notice without changing payment/order logic.

Local evidence: 37 focused record/renderer/schema/server/deep-link tests, three
browser tests (including 390/768/1440-width raw and enhanced documents and the
actual record component/metadata hook), 27 additional server/browser-entry tests,
three isolated API provenance tests, shared library/Companion/API typechecks and
web, Android and iOS exports. Browser checks cover topic
navigation, keyboard FAQ expansion, one visible H1, document scrolling,
query-free canonicals and
checkout-shell metadata exclusion. No real order or payment was submitted.
These checks do **not** establish published delivery, physical-phone behavior,
Google Rich Results eligibility or WhatsApp previews. Metro's short screenshot
capture occurred before the development screen finished loading; it is not
evidence of the prepared renderer.

Existing complete release/flag rollback procedures above apply. Keep the old
code, API contract, records/validator and paired assets available; do not delete
retained builds. This task changes no activation flag, canonical host, Cloudflare
configuration, live release, WooCommerce record, payment or delivery setting.

The browser fixture requires workspace Chromium and `@playwright/test`; it runs
the actual browser metadata hook against isolated public API fixtures. It is not
a replacement for authenticated, physical-device or production checks.