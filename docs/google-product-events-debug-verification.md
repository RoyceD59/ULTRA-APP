# Google product-event debug verification

## Approval and boundary

On 2026-10-16 the owner supplied measurement ID `G-K224XGM5KB`, collector
`https://google-analytics.com`, and permission to use `debug_mode: true` or
`&_dbg=1` on test payloads. This approves the isolated debug check, not permanent
activation, publication, real payments, or saved-order pay-link instrumentation.

No app activation flags, deployment settings, payment configuration, Umami
implementation, or native implementation were changed.

## Development transport evidence

At **2026-10-16 09:54:11 UTC / 12:54:11 Africa/Nairobi**, an isolated, disposable
Chromium context exercised the current `lib/productAnalytics.ts` adapter using
Google's downloaded `gtag.js` for the approved measurement ID. Only the
React Native platform import was replaced with a web platform stub when
compiling the module for this diagnostic. This is **adapter/transport fixture
evidence**, not a signed-in product-page or checkout journey.

Each of these events left the browser exactly once, addressed to
`G-K224XGM5KB` at `https://www.google-analytics.com/g/collect`:

| Event | Observed event fields, excluding Google-generated transport fields |
| --- | --- |
| `view_item` | `pr1=idGA-DEBUG-ONLY~qt1` |
| `add_to_cart` | `pr1=idGA-DEBUG-ONLY~qt1` |
| `begin_checkout` | `epn.item_count=1` |
| `add_to_wishlist` | `pr1=idGA-DEBUG-ONLY~qt1` |
| `share` | `ep.method=copy` |
| `compare_opened` | Event name only; no item serialized by the downloaded tag |

Google returned **HTTP 204 for both requests** (one single event and one
five-event batch). The browser automation also reported `net::ERR_ABORTED`
for these beacon requests after observing their 204 responses. This is recorded
rather than treated as a clean browser-delivery assertion.

All six events included `ep.debug_mode=true`; the diagnostic additionally
appended the explicitly approved `_dbg=1` to the collector query string.
The downloaded tag did not itself serialize `_dbg=1` from `debug_mode: true`
in the preliminary blocked checks. Those preliminary checks sent **no product
events** to the collector.

**HTTP 204 establishes an observed collector response, not property-level
processing or DebugView visibility.** The separate owner-side DebugView
confirmation is recorded below; it is not inferred from HTTP status.

## Privacy and isolation checks

- Only synthetic SKU `GA-DEBUG-ONLY` and quantity `1` were used. No customer
  account, order, contact, shipping address, token, or real transaction was used.
- The share probe included synthetic forbidden-field canaries for email,
  phone, address, token and URL. None survived the adapter or appeared in the
  permitted network payloads.
- The diagnostic document was fulfilled locally at
  `https://example.invalid/uc-companion/analytics-debug`. Every permitted hit
  used that fixed `dl`, an empty `dr`, and no arbitrary customer URL metadata.
- The isolated context had no existing customer cookies or sign-in state.
  Google's own generated browser/session identifiers and browser telemetry
  were not retained in this record. As with any HTTPS collector, Google sees
  the diagnostic environment's network connection; this is not a claim that
  the Google tag sends no browser telemetry.
- A network allowlist permitted only the approved tag download and six debug
  event types to the Google Analytics collector. In preliminary blocked runs,
  Google's tag attempted an extra `www.google.com/g/collect` destination and
  automatic `scroll` events; those requests were blocked. No such extra
  requests were observed before closing the successful run.
- No Umami script was loaded, and no native process or existing app session was
  modified. This isolates the check from existing analytics rather than proving
  deployed cross-provider counts.
- For `share` and `compare_opened`, the adapter supplied an `items` array but the
  downloaded Google tag did not serialize an item into the observed requests.
  Event-name delivery must not be mistaken for item-level report completeness.

## Purchase and regression evidence

The existing focused tests passed:

```sh
cd artifacts/uc-companion
TSX_TSCONFIG_PATH=$(pwd)/tsconfig.test.json node \
  --import ./test-setup.mjs --import tsx/esm \
  --test lib/__tests__/product-selection.test.mts
```

Result: **6 tests passed, 0 failed**, including opt-in behavior, forbidden-field
filtering, native silence, rejection of unverified purchases, and one adapter
call for a repeated verified synthetic transaction ID. Verified synthetic
purchases in these tests use an in-memory collector, never Google.

The live debug session tested only negative purchase probes: an unverified
transaction and an invalid transaction ID. Neither produced a purchase event.
**No external purchase event was emitted and no payment was executed.**

Source inspection confirms that the checkout success path calls
`trackVerifiedPurchase(order.paymentStatus === 'paid', ...)` with `UC-${order.id}`;
order creation alone does not meet that condition. This is not external
verification of a real paid transaction, cross-reload purchase deduplication,
or an authorization to invent a paid transaction for testing.

## Owner-side DebugView confirmation

The owner selected **“All six appear; no purchase or pay-link events”** for
`G-K224XGM5KB`. The supplied screenshot showed “Waiting for debug events” and
0 debug devices, so the discrepancy was explicitly checked rather than treating
that screenshot as positive ingestion evidence. The owner then clarified:
**“All six appeared after the screenshot.”**

The six non-purchase debug event names are therefore confirmed in the approved
property by the owner, separately from the observed collector HTTP responses.
This is **owner-attested DebugView evidence**, not an agent-observed report or
a screenshot showing the final event list. No further events were sent in
response to the confirmation.

The approved development ingestion check is complete within those evidence
limits. Payment safeguards were checked locally and with negative live probes;
positive external paid-purchase ingestion was deliberately not exercised.

## Release boundaries and future work

- No permanent Google loader or activation flags were installed. Production
  UI-journey collection, privacy controls on a permanent loader, and counts
  across deployed providers are not certified by this isolated check.
- The missing item context for `share` and `compare_opened` is a separate report
  completeness issue, not a missing event-name delivery.
- Any positive external purchase check needs a separately authorized
  verified-paid test transaction/setup; none was supplied or executed.
- Saved-order pay-link lifecycle checks remain separate. Do not replay test
  events or activate collection merely because this check passed.

Reference: [Google's DebugView instructions](https://support.google.com/analytics/answer/7201382?hl=en).

## Project-wide completion validation

The approved ingestion check is verified as described above, but the task could
not be marked complete because the configured project-wide checks failed:

- `cd artifacts/uc-companion && npx expo-doctor`: 19/20 checks passed; 11
  installed Expo packages are below the patch versions currently required by
  the SDK check, including Expo, router, notifications, sharing and contacts.
- `cd artifacts/api-server && pnpm test`: failures across existing API flows,
  including order-status, Paystack retryability and referral recovery. Examples
  include HTTP 410 where 200 was expected, HTTP 422/409 instead of the expected
  payment-outage responses, and `INVALID_RECOVERY_LINES`.
- All configured typechecks, the Companion startup-fonts check and the
  completion code review passed.

These were not failures of the six focused product-selection tests. The initial
verification changed no application source or dependencies, and the failing
checks were not bypassed.

### Owner-approved validation repair — 17 October 2026

The owner subsequently approved repairing the Expo and API failures.

- Aligned the eleven Expo packages with the SDK's required patch versions and
  updated the lockfile without disabling version or package-age checks.
  `cd artifacts/uc-companion && npx expo-doctor` now passes **20/20**.
- Added suite-owned app-catalogue fixtures, including variant inventory, rather
  than restoring WooCommerce authority or relying on retired demo IDs. Updated
  supported checkout, account, permissions, recovery and notification-adjacent
  tests to the current app-owned contracts.
- Fixed two API response gaps exposed by those tests: invalid checkout contact
  details now retain per-field errors (including simultaneous COD name/phone
  errors), and failed checkout payment verification explicitly returns its
  retryability. Payment authorization and confirmation rules are unchanged.
- The final focused batch passes **235/235 tests**, with no skips or cancelled
  tests. Shared-library, API and Companion TypeScript checks pass. The API
  health endpoint returns 200; both workflows restart successfully. A warm
  signed-out Companion browser renders content with a full-height root and no
  page errors. The initial static capture was blank before content painted.
- Package audit still reports two high advisories against the upstream
  `node-forge` and `braces` versions. These already have repository backports;
  the active-consumer security regressions pass **7/7**. This is not a clean
  upstream-version audit or a new production release.

The owner also explicitly approved **“Replace retired tests; preserve app-owned
coverage”**. Retired Woo-only success paths were consolidated into explicit
disconnection/no-write checks; supported local payments, receipts, account
ownership, complete exports, inventory, editorial and notification contracts
remain exercised. See the [coverage transfer record](api-retirement-validation.md).
No skipped test or restored integration substitutes for those contracts.

The startup-fonts check also passes after the Expo updates. Earlier failed
full-suite counts predate these repairs and are not current totals. Final
project-wide completion validation remains the completion gate; the initial
completion review is not represented as a review of the expanded repairs.
No Google activation flags, real payments, permanent collector installation,
production database changes or publication were performed during the repairs.
