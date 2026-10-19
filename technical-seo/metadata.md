# Public HTML and structured data

## Scope and verified identity

The Companion's opt-in public renderer emits content and JSON-LD from the same
unauthenticated API response, before JavaScript runs. Canonical URLs and stable
entity IDs use the renderer's explicitly approved HTTPS origin, not Host headers
or development defaults. The established production browser entry uses
`https://app.ucfilters.com`; these changes do not activate a renderer or alter that
host configuration. Brand identity is limited to Ultra Clear, its existing
`https://ucfilters.com/` website, and the Companion site name. No unverified
addresses, certifications, contact details, authors or reviews are asserted.

The schema models extend the shared public-rendering layer, preserving its
metadata, sitemap, robots, error-status and crawlability behavior. It does not
render private accounts, reviews, checkout or customer data. The existing visible
location listing remains available without asserting unverified LocalBusiness
entities.

## Schema and parity rules

- Organization and WebSite share stable entity IDs throughout public documents.
- Product uses membership in the public catalogue, fetched with
  `publicationSafe=true` and requiring `X-UC-Catalogue-Provenance:
  woocommerce-published`. The API verifies published status before attesting a
  safe catalogue. Detail endpoint fallbacks are not indexing sources. Demo
  fallback, private/draft records and unverified payloads do not generate schema.
  Deploy the corresponding API change before enabling the Companion renderer.
  Ordinary detail reads retain their `X-UC-Product-Source` provenance signal.
- Product descriptions, SKU and images are taken from public product fields.
  Offer price follows the app's sale/price/regular-price precedence. KES is the
  app's existing visible sale currency. Quote-only or invalid/missing-price
  products receive no Offer. Only explicit in-stock/out-of-stock values are
  mapped to availability, and the same facts are displayed in the initial HTML.
  No aggregate rating or stock quantity is emitted.
- Published blog snapshots supply BlogPosting title, summary, body and actual
  available publication date. Editor identity and edit timestamps are not
  authors or modification dates.
- HowTo requires nonempty source steps. Sections and their images retain their
  source grouping/order; unrelated images are not assigned to individual steps.
  Guide read time is not an instruction duration. No invented costs, supplies,
  tools, authors or dates are added. Video remains visible with source media.
- Listings describe only the entries actually rendered in that fetched page.
  Breadcrumb schema matches the visible navigation names and canonical links.
- No FAQPage without visible Q&A; no LocalBusiness without human verification.
  Structured data does not guarantee any Google rich-result display.

## Runtime limitations

The static production server fetches only allowlisted public API routes, with no
incoming cookies, credentials, search parameters or user context. Requests time
out after eight seconds. On missing/unverified/unavailable content it preserves
the interactive app bundle, emits a real 404 or 503 document, omits schema and
sends `X-Robots-Tag: noindex, follow`; it does not manufacture content from
bundled/offline fallbacks. Healthy public
responses use no-store, so requests recover without persisting outage metadata.
The regular Expo client still fetches and refreshes its own data after mounting.
Source content can consequently change between the initial response and a later
client refresh; no stale server cache is introduced.

The readable public document is removed only when the interactive app mounts.
The shared web metadata hook removes stale schema immediately on navigation and
fetches fresh public metadata/schema, with private routes retaining noindex and
no public entity data. Full document requests always emit initial schemas without
requiring that hook. The Metro development workflow does not use
`server/serve.js`, so validate initial HTML against a production-server fixture,
not the development shell. Enabled public rendering remains readable without a
web bundle; flag-off operation retains the existing landing-page fallback.
Atomic active-build pointers, retained assets and native manifests are unchanged.

The production release runner currently uses a frozen source archive. Reconcile
and regenerate that release package through the existing release process before
publishing these source changes. No live deployment or archive replacement is
performed by this task.

## Regression and rollback sequence

1. Run the schema model, escaping, route parity, SPA cleanup and production-server
   tests. Parse JSON-LD directly from HTTP response text without executing JS.
2. Run API provenance tests in the isolated test database and both API and
   Companion typechecks. Run the existing Companion suite for deep links,
   manifests, bundle replacement and interaction logic.
3. In an approved release environment, inspect a live product, quote-only product,
   published article, stepped guide and informational guide. Compare populated
   properties with their public payloads and rendered text; test API failure and
   private routes. Validate syntax with Schema.org Validator and eligible types
   with Google's Rich Results Test without promising rich-result inclusion.
4. Confirm browser cart, enquiry, wishlist, reviews, guide accordion/feedback/
   media and source links still use the unchanged interactive screens. Check
   native manifest/asset routes and the custom-domain browser entry.
5. If release checks fail, restore the previous approved release/checkpoint rather
   than modifying live data. Deploy the API provenance header first; reverting
   it causes the new public renderer to fail closed for products. Restore the
   Companion server and shared web metadata hook together when rolling back the renderer.

Local automated checks do not constitute production publishing approval or
signed-in/physical-device interaction verification.