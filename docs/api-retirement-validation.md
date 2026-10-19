# API validation after WooCommerce retirement

The owner approved replacing retired WooCommerce success-path tests while
preserving supported app-owned coverage on 17 October 2026. This is a test
contract migration, not authorization to reconnect WooCommerce, change live
data, publish, or relax payment verification.

## Coverage transfer

| Former expectations | Current checks |
| --- | --- |
| Woo remote order creation, sequential/concurrent duplicates, offline recovery, promoted Woo anchors | `woo-retirement.test.ts` checks disabled transport, signed/unsigned/repeated webhook HTTP 410, unchanged orders, no canonical purchases/events/outbox, read-only owner recovery of pending anchors, cross-account rejection, and no new remote calls or sale imports. |
| M-Pesa/Paystack duplicate order confirmations and email route wiring; Woo/DB email branches | `app-order-delivery.test.ts` prepares real app-owned pending checkouts before confirmation, confirms synthetic verified M-Pesa/Paystack/Stripe attempts, checks sequential and concurrent retries, exactly one receipt, exact recipient/item/order identifiers, paid versus unpaid COD receipts, key-based COD deduplication, distinct new intents, and cross-account payment-reference rejection. No provider money is initiated. |
| Woo store-wide order history and email scoping | `app-order-delivery.test.ts` checks local ownership, history beyond twenty records, newest-first order, no fulfillment-as-payment inference, and anonymous empty history. |
| Woo portability export pagination/outage | `data-export.test.ts` checks all 102 local orders, late line items, category completeness, attachment headers, preferences/reviews/push registrations and no cross-account data or Woo request, with and without stale Woo credentials. |
| Woo catalogue publication/provenance, category and cache fixtures | `public-product-provenance.test.ts`, `catalogue-performance.test.ts` and `product-category-resolution.test.ts` check app-owned public evidence, fresh local stock, no unknown/demo fallback, repeat catalogue reads, category normalization and complete pagination/failure bounds. Public catalogue tests are consolidated rather than duplicated. Alison tests retain incomplete/oversized catalogue failure checks without remote Woo fixtures. |
| Woo product image migration and fixed remote variant IDs/prices | `product-editorial.test.ts` retains real HTTP admin/revocation, optimistic editing, safe metadata, initial HTML/SEO, gallery, variant stock and identity, unpublished-parent, saved child-line and legacy-refresh checks against actual app inventory. Source products remain the seed contract; authorized variant edits are not incorrectly treated as forbidden. |
| Signed Woo webhook delivery into the status engine | HTTP delivery is retired and checked above. `order-status-pipeline.test.ts` retains historical reconciliation ordering/deduplication, customer projection, staff regression rejection, provider failures, opt-outs, stale push tokens, fenced claims, leases and hung-provider bounds by exercising the internal engine directly. |
| External n8n stock writeback and unreachable remote manual-alert route | `inventory-integrations.test.ts` checks live admin access, actual local stock validation/persistence/audit boundary, HTTP 410 even with an encrypted saved webhook, no retired manual alert, and integration-settings auth/SSRF checks. IPv4/IPv6 special-use and public literal cases remain covered. Scheduled low-stock behavior remains in `low-stock-alert.test.ts`; no dormant sender was enabled to satisfy an old test. |
| Woo source mirroring for customer assignments and scheduled Woo lifespan alerts | `woo-retirement.test.ts` checks explicit unavailable-source errors with no mirrored order, no product fetch/email/history changes for the dormant audit. Supported local assignment scenarios remain in `customer-assignments.test.ts`. |
| Order notification callers using retired product IDs/payloads | Push-token rotation and SMS metadata tests now use suite-owned catalogue rows and modern collection checkout, retaining background stale-token removal and exact local order/recipient metadata. |

Other supported payment, promotion, referral, recovery, receipt rendering,
canonical reconciliation, fulfillment and ownership suites remain enabled.
Empty-item receipt rendering is retained in `order-confirmation-email.test.ts`;
no successful order is invented after a database failure.

## Isolation and gates

- All DB-backed tests run through the existing per-run test-database wrapper.
  No development or production customer data is modified.
- Suite-owned products are removed after their suite. Editorial-wide changes
  and retirement evidence run in the runner's serial phase, avoiding another
  worker's temporary catalogue or outbox records.
- The app-commerce seed-edit suite restores its original authored record and
  inventory, deletes its import/reservation fixtures, and runs serially.
  Customer-count physical-plan assertions also run without concurrent fixture
  writes; their index-only assertion is retained, not weakened.
- Tests do not set Google activation flags, initiate real payments or contact
  a retired provider. Notification transports use synthetic local fixtures.
- No new test skip, failing-check exclusion, Expo Doctor override, or relaxed
  security/authorization rule was added.
- Final completion uses the configured project-wide validation, not a
  replacement command that omits unrelated suites. Focused repair runs are
  diagnostic evidence, not a substitute for that gate.
