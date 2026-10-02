# Loading and photo-header verification

Measured on 2026-10-02. These are development-container measurements, **not
physical-phone timings or a production deployment**.

## Method

Compare a production-mode Expo web export of the pre-change source with the
updated source, using the same installed dependencies, Chromium executable,
390 × 844 viewport, local HTTP server, API fixtures, and fresh browser contexts.
Run the two exports sequentially, without concurrent bundle builds. Three runs
per condition; report medians. Clerk is bypassed using the existing isolated
preview flag **in both benchmark exports only**; production authentication is
not bypassed. No real customers, payments, orders, or impact data are modified.

The slow condition adds 2,000 ms to every font request and 1,800 ms to API
requests. It isolates font/data latency; it is not a complete 3G bandwidth or
low-end CPU simulation. Normal assets are served uncompressed locally.

“Home usable” means its greeting/navigation has rendered; product content is
measured separately. Shop and Blog are timed from clicking their tab until
their fixture content renders. Home → Shop uses the shared catalogue result;
the measurements do not claim an uncached Shop network improvement.

Raw request durations, transferred bytes, browser errors, and Chrome
ScriptDuration/TaskDuration metrics are in `loading-before.json` and
`loading-after.json`. Scripts are `scripts/measure-loading.cjs` and
`scripts/check-page-loading.cjs`.

## Results

| Median, milliseconds | Before normal | After normal | Before slow | After slow |
|---|---:|---:|---:|---:|
| Home usable | 612 | 551 | 2,650 | 1,118 |
| First Home product content | 651 | 587 | 4,446 | 2,908 |
| Shop content after Home | 102 | 94 | 105 | 101 |
| Blog content | 75 | 87 | 2,355 | 2,360 |
| Warm return to Home | 67 | 53 | 60 | 58 |
| Browser script work across the journey | 438 | 412 | 518 | 523 |
| Browser total task work across the journey | 629 | 595 | 876 | 882 |

The repeatable improvement is removing slow fonts from the navigation critical
path: Home is usable **58% sooner** in the delayed-font/data condition. The normal
10% improvement is smaller and subject to container timing variation. Blog
network time and slow-condition CPU work are effectively unchanged; there is no
claim that photographs speed network requests or JavaScript execution.

Fonts still load in the background. The four Inter files total about 1.37 MB;
Ionicons is about 390 KB. Existing screens use system font weights rather than
an Inter fontFamily, so the 600 ms startup budget provides a safe bounded
fallback without replacing typography. Removing unused font downloads or
splitting the existing route bundle should be evaluated separately.

## Payload and requests

| Resource | Before | After |
|---|---:|---:|
| Web entry, uncompressed | 4,896,768 B | 4,903,350 B |
| Web entry, gzip estimate | 1,198,688 B | 1,201,249 B |
| Requests over Home → Shop → Blog → Home | 14 | 19 |
| First normal sample resource transfers, local uncompressed server | 6,699,859 B | 6,878,061 B |

The five additional requests are the three local photographs and GIF/still
resources, not additional catalogue calls. The initial conservative still
frame can load before the motion preference resolves. The full new media
payload is 170,120 B: Home 72,459 B, Shop 17,208 B, Blog 67,345 B, GIF 11,700 B,
and still 1,408 B. All photographs meet the 200 KB ceiling and the GIF meets the
100 KB ceiling; no exception is needed. Source/licence details are in
`assets/headers/README.md` (including GIF provenance).

Images have fixed layout dimensions, low fetch priority, no global prefetch,
and a brand-colour error fallback. Opaque Deep Ocean content panels maintain
text contrast independently of image loading. The page never waits for a
photograph to reveal navigation.

## Checks

- Companion tests: **504 passed**, including existing authentication/session,
  account-switch query isolation, cart hydration/race, checkout guards/payment
  classifiers, catalogue freshness, rewards and impact regressions.
- Companion TypeScript: passed.
- Expo Doctor: **20/20 passed**.
- Production-mode Expo exports: web, Android Hermes and iOS Hermes passed,
  including the locally bundled photographs, GIF and still.
- Full `scripts/build.js` packaging: passed for iOS, Android and web, with 59
  local assets copied and bundle/manifest asset URLs rewritten. Run with
  `CI=1` alongside development Metro to avoid the container's file-watcher
  limit. Production build settings were used; nothing was published.
- Browser fixture checks: slow navigation while requests remain pending,
  visible animated GIF, reduced-motion still, successful loader removal,
  empty-state loader removal, 503 failures/retry, aborted photographic
  requests, shared warm-tab catalogue caching, retained usable cards after
  failed background refresh, and pre-existing cart hydration all passed.
- Layout checks: 320 px phone width and 1,440 px dark-mode web; no horizontal
  overflow. Photo fallback and still rendering are also covered by focused
  state/component contract tests.
- Live development web preview: Home renders with the photo header, usable
  navigation and no browser exceptions. The API workflow was not running, so
  unavailable optional content showed a retry rather than blocking navigation.
- No new page-data loader is used for checkout/payment/submission actions.
  Their existing action-specific progress indicators remain unchanged.
- Native splash configuration remains static and unchanged; animated GIFs
  begin only after React can render. Focus, foreground and reduced-motion
  state select the still instead of keeping an inactive GIF mounted.

## Limitations

No Android emulator/ADB, iOS simulator/Xcode, or physical phone is available in
this container. Native bundles/build assets can be checked, but actual Android
and iOS GIF decoding, OS reduced-motion changes, splash handoff and native cold
startup timing still require phone checks. Signed-in/live checkout was not
executed: automated regression tests and guest cart hydration are the evidence
for unchanged session/cart/checkout behavior, not a claim of live payment
verification.

## Reproduce

Use a clean production-mode export of each source tree. Preserve `.npmrc` in
temporary baseline trees; invoke the installed Expo CLI directly rather than
bootstrapping pnpm through shared node_modules.

```sh
cd artifacts/uc-companion
EXPO_PUBLIC_PREVIEW_SAFE_MODE=1 EXPO_PUBLIC_DOMAIN=localhost:8098 \
EXPO_PUBLIC_API_DOMAIN=localhost:8098 NODE_ENV=production \
pnpm exec expo export --platform web --output-dir /tmp/uc-web --clear
cd ../..
node artifacts/uc-companion/scripts/measure-loading.cjs /tmp/uc-web /tmp/timings.json
node artifacts/uc-companion/scripts/check-page-loading.cjs /tmp/uc-web /tmp/checks.json
```

The clear-cache flag matters when changing Expo public environment variables.
Set `CHROMIUM_PATH` if the workspace's Chromium executable is located elsewhere.
Do not publish a fixture/isolated-preview export.