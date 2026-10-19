# Product browser/restock release

## What this implementation changes

Companion's category-specific product records remain authoritative. Product,
related-product, topic and enquiry navigation use real safe links on web and
native routing on Expo. Full authored benefits, suitability, evidence limits,
package, ownership, service, FAQ and the two video slots also survive initial
HTML delivery.

The menu remains available during loading/errors. It has labelled controls,
expanded state, Escape/focus return on web and scrolling on short screens.
Its hooks belong to their own component, not below authentication early returns.

Public-document layout is owned by an actual fallback element, not merely a
product-shaped URL. Only a readiness marker matching the current route releases
that fallback. Retained hidden screens cannot provide readiness for another page.

## Restock data and permissions

- `POST /api/uc/restock-requests`: published product/variant, name, international
  phone, typed location and retry key; no GPS, account creation, stock reservation
  or payment. Invalid supplied credentials cannot silently turn into a guest.
- `GET /api/uc/admin/restock-requests`: live-admin-only contact follow-up, status
  filtering, pagination and separate guest/customer demand totals.
- `PATCH /api/uc/admin/restock-requests/:id`: pending/contacted/resolved, guarded
  against conflicting pending demand or reopening erased contact records.
- ProjectHub: **Inventory → Restock requests**. Customer requests link to their
  authenticated customer identity and exact product; compatible parent inventory
  records also keep the existing wishlist relationship.
- Requests are not unpaid orders and do not enter sales totals. Saving a request
  does not prove that a notification was sent.
- Contact snapshots are private, never cached at the edge or logged. Customer
  exports include their own requests; account erasure removes contact snapshots.
  Resolved guest contact is removed after 180 days while anonymous demand
  history remains. Startup and daily cleanup enforce retention.
- Schema: `lib/db/migrations/0069_restock_requests.sql`, with matching idempotent
  API startup DDL. No production database changes were executed for preparation.

## Images and CDN

Photos use the existing public object-storage/catalogue derivatives. Width keys
are bucketed to 128/256/384/512/768, including native images. Original files remain
an explicit fallback. The hero has priority; secondary images are deferred/lazy.

`infra/cloudflare/ucfilters-router.js` now caches successful public image
responses only. It previously applied API `no-store` even to public image files.
Authorization, cookies, private endpoints, unknown parameters, non-images and
errors bypass the image cache. CORS is applied per caller after cache lookup.

**The Cloudflare change requires separate publication of the existing worker.**
A Replit app publication alone does not update Cloudflare. Do not create another
worker, change DNS, loosen CORS or cache OAuth/prospect responses. A successful
image request exposes `X-UC-Image-Cache: miss`, then `hit` when edge caching is
active. This is a cache observation, not proof of application publication.

## Bounded publication source

The release does not blindly copy main:

- `infra/cloudflare/forest/prepare-product-browser-restock.py` applies an explicit
  feature allowlist over the retained product source and rejects ambiguous edits.
- `product-browser-restock-review/` holds source bytes, scope hashes, provenance,
  approval metadata and the separate edge-worker source fingerprint.
- `product-page-selection.mjs` selects those checksummed bytes.
- `build-approved-consistency.mjs` checks the source/stage and preserves the
  earlier accepted release identities for safe rollout/rollback.
- Dependency/security pins, approved photo product codes and the prohibition on
  implicit production stock initialization remain unchanged.

Local-only verification commands:

```sh
node infra/cloudflare/forest/build-approved-consistency.mjs api --local-only
node infra/cloudflare/forest/build-approved-consistency.mjs hub --local-only
node infra/cloudflare/forest/build-approved-consistency.mjs companion --local-only
```

`--local-only` is compilation evidence, not publication. Actual publication must
keep the existing retained-client/rollback requirements and deployment gates.

## Checks and remaining live verification

- Main shared-library, API, ProjectHub and Companion typechecks passed.
- Eleven isolated-database restock tests passed: guest capture, no order creation,
  concurrent retries, contact/variant validation, stale/deleted/team credentials,
  registered identity/wishlist linkage, live-admin checks, status conflicts,
  retention and erasure. The concurrency regression exceeds the pool's capacity
  with bounded deadlines and verifies that unrelated queries still progress.
- Independent editorial reads complete before the submission reserves a
  transaction client, preventing nested-pool acquisition starvation.
- The customer-count index test now checks index-only eligibility independently
  of planner cost choices under concurrent fixtures; production SQL is unchanged.
  The combined targeted restock/customer-count run passed all 18 tests.
- Twenty-six focused renderer, public-layout, safe-link, image URL and edge-cache
  checks passed. These do not constitute a clean run of the entire historic suite.
- The final selected frozen API and ProjectHub releases compiled successfully.
  The same frozen Companion release passed typechecking and produced web, iOS
  and Android bundles. All three commands finished in local-only mode: no
  production publication or Cloudflare activation was performed.
- Edge-cache checks also reject duplicate query parameters, conflicting private
  or no-store directives, and responses that set cookies.
- Development requests confirmed public submission validation is HTTP 400, staff
  listing is HTTP 401 without authentication, and Viva Drop is HTTP 200 with five
  gallery images. One checked derivative returned a 10,946-byte WebP.
- A mobile-width development preview rendered the product and menu without the
  earlier wrapped-child style error. It captured photo loading, not physical
  iPhone/Android completion. No Safari/Expo device result is claimed.

Before calling the live issue resolved, publish the selected release, publish
the prepared existing Cloudflare worker, then check normal unforced navigation,
all relevant product photos, menus and real hyperlinks on Safari and Expo Go.
Use an isolated authorized fixture for guest/customer capture and staff status
checks; do not create production prospects as an unapproved test. Compare actual
served build identities with the selected source, not just the publish success.
