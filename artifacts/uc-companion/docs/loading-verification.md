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

## Initial JavaScript reduction (2026-10-04)

### Current baseline and framework options

The earlier 4.9 MB monolithic entry above is historical, not the baseline for
this change. The current SDK 57 app already uses Expo Router
`asyncRoutes: { web: true, default: false }` and the production web exporter
already emits split chunks. Native routes remain synchronous. Lazy tabs control
mounting/data work; they do not remove modules from the initial common chunk.

Installed Expo CLI 57.0.27 enables production web chunk splitting unless
`EXPO_NO_BUNDLE_SPLITTING` is enabled. The installed CLI also offers
`EXPO_UNSTABLE_TREE_SHAKING` together with the required
`EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH`. Those are explicitly unstable, graph-wide
changes, so neither was enabled. Manual lazy-loading of root providers would
introduce readiness/authentication risks and was not used. No Router, Metro,
delivery, build activation, impact API, or Cloudflare configuration was changed.

### Profile and selected reduction

Production exports with source maps plus actual Home script requests identified
six initial scripts: runtime, common, entry, root layout, tab layout, Home.
The common chunk was 3,079,546 raw bytes before the change.

Source-map inventory (source bytes, **not** attributed minified bytes):

| Initial graph group | Source bytes before | Assessment |
|---|---:|---|
| Expo Router | 1,200,022 | Navigation/framework; retained |
| Reanimated | 759,246 | Shared navigation/UI dependency; retained |
| React Native Web | 738,691 | Rendering framework; retained |
| Expo vector icons | 575,044 | Broad barrel imports included 17 glyph/metadata maps |
| React DOM | 545,403 | Rendering framework; retained |
| libphonenumber-js | 476,300 | Identity/phone validation; retained |
| Gesture Handler | 374,106 | Shared interaction dependency; retained |
| Generated workspace API module | 423,134 | One large generated module; retained |
| Generated API schema module | 88,309 | Shared generated exports; retained |

Every runtime icon import now uses the package's public family entrypoint
(`@expo/vector-icons/Ionicons` or `/Feather`). The installed entrypoints export
the exact same components as the barrel; names, glyphs, sizes, fonts and JSX are
unchanged. No delayed imports, new network requests, or provider boundaries were
introduced. This also applies to native-only screens. Test-only aliases were
updated to preserve the existing lightweight Node component harness.

Afterwards, the common chunk is 2,649,437 raw bytes. Only Ionicons and Feather
glyph maps remain in the initial graph; icon source bytes fall to 55,513.
The root layout gains the small Feather dependency previously shared through
the barrel. The following totals include **all six initial scripts**, not just
entry.js.

| Initial JavaScript | Before | After | Reduction |
|---|---:|---:|---:|
| Raw | 4,237,717 B | 3,813,197 B | 424,520 B (10.0%) |
| gzip level 9 estimate | 1,028,400 B | 897,275 B | 131,125 B (12.8%) |
| Brotli quality 9 estimate | 889,299 B | 776,962 B | 112,337 B (12.6%) |
| Initial script requests | 6 | 6 | No additional request |

### Local timing results

Same local fixture method as above, three fresh contexts per condition.
Measurements were made sequentially before/after using the same updated harness.
The baseline timing run overlapped the unit-test process; container load and
deferred-route scheduling mean these timings **do not establish a CPU speedup**.
The byte reduction is deterministic; the timings check for obvious navigation
regressions. The slow condition still delays fonts by 2,000 ms and APIs by
1,800 ms, without CPU/bandwidth throttling.

| Median, milliseconds | Before normal | After normal | Before slow | After slow |
|---|---:|---:|---:|---:|
| Home usable | 1,158 | 742 | 1,083 | 1,055 |
| Home product content | 1,165 | 789 | 2,887 | 2,849 |
| Products after Home | 845 | 410 | 834 | 856 |
| Blog | 849 | 855 | 2,358 | 2,355 |
| Warm Home return | 65 | 57 | 61 | 65 |
| Startup ScriptDuration | 275 | 202 | 200 | 196 |
| Startup TaskDuration | 557 | 421 | 398 | 378 |
| Journey ScriptDuration | 533 | 435 | 528 | 503 |
| Journey TaskDuration | 1,008 | 843 | 986 | 970 |

Startup CDP metrics are captured when the Home greeting is visible; journey
metrics are captured after Home → Products → Blog → Home. Compression calculations
run only after the timed journey. Encoded sizes are local estimates, not real
edge transfer sizes. The initial script list is snapshotted before later tabs.

Raw evidence: `payload-before-timings.json`, `payload-after-timings.json`,
`payload-before-profile.json`, `payload-after-profile.json`, and
`payload-browser-checks.json`. Saved profiles list the top 20 source modules per
chunk; the profiler itself emits the full inventory.

### Verification and boundaries

- TypeScript passed after the final test-alias changes.
- Companion suite: 611 tests passed, including session/account isolation,
  catalogue, cart, checkout/payment and native reconnect contracts.
- Android and iOS production Hermes exports passed; both remain single native
  bundles, not asynchronous native route exports.
- Production web export passed. Browser fixture checks passed at 320 px and
  1,440 px: slow/error/empty content, retries, reduced motion, failed photographs,
  guest cart hydration, warm shared catalogue cache, and failed background
  refresh retaining product cards. Two stale error-copy selectors in the
  existing verification script were updated; application copy was not changed.
- The import guard rejects icon barrel imports anywhere in runtime source.
  It also checks the installed direct entrypoints match the barrel components.
- Products and Blog still load their deferred routes. Startup has no checkout,
  cart, rewards or admin route script request.
- Restarted development Metro bundled successfully. The live preview rendered
  Home, icons and tab navigation without a JavaScript exception. The API workflow
  was stopped, so optional content displayed explicit retry states for 502
  responses. React Native DevTools could not install because the container
  lacks `libglib-2.0.so.0`; that did not prevent Metro or the web app from running.

No fonts were added/removed by this work. No live checkout, physical-phone
startup timing, production publication or Cloudflare/impact changes were made.
Native export success is not a claim of on-device usability. Authentication
providers remain mounted exactly as before; benchmark exports alone use the
existing isolated-preview flag.

### Reproduce the payload profile

Use the same source/dependencies/public environment for each export; export the
pre-change tree separately to compare. Do not serve `.map` files publicly or
publish an isolated-preview benchmark build.

```sh
cd artifacts/uc-companion
CI=1 NODE_ENV=production EXPO_PUBLIC_PREVIEW_SAFE_MODE=1 \
  EXPO_PUBLIC_DOMAIN=localhost:8098 EXPO_PUBLIC_API_DOMAIN=localhost:8098 \
  pnpm exec expo export --platform web --source-maps --clear \
  --output-dir /tmp/uc-payload
node scripts/measure-loading.cjs /tmp/uc-payload /tmp/uc-payload-timings.json
node scripts/profile-web-payload.cjs /tmp/uc-payload \
  /tmp/uc-payload-timings.json /tmp/uc-payload-profile.json
node scripts/check-page-loading.cjs /tmp/uc-payload /tmp/uc-payload-checks.json
CI=1 NODE_ENV=production pnpm exec expo export \
  --platform android --platform ios --output-dir /tmp/uc-native --clear
```