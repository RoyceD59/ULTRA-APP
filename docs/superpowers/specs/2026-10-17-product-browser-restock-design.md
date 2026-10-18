# Product browser reliability, navigation and restock requests

## Scope and confirmed decision

Repair the existing Companion product experience across web and Expo and prepare
the same changes for its selected publication package. Do not replace the
owner's layered product design with a generic shop page.

The owner selected **pending restock requests linked to the customer and
product**, not unpaid orders. Guests become prospects, not customer accounts.
Requests do not charge anyone, reserve inventory, affect sales totals or imply
that a notification has been delivered.

Layout reference: `attached_assets/Ultra_Clear_Product_Pages_1791907263959.html`.
Published product records remain the authority for product facts and availability;
example claims in the reference do not authorize new facts or draft publication.

## Approach

Extend the existing shared record renderer, public-document fallback, navigation
and inventory screens. Add a separate restock-request record instead of abusing
checkout orders or putting guest contact data into the authenticated wishlist.
Retain existing registered-customer wishlist notifications where applicable.

A separate browser-only product implementation would increase schema drift.
Reusing unpaid orders would misrepresent intent and affect order reporting.

## Product rendering, navigation and links

- Reproduce failing direct entries, refreshes and catalogue-to-detail navigation.
  Cover canonical slugs and supported legacy identifiers without turning missing
  products into invented records or masking upstream failures as HTTP 404.
- Preserve category-specific benefits, suitability, evidence/limits, package and
  setup, ownership costs, service, selection summary, questions, specifications
  and separate replacement navigation. Keep web and Expo on the same facts.
- Keep the readable public document until the interactive screen is ready.
  Explicitly transfer layout ownership; verify real pointer hit-testing and
  keyboard activation, not forced clicks or screenshots alone.
- Supply an accessible menu toggle on shared navigation and product/detail
  entry points. Preserve the existing responsive bottom/side navigation.
  Include labelled controls, expanded state, usable touch targets, keyboard
  focus and Escape-to-close behavior on web.
- Use real browser destinations for navigation and authored hyperlinks, with
  artifact-safe paths and safe external protocols. Preserve normal browser
  opening/copying behavior. Do not make placeholder links appear functional.

## Restock data flow

Proposed contract: `POST /api/uc/restock-requests`, with the published product
key, exact selected variant when applicable, and an idempotency key.

- Guest form requires name, validated phone and a typed location such as town
  or area. Explain the stock-follow-up purpose. Do not require GPS, create an
  account, enroll marketing or infer account ownership from a matching phone.
- Signed-in requests derive customer ownership from the verified session.
  Prefill available contact details and collect missing required details.
  Reject invalid supplied authentication rather than silently becoming a guest.
- The server validates product/variant identity, derives canonical product
  metadata and stores a pending request in Companion's database.
- Add an additive restock-request table with customer-or-guest provenance,
  protected contact fields, product/variant identity, request status, timestamps
  and deduplication state. Mirror schema changes in the existing shared
  migration and deployed-startup paths.
- Repeated taps/retries must not create duplicate pending demand. Anonymous
  responses must not disclose whether a phone belongs to an account or already
  has a request. Do not replay failed writes automatically after reconnect.
- Display visible success/error feedback on both web and native. Do not claim
  success before durable storage or claim SMS/WhatsApp delivery from capture.

## ProjectHub and privacy

Extend Inventory with a pending-restock/prospect list and product/variant demand
counts. Distinguish guest prospects from registered customers. Allow authorized
staff to filter and move requests through pending, contacted and resolved.
These are explicitly not checkout orders or revenue.

Proposed staff endpoints: list and update under
`/api/uc/admin/restock-requests`. Enforce live server-side staff authorization;
customer reads, if exposed, are restricted to the authenticated owner.

Do not log contact values or request bodies, expose contact data through public
catalogue endpoints, or include it in analytics or public caches. Support removal
and existing account-export/deletion obligations. For guest contacts, purge
personal fields 180 days after resolution while retaining anonymous demand
counts; pending requests remain visible for staff follow-up.

## Public media and performance

Use the existing public-media delivery/CDN path rather than adding another
provider or changing DNS. Serve bounded image sizes and browser-compatible
formats, reserve layout dimensions, prioritize the first product photo and
lazy-load secondary photos/videos. Cache public versioned derivatives and
invalidate through source/version changes; retain an original-image fallback.
Do not cache authenticated responses, prospect data or failed image responses
as public content. Compare cold/warm image bytes and page loading before/after
without promising an unmeasured speed target.

## Verification and publication

Use focused API/component tests for validation, duplicate prevention, exact
variant identity, account isolation, staff permissions and visible saved states.
Verify direct entries, ordinary navigation/link clicks, menu keyboard behavior,
images and category sections across phone/tablet/desktop widths.

Use one integrated browser pass for the completed guest capture, signed-in
request and staff-review journeys. Exercise WebKit/Safari-compatible automation
when available; distinguish it from physical iPhone Safari or native Expo checks.
Use explicitly scoped synthetic fixtures and clean up only those fixtures.

Check the actual selected publication source and generated web/native artifacts;
working-tree success is not publication evidence. Preserve frozen-release
boundaries, supported legacy assets and draft restrictions. Prepare rather than
automatically publish. After owner publication, recheck real public deep links,
clickable category layouts, image delivery and the active build identity.

## Boundaries

No payment activation, unpaid-order creation, stock reservation, automatic guest
account linking, authentication weakening, unrelated UI redesign, new CDN
subscription or automatic production deployment is included.
