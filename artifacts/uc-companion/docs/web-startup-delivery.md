# Mobile web startup and resource delivery

## Scope and invariants

The web root can render before the four optional Inter weights load. Fonts use
`font-display: swap`; native splash readiness still follows font success, font
error, or the existing 600 ms budget. Auth, cart, query, notification routing,
deep links and tracking providers remain in the root layout.

The home, products and blog photo bands explicitly opt into eager/high-priority
loading. Other PhotoHeader uses remain lazy/low priority. Band heights, cropping,
brand-colour fallback, error fallback and the content panel are unchanged.

Native bundling and Expo Go manifests keep the existing Metro download path.
Browser packaging uses Expo's production web export and web-only asynchronous
routes. Native route imports remain synchronous. Exported resource URLs gain a
build ID without changing the router's path prefix.

Static resources support Brotli, gzip and identity responses. The build writes
compressed siblings; the server can stream compression for legacy files.
Only allowlisted timestamped public asset paths receive one-year immutable
caching. HTML, manifests, version metadata, arbitrary JSON and other paths use
`no-store`. Missing chunks return 404, including requests accepting HTML.

## Version pairing and rollback

Builds retain earlier timestamped directories. A successfully completed build
atomically replaces `static-build/active-build.json` after export, asset copying
and compression. HTML, version metadata and native manifests resolve from the
selected build. Legacy root manifests are preserved inside their originating
build before replacement. Legacy single-bundle releases still serve correctly.

For a rollback, atomically replace the active pointer with the previous build ID.
Retain the complete prior directory, including web chunks, native bundles,
assets, build metadata and platform manifests. Do not delete old assets merely
because the active pointer changed: already-open tabs can still request them.
For a fresh deployment, its release package must include the retained builds;
filesystem retention cannot preserve files omitted from that package.

The configured publishing command currently uses the independently frozen
Hydrate release archive. This work does not bypass or rewrite that release guard,
publish the app, or claim the published deployment contains these changes.
The approved release package must be reconciled before publication.

## Verification

Commands:

```sh
pnpm --filter @workspace/uc-companion test
pnpm --filter @workspace/uc-companion exec tsc --noEmit
pnpm --filter @workspace/uc-companion exec expo-doctor
CI=1 BASE_PATH=/uc-companion/ \
  EXPO_PUBLIC_DOMAIN=app.ucfilters.com \
  EXPO_PUBLIC_API_DOMAIN=api.ucfilters.com \
  CLERK_PROXY_URL=/api/__clerk \
  pnpm --filter @workspace/uc-companion build

# Against the generated artifact:
PORT=3010 BASE_PATH=/uc-companion/ \
  node artifacts/uc-companion/server/serve.js
CHROMIUM_PATH=/repl/tools/bin/chromium \
  node artifacts/uc-companion/scripts/verify-web-startup.mjs
```

The production build completed with 38 browser chunks and both native bundles.
TypeScript passed and Expo Doctor passed all 20 checks. The full test suite passed
555 tests; a subsequently added legacy-manifest retention test also passed with
the three delivery tests.

A real Chromium browser at 390×844 verified:

- Home content was visible while Inter responses were held back.
- Fonts subsequently loaded; the home photo band's rectangle stayed unchanged.
- Failed Inter requests did not prevent visible content or cause runtime errors.
- Home requested the runtime, common chunk, entry, two layouts and home route,
  not checkout/cart/rewards/admin route chunks.
- Products and Blog navigation fetched their deferred route chunks.
- Products, Blog, cart, sign-in and product-detail deep links rendered.
- The home image rendered at 390×128 with eager/high fetch priority.
- No page runtime errors occurred.

HTTP integration checks covered compression decoding, content type, encoding
negotiation, cache policy, HEAD responses, missing chunks, active-version switches,
old-chunk availability, matching native manifests and rollback.

The final local home script set totals 4,237,160 raw bytes, 887,825 bytes for the
Brotli siblings, and 1,026,188 bytes for the gzip siblings. These totals include
the large shared chunk, not just the entry file. An actual local HTTP request for
the entry returned Brotli, immutable caching, `Vary: Accept-Encoding`, and a
247,300-byte encoded body. These are local build/server observations, not
production transfer measurements or unused-code coverage.

## Measurement limits and release retest

No Lighthouse score, throttled mobile LCP, production trace, long-task analysis,
full CLS metric, or package-level unused-JavaScript coverage was measured.
The home header remains only an LCP candidate. Its fixed-height rectangle stayed
stable in the font check; that is not proof the whole page has zero layout shift.
Signed-in flows and physical native devices were not exercised; their providers
and native readiness behavior were preserved and covered by source/unit checks.

After publishing an approved package, measure cold and warm mobile loads on
representative devices/networks for home, products and blog. Record the actual
LCP element, resource discovery/loading/render delays, compression and caching
seen through the edge, initial/deferred script requests, interaction latency,
and font-swap layout shifts. Test authenticated cart/checkout/account navigation
and native Expo Go startup separately. Do not promise a specific score or timing
improvement from source or local byte counts.