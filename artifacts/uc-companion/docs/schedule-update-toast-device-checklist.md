# Schedule-update notice: physical-device checklist

## Scope and evidence

This checklist exercises the real Account → My Filter catalogue-sync path and
`SyncToast` with React Native's native animation driver and device safe areas.
It is the manual-test deliverable. **The user reports that the real-device test
passed**; see the execution record below for evidence limits. Source inspection,
mocked Node tests, Expo web, and simulators do not establish a physical-device pass.

Relevant sources:
- `components/FilterTrackerSection.tsx`: only a live catalogue triggers sync;
  a non-null updated activation sets the message and shows the toast.
- `hooks/useNotifications.ts`: `syncActivationWithCatalogue` returns null for
  an unchanged lifespan and persists a changed activation.
- `components/SyncToast.tsx`: 250 ms entrance, 3000 ms hold, 350 ms exit;
  `onHide` clears visibility after the sequence finishes.

## Prerequisites and safety

- Run on a physical Android phone and a physical iPhone (include a
  notch/Dynamic Island device). Record whether each run uses Expo Go or an
  installed native build. A web preview is not a substitute. For native-build
  sign-off, repeat in the actual installed build, not only Expo Go.
- Use an isolated test API/catalogue and a disposable signed-in customer with a
  valid test purchase/receipt. Confirm the app points to that environment.
  **Do not edit the production WooCommerce catalogue or a real customer's
  registration.** If isolated catalogue access is unavailable, mark the run
  blocked; do not replace this scenario with a standalone toast demo.
- Choose a trackable test product with a positive rated lifespan. The examples
  below use a fixture named `Toast QA Filter`, initially 90 days, later 120
  days. These are test values, not approved product specifications.
- Have permission to update that test product's `filter_lifespan_days` metadata.
  Verify the app's `/api/uc/products` response contains the same product ID and
  expected `lifespanDays`; allow any test-environment catalogue cache to refresh.
- Keep the device online, foregrounded, and at normal animation speed. Disable
  Fast Refresh/reloading while measuring. Use a screen recording with timestamps
  or frame counts, not a stopwatch started at app launch.

## Prepare a known activation

1. With the test catalogue at 90 days, sign in and open Account → My Filter.
2. Register the test purchase using the normal receipt flow. Confirm the card
   identifies the intended product and shows `90d effective life` for a clean
   activation without water-quality/performance adjustments.
3. Wait at least 5 seconds for the separate “registered successfully” toast to
   finish. Do not use that registration notice as evidence of catalogue sync.
4. Record the product ID, product name, and activation date. Keep the same
   account, installed app data, receipt linkage, and activation throughout the
   following cases. Do not re-register to trigger the schedule-update notice.

## Case A — unchanged lifespan does not show a notice

1. Leave the test catalogue at 90 days.
2. Fully close and reopen the app **without clearing app data**, then open
   Account → My Filter. Start recording before opening Account.
3. Confirm a successful fresh products response carries this product at 90
   days. Cached/offline content alone cannot establish this case.
4. Observe for at least 5 seconds after the fresh response and loaded filter
   card.

**Pass:** no `reminders updated` notice appears, including a brief flash; the
activation still has a 90-day rated lifespan.

## Case B — changed lifespan shows the exact message, then disappears

1. Close the app. In the isolated catalogue, change only this product's lifespan
   from 90 to 120 days; leave its ID and name unchanged.
2. Confirm the test API now returns this product at 120 days. Do not proceed
   while it still returns 90.
3. Start recording, reopen the app without clearing its data, and open Account
   → My Filter. A fresh mount fetches the catalogue; merely backgrounding and
   resuming is not a reliable catalogue-refresh trigger.
4. Watch without touching the screen for at least 5 seconds after the notice
   first appears.

**Pass checks:**
- [ ] The toast slides down and fades in smoothly, with the sync icon and exact
  text: `Toast QA Filter reminders updated: 90 → 120 days`.
  For another fixture, substitute its **previous activation name** and exact
  old/new rated day counts, not performance-adjusted effective days.
- [ ] The message is readable without clipped numbers or arrow, including on
  the smallest test phone. Check it at the top and after scrolling the Account
  screen so My Filter is in view; record any scroll-dependent positioning.
- [ ] The toast is not hidden beneath the status bar, notch/Dynamic Island,
  navigation header, or other content. The component uses
  `insets.top + 12` relative to its containing view; inspect actual placement
  rather than assuming this is screen-relative.
- [ ] It stays fully visible for approximately 3 seconds, then fades/slides out
  without tapping, scrolling, or navigating. Expected total animation time is
  approximately **3.6 seconds** (0.25 + 3.00 + 0.35), not 3 seconds from launch.
  Use 3–4.5 seconds from first visible frame to fully hidden as a manual
  tolerance; record measured times and investigate results outside that range.
- [ ] At 5 seconds after first appearance, no visible banner or text remains.
- [ ] The filter card reflects the 120-day lifespan and retains the original
  activation date; this was a correction, not a new registration.

## Case C — unchanged after a successful correction stays quiet

1. Leave the test catalogue at 120 days after Case B.
2. Fully close and reopen the app, preserving app data, and open Account again.
3. Confirm a fresh products response still carries 120 days. Observe the
   loaded filter card for at least 5 seconds.

**Pass:** the stored activation remains at 120 days and no schedule-update
notice appears. A pass requires the live fetch, not only cached display.

## Device matrix and execution record

Run A, B, and C on each target. Record failures as failures, unavailable access
as blocked, and unexecuted cases as not run. Do not pre-fill passes.

| Device/model | OS | Runtime (Expo Go/version or native build ID) | A | B | C | Recording |
| --- | --- | --- | --- | --- | --- | --- |
| Physical Android | — | — | Not specified | Not specified | Not specified | — |
| Physical iPhone with cutout | — | — | Not specified | Not specified | Not specified | — |

For each execution, record:
- Date, tester, code revision/build identity, and isolated environment.
- Fixture ID/name and observed old/new rated lifespans (no credentials or PII).
- Live catalogue response evidence, with sensitive data removed.
- First visible, fully visible, fade-out start, and fully hidden timestamps.
- Position/readability observations, pass/fail per checkbox, and recording
  reference. Record normal and enlarged system text results separately.

Current execution status: **PASS — user-reported real-device test**.
After receiving this checklist, the user confirmed: “Real device text  passed .”
This is recorded as their overall test result, not an independently observed
agent run. Device model, OS, runtime/build identity, per-case results, measured
timings, and recordings were not supplied. The platform rows above therefore
remain unspecified; this confirmation does not establish that both Android and
iPhone were tested or certify a particular build.

## Cleanup

Restore the test catalogue's original metadata and remove/dispose of the test
registration using the normal test-account flow. Restoring 120 → 90 while the
activation remains installed can legitimately show another correction notice.
Keep test reminders isolated; remove the test app/account's scheduled reminders
when finished. Do not clear unrelated accounts' device data.

## Supporting automated check (not device evidence)

From the workspace root:

```sh
cd artifacts/uc-companion
TSX_TSCONFIG_PATH="$PWD/tsconfig.test.json" node --import ./test-setup.mjs --import tsx/esm --test hooks/__tests__/syncActivationWithCatalogue.test.mts
```

This existing suite checks changed/unchanged sync results with mocked storage
and notification scheduling. It does **not** render the toast, measure native
animation timing, or validate safe-area placement.

Supporting execution: the command above completed successfully during checklist
preparation, with **9 tests passed and 0 failed**. The later real-device pass is
the user's report, separate from these automated results.