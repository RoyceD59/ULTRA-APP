# Phone-validation payload reduction

## Boundary and approach

Companion registration, account editing, water-check and checkout use the
shared instant-water identity helpers. `CountryPicker` uses the shared phone
country list. The API's canonical customer identity and COD validation use
the same shared phone normalizer.

The installed `libphonenumber-js` public entrypoints are barrels: root, min,
max, mobile, core, and their supported `/es6` variants. They do not expose
public per-function subpaths. Root already uses worldwide `metadata.min`;
switching to max/mobile metadata changes validity behavior, and switching to
another barrel alone still includes AsYouType under the current Metro setup.

Instead, `lib/api-zod/scripts/generate-phone-runtime.mjs` bundles three exports
from the **public root API** with esbuild's stable tree shaking. Only this
facade is optimized; no private package paths, guessed country rules, metadata
subsets or unstable app-wide Metro tree shaking are used. The generated
`phone-runtime.js` is committed, contains the upstream MIT license and retains
the exact installed worldwide min metadata. Its declaration uses upstream
types. Both shared helpers import it; the country type remains type-only.

Generation rejects retained AsYouType/search/matcher modules and missing min
metadata. `check:phone` compares deterministic output with the installed
dependency; root `typecheck:libs` runs this freshness gate so a dependency
upgrade cannot silently keep an old facade.

## Paired web measurements

Use the commands below with the pre-change tree for the before export and
the changed tree for the after export. Both exports have the same production
settings, source maps and benchmark-only preview-safe mode. Builds and the
two benchmark passes run sequentially. Measurements use local API fixtures,
390 × 844 viewport, three fresh browser contexts per condition. The slow
condition delays API fixtures 1,800 ms and fonts 2,000 ms; it is **not**
device CPU or mobile-network emulation.

| Initially requested scripts | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Raw bytes | 3,811,489 | 3,701,566 | 109,923 (2.88%) |
| gzip estimate | 898,503 | 876,611 | 21,892 (2.44%) |
| Brotli estimate | 777,507 | 759,682 | 17,825 (2.29%) |

Compression uses level/quality 9, not measured live edge transfers.
`profile-web-payload.cjs` finds 476,300 upstream phone source bytes before.
Afterward it finds the 122,944-byte generated facade under **workspace**, not
under the upstream package. Those source totals are not an apples-to-apples
minified-byte comparison: the facade is already minified. Actual script bytes
above establish the saving.

All nine distinct AsYouType/matcher module names present in the before maps
are absent from **every** after web chunk map, including deferred checkout and
registration chunks. The generator confirms 46 contributing upstream modules
remain. Ordinary formatting needed by the upstream PhoneNumber implementation
is not removed; only unused formatter/search machinery is excluded.

| Median milliseconds | Before normal | After normal | Before delayed | After delayed |
| --- | ---: | ---: | ---: | ---: |
| Startup script time | 310.729 | 302.916 | 268.560 | 254.116 |
| Startup JS task time | 608.382 | 547.344 | 504.945 | 501.733 |
| Full journey script time | 730.269 | 564.379 | 592.221 | 605.901 |
| Full journey JS task time | 1,445.586 | 988.773 | 1,143.335 | 1,157.678 |
| Home usable | 888 | 1,143 | 739 | 1,165 |
| Home product visible | 954 | 1,148 | 2,543 | 2,986 |

Startup script/task medians decreased, but Home wall-clock time increased and
the delayed full-journey timing varied. The accepted result is the reproducible
payload/graph reduction, **not a claim of faster real-device startup**.
All twelve browser benchmark journeys completed with no page errors.
Raw run values, initial script inventories and phone source inventories are
in `phone-payload-measurements.json`.

## Regression coverage

`pnpm --filter @workspace/api-zod test:phone` runs six regression tests:

- Every supported country/calling code, launch-country ordering, lookup by
  code/name and placeholders.
- Differential checks against the original public parser for all upstream
  mobile examples (over 200 valid worldwide cases) and ten variants per
  country. Both global and instant-water normalizers are checked, with and
  without selected countries.
- Exact priority-market, Kenya 01-prefix, global and national-format outputs.
- Impossible versus possible-but-invalid numbers, invalid characters,
  extensions, excess length, malformed input, selected-country mismatch and
  shared +1 calling-code disambiguation.
- Legacy Kenya-default instant submissions, Kenya-only schemas and canonical
  customer identity refusing guessed local numbers.
- Checkout country-name resolution, exact normalized transport and rejection
  of invalid shipping numbers.

The same tests passed before changing the imports and after the facade switch.
Shared-library, Companion and API typechecks passed.

The existing global-phone, instant-water security and COD-order suites passed
all 50 tests against an isolated test database, which was removed afterward.
Android and iOS production Hermes exports both passed. Their source maps retain
the facade and contain no AsYouType or PhoneNumberMatcher modules. Export
success is not a claim of physical-phone usability.

After restarting the API and Companion workflows, the public registration
preview rendered the form and Kenya/+254 selector. Existing development
warnings remain: the optional React Native DevTools desktop binary lacks a
system library, and registration emits empty text-node warnings. Neither
warning comes from the generated parser; this task did not change the form JSX
or development debugger setup.

## Reproduce

```sh
pnpm --filter @workspace/api-zod generate:phone
pnpm --filter @workspace/api-zod test:phone
pnpm run typecheck:libs
pnpm --filter @workspace/uc-companion typecheck
pnpm --filter @workspace/api-server typecheck

cd artifacts/uc-companion
CI=1 NODE_ENV=production EXPO_PUBLIC_PREVIEW_SAFE_MODE=1 \
  EXPO_PUBLIC_DOMAIN=localhost:8098 EXPO_PUBLIC_API_DOMAIN=localhost:8098 \
  pnpm exec expo export --platform web --source-maps --clear \
  --output-dir /tmp/uc-phone-after
node scripts/measure-loading.cjs /tmp/uc-phone-after /tmp/uc-phone-after-timings.json
node scripts/profile-web-payload.cjs /tmp/uc-phone-after \
  /tmp/uc-phone-after-timings.json /tmp/uc-phone-after-profile.json

CI=1 NODE_ENV=production pnpm exec expo export \
  --platform android --platform ios --source-maps --clear \
  --output-dir /tmp/uc-phone-native

cd ../api-server
TEST_GLOB='src/tests/{global-phone,instant-water-check-security,cod-order-validation}.test.ts' pnpm test
```

Do not publish benchmark-safe builds or source maps. No production release,
customer data, authentication, checkout UI, native settings or library version
was changed.