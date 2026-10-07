# Editable product pages — development verification, 2026-10-07

## Delivered boundaries

All 21 full v2.4 records use a persistent, revision-controlled editorial model.
Ordinary seed import never overwrites an existing edit. Public consumers receive an
allowlisted projection; internal notes, unapproved pictures and held-back
records do not become public content. Topic membership follows saved public
SEO topics reciprocally without generating educational article prose.

The owner's later instruction makes the uploaded Excel SKU file authoritative
over WooCommerce pricing. The CATALOGUE RETAIL extract initializes persistent
editorial prices once, by exact SKU, including Hydra Flux **KES 4,399** instead
of the earlier Markdown's KES 4,199. All 19 priced full records and each priced
child match that worksheet; two enquiry-only records remain unpriced. This
authorized one-time price import changes only price fields and increments
revisions, preserving other edits/media. Subsequent staff price edits survive
restart. WooCommerce remains authoritative for stock and verified identity;
its different reference price is reported, not silently synchronized or used
to charge the buyer. Cart lines, quotes, saved checkout rows and
WooCommerce fulfillment include verified variation identity. Legacy parent
carts remain readable but must select a verified child before purchasing
authored variable products.

Variant-bearing requests on the older no-fulfillment order branch explicitly
return an actionable 422 refresh-required response, including ordinary,
promotion and retry requests. They cannot create parent-only order anchors or
contact WooCommerce. Payment preparation also requires an explicit valid
delivery/collection choice for variant requests, before any money is requested.
Legacy simple-product and parent-cart reads are unchanged.

The existing upload, promotion, delivery, payment and checkout implementations
remain in use. Photo mapping migrates non-destructively at the first staff
read when real media exists. Explicit mapped removals do not resurrect old
uploads. Gallery metadata never deletes an underlying file. Product links
preserve the selected SKU; they do not let someone pay a saved buyer order.

## Automated evidence

- Editorial integration suite: **9/9 passed**, using a disposable isolated
  database and mocked WooCommerce, not real provider calls. Covers live admin
  revocation/authorization, initial seeding and repeat migration, CAS conflicts,
  edit/reseed round trips, schema/identity/unsafe-media/evidence rejection,
  public/private filtering, initial HTML/JSON-LD/SEO parity, price/stock and
  variation ambiguity, authoritative quote input/output, saved distinct child
  order lines, gallery gaps/reordering/removal, and unpublish/topic edits.
  Repeated legacy ordinary/promoted variant requests are HTTP-tested to reject
  without any outbound call or saved anchor/item; modern variant preparation
  retains both exact children.
- Related checkout, Paystack retry, orders CSV and Woo promoted-checkout suites:
  **63/63 passed** in the combined regression run. The new editorial saved-order
  test initially called a helper with the wrong return shape; corrected and
  included in the final editorial run. No production order/payment was executed.
- Spreadsheet verification: `python artifacts/uc-companion/scripts/verify-retail-prices.py`
  verifies all extracted prices and priced child identities against the uploaded
  workbook without importing cost data, stale stock or formula estimates.
- Companion cart persistence, selection/quote identity, sharing/analytics,
  record/schema/public rendering tests: **62 passing checks**, including approved-price
  mismatch handling. API/HTML/JSON-LD tests use the approved KES 4,399 price.
- Unpublished live parents with still-published children reject both quotes and
  payment preparation before creating an order. Summary amounts match exact
  child identity and quantity, including two variants of one parent.
- The library authorization suite passes **5/5** after removing a time-sensitive
  test expectation that regenerated a JWT solely to compare token strings.
- API, Companion and ProjectHub TypeScript checks passed.
- Available native check: Android Metro export succeeded. This is compilation
  evidence, not a physical-phone usability or payment test.

## Browser evidence — one integrated development pass

Staff checks used a synthetic browser admin session and in-memory intercepted
editorial responses. Opening Intro and SEO subline survived save/reload;
revision conflict feedback worked; all six semantic slots survived gaps and
reordering/removal. These browser fixtures do not prove database persistence;
the real isolated API suite supplies that separate evidence.

Customer checks used source-derived editorial records and explicitly synthetic
operational IDs/stock/prices. No fabricated product photography was supplied.
Two Hydra variants persisted as distinct cart lines. The browser found duplicate
parent React keys and missing checkout labels; the fix uses composite cart keys
and displays variant label/child SKU. Compilation passed and the later
comparison handoff visibly included Truva Grey's SKU. No payment was submitted.
Exact variant quote input/output and saved rows are separately API-tested.

Comparison defaults Hydra to Truva (both 750 ml), supports Viva and Gym,
omits unavailable rows and provides selected-child View/Buy handoffs. Copy
produced a plain, explicitly non-payment product link; decoding intercepted
WhatsApp text once retained the SKU; the copied URL restored Green selection.
No WhatsApp message was sent. Unknown stock, then-unapproved price mismatch and out-of-stock
states blocked purchase; stock-out offered restock/wishlist and disabled
sharing. Water ATM opened its enquiry form without submission.

Browser snapshots predate the owner's Excel-pricing clarification. The subsequent
approved-price behavior is verified by API/shared purchase-state and HTML/schema
tests, not a second browser pass or physical-phone test.

At **390, 430, 768 and 1280 px**, product and open comparison document/body
widths equalled viewport widths: no horizontal overflow. Phone controls wrapped
within the two comparison columns. Screenshots are attached to the browser
check results; intercepted states are fixture evidence only.

The no-intercept Hydra preview also loaded: KES 4,199 authored price, no real
gallery photos returned, no verified child variation mapping, and a
record-versus-commerce price disagreement. The page stayed honestly unavailable.
Other live mappings/media have not been certified; no name-based match, stock
estimate or replacement photography was used to bypass missing evidence.

## Analytics configuration

Existing approved Umami events remain independent. Google product analytics is
web-only and opt-in through an explicit adapter or both
`EXPO_PUBLIC_PRODUCT_GA_ENABLED=true` and a valid
`EXPO_PUBLIC_PRODUCT_GA_MEASUREMENT_ID` plus an existing explicitly installed
`gtag`. This work neither sets those flags nor injects a Google collector.
Allowed payloads contain product/SKU/quantity and bounded commerce values, not
contacts, addresses, URLs, tokens or arbitrary metadata. Purchase events require
verified paid status and a deduplicated transaction ID. Saved order creation is
not purchase evidence. Pay-link events are not fabricated for interim sharing.
No external Google ingestion was asserted.

Native product sharing requires an explicitly configured validated
`EXPO_PUBLIC_SHARE_ORIGIN`; missing configuration fails clearly instead of
guessing a published host. Browser links use the actual current origin/base.
Attribution and selection query parameters are excluded from canonicals.

## Rollout and rollback

The tracked migration and idempotent API startup DDL support fresh/existing DBs,
including `gallery_mapped`, `price_import_revision` and optional order-line variation columns. Build
output includes the canonical schema/validator/seed contract so production
runtime never depends on a source checkout. Any later release must retain
editorial rows and variation columns; do not drop them or reseed over edits.
Rollback needs a compatible consumer/backend or a checkpoint restoring the
matching database and application together. Back up editorial records first;
never treat removing a photo slot as deleting secure storage.

No production deployment, hosting/Cloudflare changes, activation flags, tariffs
or payment/provider configuration changes were made. Physical iOS/Android,
public Rich Results, real WhatsApp previews/messages, external Google ingestion,
actual child mappings/media approval and real payment execution remain
**unverified**. Saved buyer-order anonymous payment remains the separately
planned dependent feature, not an implemented capability of these product links.
