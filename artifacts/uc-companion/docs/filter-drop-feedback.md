# Page-data feedback

## Inventory and boundaries

- Initial page/section reads: Home products/promotions/articles; Shop catalogue
  and compatible add-ons; Blog feed and article; product details/reviews;
  account rewards, rewards QR, assigned filters and water-test history; rewards;
  orders and signed-in order detail; care points; location lists/native map;
  referral details; basket storage; team product details/media; daily hydration;
  notification, hydration-reminder and message preferences.
- These use the shared `PageDataLoader` for initial waits, and `PageDataError`
  for failed reads. Query data remains visible during background refresh.
  Signed-out guidance, empty lists, no matches and not-found recovery stay
  distinct from failed reads. Guest checkout confirmation is unchanged.
- Payment processing, checkout guards, submission/upload progress, validation,
  contacts permissions, device-location progress and pagination keep their
  existing action indicators. Startup, web server/rendering/metadata and all
  reminder scheduling logic are unchanged.

## Shared treatment

`FilterDropIllustration` uses the bundled filter cartridge with falling blue
drops: a looping GIF of 5,313 bytes and a matching still PNG of 1,374 bytes.
`scripts/generate-filter-loader.mjs` deterministically regenerates both with
ImageMagick; it is not an application dependency.

The existing motion hook permits animation only when reduced motion is off,
the screen is focused and the app is foregrounded. Errors/crash fallback
always use the still asset. A failed image load uses a safe water icon.
Loading labels, live error copy, and named recovery buttons are accessible.
The shared button prevents overlapping recovery attempts and never retries
automatically. Existing explicit rewards-QR identity recovery is preserved;
payment and submission retry behavior is not changed.

## Daily water and preferences

The daily water card appears once inside the top notification block, before
the separate hydration-reminder section. Home no longer subscribes to
hydration. The card retains the existing account/date query and midnight/
foreground refresh, zero and decimal totals, not-recorded and signed-out
guidance, error recovery, water-logging navigation and web daily prompt.
Logging is independent of notification permission and preference read state.

Preference reads have account-scoped query keys and no initial default data.
Controls stay blocked during reads, failed reads and saves. Explicit strict
storage reads distinguish a genuinely absent preference from corrupt or
unreadable storage; other callers retain their existing fallback behavior.
Retry retrieves persisted values. Hydration interval drafts and save results
are guarded against account/session changes. Opt-in, 2/3/4-hour intervals,
5 am–8 pm local hours, native permission handling and scheduling are unchanged.

## Verification

- Companion TypeScript check passes.
- Loading/hydration/reminder/preference/basket-guard checks pass (41 tests).
- The full Companion suite initially passed 558 of 559; its only failure
  required the retired basket `ActivityIndicator`. The corrected test verifies
  the same hydration-before-empty-state invariant with `PageDataLoader`, and
  passes with the focused checks.
- Metro serves iOS and Android JavaScript bundles with HTTP 200. This confirms
  native bundling, not rendering or notification delivery on physical devices.
- A 375px browser pass confirmed Home absence, one card in the notification
  block, separate reminder settings, signed-out Hydration guidance, Back
  navigation, corrupt local preferences blocking switches, restoration/Retry,
  and a delayed article loading/error state with navigation still available.
- The browser's signed-in and live article retry checks were blocked by API
  502 responses. Starting the existing development API workflow resolved them;
  subsequent health and Blog GET checks returned HTTP 200. Account-specific
  reads, successful UI retry, and reduced-motion browser emulation were not
  re-tested in the browser; unit checks cover their state/motion contracts.
- Real phone rendering, accessibility announcements, reduced-motion preference
  changes and background transitions require physical iOS/Android checks;
  do not claim those from the unit mocks or browser emulation.