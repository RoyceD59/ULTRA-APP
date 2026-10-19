# Unified My Filters verification

## Prepared development behavior

Account and Home use the same exact-identity presentation model. App/store
and linked offline units share the ready group; purchase provenance stays
in badges and collapsed history. Registered assignments are not new offers.
Records without sufficient identity remain visible instead of being matched
by product, date, order number or contact.

Registration continues through the existing purchase/unit-specific modal
and APIs. A blank installation date prevents submission. Adding or restoring
a unit while a primary exists does not schedule its reminders again or replace
its installation, maintenance count, notification IDs or performance history.

Source reads are account-keyed, abortable and refreshed on focus, polling and
explicit retry. Successful registration invalidates activation purchases,
offline purchases, assignments, rewards and cycle status. Store read failures
retain independent app records; mirrored records without live confirmation
stay unavailable. Incomplete store pagination is never treated as a complete
store result. Recovery reads never queue or replay registration writes.

## Automated checks

- Shared library, Companion and API TypeScript checks passed.
- 24 focused model/component/hook checks passed, covering one heading, progressive
  disclosure, independent quantities/source IDs, primary/assignment/offline/
  ledger deduplication, restore selection, unavailable/loading/saved states,
  account-key cancellation, installation-date confirmation, primary-cycle
  preservation and late registration completion after unmount.
- 42 isolated API checks passed across checkout activation consistency,
  customer assignments and offline registration. The test database was
  created and dropped by the runner. Offline reads expose the exact registered
  filter ID; store outage tests retain standalone app units without inferring
  mirrored eligibility.
- `expo export --platform all --output-dir /tmp/uc-my-filters-prepared`
  produced web, Android and iOS bundles. A final-source repeat exported to
  `/tmp/uc-my-filters-final`. This is compilation evidence, not
  installation or activation of a release package.

Reproduce focused client checks from `artifacts/uc-companion`:

```sh
TSX_TSCONFIG_PATH=$(pwd)/tsconfig.test.json \
node --import ./test-setup.mjs --import tsx/esm --test \
  lib/__tests__/myFiltersPresentation.test.mts \
  hooks/__tests__/useMyFilters.test.mts \
  components/__tests__/AccountIdentity.test.mts \
  components/__tests__/FilterTrackerSection.test.mts \
  components/__tests__/MyFiltersSection.test.mts
```

Reproduce API checks from `artifacts/api-server`:

```sh
TEST_GLOB='src/tests/{offline-purchase-registration,customer-assignments,checkout-activation-consistency}.test.ts' pnpm test
```

## Browser and device boundaries

The shared development preview route initially served HTML but misrouted
Metro's root-relative bundle URL. The dedicated Expo development hostname
served both HTML and JavaScript after warming the bundle, and the signed-out
phone-width Home screenshot rendered normally. React Native DevTools' missing
desktop library warning did not prevent Metro from serving the app.

Signed-in browser results are recorded separately below. Browser fixtures do
not establish real payment, rewards, cash collection or verified impact.
Physical Expo Go, notification delivery/touch/screen-reader behavior on actual
devices, and deployed behavior remain unverified here.

Nothing was published. No frozen/active release archive, serving manifest,
rollout flag, hosting configuration, payment state, or ignore rule was changed.

## Signed-in browser pass

The configured sign-in returned HTTP 400. The browser pass therefore used
explicitly synthetic, browser-intercepted authentication/data and registration
responses on the dedicated Expo development hostname. No database account or
registration was created; no real customer/payment records were modified.

Verified at 390×844, 768×1024 and 1440×1000:

- One My Filters heading, current tracker first, three independent ready units
  (two app quantity units and one linked offline unit), initially collapsed
  Other filters and Purchase history.
- All three unit-specific sheets had blank installation dates. Successful
  app and offline fixture registrations submitted distinct confirmed dates
  and left the primary installation, registration identity, cleaning count,
  last-cleaned date and performance check-in unchanged.
- Home retained its active filter-health card while offering the ready units;
  Show all reached each offer and View all filters navigated and scrolled to
  Account's My Filters block.
- Keyboard Enter/Space expanded disclosures with exposed expanded state.
  Long names wrapped; document and body widths matched viewport width and
  horizontal scroll stayed zero at all three widths.
- Store errors and a full online 503 showed appropriate retry/saved-data
  feedback without hiding offline offers. Pending reads did not claim empty.
- A failed app registration showed an inline error. Subsequent read refreshes
  did not queue or replay its POST.
- A registered offline unit had a distinct restore-on-device action. Browser
  execution of restore was not attempted; component checks cover its original
  date and preservation of existing reminder identities.

Phone/tablet/desktop, offline-sheet, expanded-restore, source-failure and failed
registration screenshots were captured during this pass. The synthetic cycle
lacked server-backed capacity association, so the health card correctly showed
capacity unavailable and used its existing time-based status. This does not
verify a real customer's capacity linkage or physical-device notifications.

Account switching/late reads and late registration completion were covered by
focused hook/component checks, not by switching live browser accounts. The
browser fixture session, activation storage and route handlers were removed;
reload returned to the signed-out Account prompt. Unrelated synthetic-token
401s on QR/water-test/impact reads were outside this focused journey.
