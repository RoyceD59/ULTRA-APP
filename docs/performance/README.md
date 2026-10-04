# Companion catalogue speed and startup evidence

Measured 2026-10-04. Implements the speed work in
[`../reports/companion-usability-cms-speed-2026-10-02.html`](../reports/companion-usability-cms-speed-2026-10-02.html).
**No production deployment, commerce submission, customer sign-in, CDN change,
or customer-data cache was performed.**

## Baseline and provenance

Canonical browser origin: `https://app.ucfilters.com`. The deployment lookup
confirmed a public successful Replit deployment; its generated alias is not
used as a substitute for the canonical browser baseline. Browser resource
records show that the published client reads `https://api.ucfilters.com`.
Both public API delivery paths are recorded separately.

The published page reports build `1791066251025-340` and still requests a
monolithic bundle. A fresh compressed HTTP download returned 1,190,734 bytes
(4,810,710 decoded bytes). Compression already works; no compression or CDN
configuration was changed. This is a different sample from the audit's
1,177,441-byte sample, not a regression attribution.

The first six canonical catalogue HTTP samples, taken before code changes:
5,806 / 1,742 / 1,706 / 1,707 / 1,739 / 1,659 ms. Fresh sequential reads do not
prove that the CDN or WooCommerce process was cold. The first call is reported
separately rather than averaged into a claimed warm improvement.

Raw evidence:

- `companion-canonical-baseline.json`: three fresh Chromium contexts per
  profile; cold then same-context warm navigation for Home, catalogue, blog,
  and guide list. **Exclude the initial `/product/3118` samples**: that was not
  the selected catalogue product. They remain in the raw record rather than
  being relabelled as successful product measurements.
- `companion-canonical-product-baseline.json`: corrective, real catalogue
  product `/product/10170`; one cold/warm pair per profile.
- `companion-canonical-guide-baseline.json`: bundled Survivor Straw guide
  detail, one cold/warm pair per profile. The published guide API currently
  returns an empty list; bundled guide delivery and published CMS delivery are
  therefore different evidence.
- `companion-canonical-http.json`: ten HTTP reads and first-image samples.
  Its first run intentionally did not resize uploaded images; that exposed
  one 959,810-byte original. Use the responsive record below for size targets.
- `companion-canonical-responsive-http.json`: existing product and upload
  derivatives at 384/768 px, first image of all 27 products in that sample.
- `companion-published-api-http.json`: repeated reads from the API hostname
  actually requested by the published browser.
- `companion-workspace-http.json`: the updated API, real WooCommerce reads,
  through the workspace proxy; 26 products in that provider response. Different
  live counts/builds are not evidence of truncation or a like-for-like dataset.
- `companion-workspace-startup.json` and `companion-workspace-payload.json`:
  production-mode web export, fixture API, isolated preview authentication,
  six startup samples and source-map inventory. This export was not activated
  or published.

The local startup specimen was captured before the final integration of parallel
customer-only API imports and unused-font work. Its byte totals and timings are
historical baseline evidence, not a measurement of that combined source tree.
Their separate paired measurements are in
[`../../artifacts/uc-companion/docs/loading-verification.md`](../../artifacts/uc-companion/docs/loading-verification.md).

Browser profiles: Chromium, 390 × 844 viewport; ordinary workspace network/CPU
and a CDP simulation with 4× CPU slowdown, 150 ms latency, 1.6 Mbps download,
750 Kbps upload. These are **not agreed physical low-end Android/iPhone
profiles**, Safari measurements, native cold launches, or field Core Web Vitals.
Cold means a fresh browser cache, not forced server/CDN cache eviction. Warm
means returning to the route in the same browser context. Observation windows
are 7/18 seconds; delayed resources can make a result right-censored.

Home is first in each fresh context. Other routes' first visits follow Home
and can reuse shared scripts/fonts, so their `cold` phase labels are not
independently cold app launches. The supplemental product and guide contexts
start directly on those routes. Navigation uses document loads, not tab taps.

Canonical lab median LCP (milliseconds; three samples per cell unless marked
single-pair):

| Route | Ordinary first/warm | Slow first/warm |
|---|---:|---:|
| Home | 4,612 / 2,760 | 11,640 / 4,676 |
| Catalogue, after Home | 2,340 / 2,188 | 5,344 / 4,344 |
| Blog, after Home | 268 / 172 | 960 / 1,316 |
| Guide list, after Home | 204 / 148 | 1,480 / 1,056 |
| Product 10170, single-pair direct entry | 2,576 / 1,720 | 11,544 / 17,000 |
| Survivor guide, single-pair direct entry | 1,276 / 244 | 8,256 / 2,120 |

Home's ordinary first/warm median script execution is 737/428 ms; slow
4,231/2,634 ms. Median lab CLS for the four repeated routes is 0.0005–0.0897;
that range does not establish a field percentile. Their median request counts
are 15–26. The published API hostname's ten read samples have median 1,821 ms
and an empirical nearest-rank p95 of 3,276 ms. Such a small sample is not a
load-test or an SLO confidence interval.

The live browser reports `A network error occurred.` even while content renders.
The resource records include failed/empty versioned font paths and production
logs show Clerk proxy 400 responses. These are observed blockers, not a proven
single root cause or a reason to modify production auth during this task.
Canonical LCP results must not be labelled a clean reliability pass.

## Selected implementation

### Catalogue

Cache only normalized, published-provider catalogue rows in API process memory:

- 30-second TTL; 64 retained variants; 16 MiB serialized-JSON retention budget;
  maximum eight simultaneous distinct refreshes. Oversized complete responses
  are returned intact but not retained.
- Keys use trimmed category/search inputs. Identical in-flight reads share one
  provider load. This does not replace WooCommerce search with a semantically
  different local search.
- Complete, sequential 100-row pagination remains capped at 50 pages. Hitting
  the safety bound, a later-page error, or non-2xx upstream response returns an
  explicit failure, never a successful partial/empty catalogue.
- One 12-second provider budget covers category discovery and all product
  pages. Failed refreshes are not cached and never use expired catalogue rows.
- Staff product and inventory updates invalidate the catalogue after successful
  WooCommerce writes. Generation protection prevents an older in-flight load
  repopulating the invalidated cache. External WooCommerce changes expire by TTL.
- Media overrides remain outside the cached provider rows, so staff media edits
  do not wait for the provider cache. All `/uc/products` responses are
  `Cache-Control: no-store`; customer/session responses are not publicly cached.
- `Server-Timing: catalogue` and `X-UC-Catalogue-Cache: miss|hit|shared` make the
  provider/cache span observable. Home and catalogue retain their shared query
  key; their browsing staleness is shortened from five minutes to 30 seconds.
  Existing debounce, abort propagation, saved-data refresh warnings and explicit
  retry states remain in place.

Price/stock remain WooCommerce-owned. Product detail, checkout/order provider
reads and customer data do **not** use this cache. A browsing snapshot is not
transaction authority. No client-submitted prices were made authoritative.

The live-provider workspace miss was **1,697 ms**, of which the catalogue span
was **1,614 ms**; median of the next nine hits was **5.87 ms**. This supports
prioritizing provider-read reuse over UI decoration or CMS replacement.
It is a same-process workspace measurement, not a production network comparison.

### Startup

Reuse existing Expo Router web chunk splitting, version-paired export resources,
precompression, direct icon-family imports and startup scripts. Native routing
remains synchronous. Do not enable unstable Metro graph optimizers or delay root
auth/cart providers without separate readiness evidence.

Fresh source-map profiling identifies framework/rendering/navigation dependencies
as the largest common graph costs. Generated team API/schema code and phone
formatting are also in that graph; their separate assigned reductions should be
evaluated against this recorded specimen, not duplicated here.

The complete initial requested script set is **3,821,502 raw bytes**, **900,601
gzip-estimated bytes**, **779,744 Brotli-estimated bytes**, not just `entry.js`.
Compression estimates are not actual edge transfers and cannot be directly
compared to the published zstd transfer.

Recorded specimen fixture medians (milliseconds):

| Metric | Ordinary | Delayed fonts/API |
|---|---:|---:|
| Home greeting/navigation rendered | 1,380 | 1,100 |
| Home product content | 1,501 | 2,897 |
| Catalogue content after Home | 415 | 857 |
| Blog content | 374 | 2,347 |
| Warm Home return | 66 | 68 |

Three runs per condition. The delayed condition adds 2,000 ms to fonts and
1,800 ms to API responses, not bandwidth/CPU emulation. The counterintuitive
ordinary/delayed greeting difference illustrates container variability; it is
not a claimed improvement. Median initial `ScriptDuration` is 311/213 ms.
That is browser script execution work, not an isolated parser measurement or
native launch time. All six fixture samples record zero page exceptions.

### Media and published content

Reuse existing width-bucketed WebP derivatives, fixed layout dimensions and
deferred media. No duplicate resizer, content snapshot store or public customer
cache was introduced. Eligible WooCommerce images already normalize to the
resizing proxy; uploaded product images already use the upload derivative path.

Published blog/guide responses now have ETags and
`public, max-age=30, must-revalidate`; the old five-minute
stale-while-revalidate extension is removed. Visible client reads have a
30-second freshness/poll interval, with background polling disabled by the
existing query defaults. The combined HTTP/client budget is at most about
60 seconds **plus network/processing latency**, while connected and active.
Inactive/offline clients are not promised this window. Draft isolation and
published snapshots remain unchanged; failed editorial revisions do not
replace live snapshots. Conditional blog and guide reads returned 304 in tests
and workspace HTTP checks. No production publish was used to test this.

## Named target register

| Report target | Evidence and status |
|---|---|
| LCP ≤2.5 s | Canonical lab observations recorded per route/profile. Not an achieved field/physical-device target; live errors and slow-profile results remain blockers. |
| INP ≤200 ms | **Not established.** Passive startup observations contain no representative interaction sample. Do not label an empty event array as zero INP. |
| CLS ≤0.1 | Per-route lab observations recorded; not a field percentile or blanket route pass. |
| ≥30% lower initial transfer/parse cost | **Not established/goal remains open.** Split-export inventory and execution timings are available; same-codec estimates are below 30% reduction from the published monolith. No parser-only, native or post-publish comparison is claimed. |
| ≥50% lower warm catalogue response latency | **Met in workspace scenario:** 1,697 → median 5.87 ms (>99%); controlled 101-row scenario 116.6 → 3.44 ms (~97%). Not deployed evidence. |
| ≥80% fewer repeated upstream reads | **Met in controlled scenario:** ten identical requests for 101 products use two page reads instead of twenty: 90% reduction. Concurrent cache tests also share one load. |
| Median catalogue image ≤150 KB | **Met for sampled responsive first images:** 27 canonical images at 384 px, median 3,624 bytes. |
| Main image ≤250 KB | **Met for sampled first images:** at 768 px, maximum 47,504 bytes (median 9,158). Other gallery images, high-DPR >768 px, and original-byte fallback are not universally certified. |
| Publishing visible within proposed ≤60 s | HTTP/client freshness configuration and ETag behavior verified; active connected visibility budget excludes network time. No controlled live publish or CDN guarantee claimed. |

Process-local caches warm independently on autoscaled replicas. The 90% scenario
does not promise 90% fewer reads across multiple replicas or after cold restarts.

## Verification and outstanding gates

- API focused suite before integration: **28/28 passed**, covering cache sharing/expiry/size bounds,
  invalidation races, complete pagination and later-page failures, published
  product provenance, guide snapshot validators and blog draft isolation.
  Post-integration cache checks: **6/6 passed**, including preserving the active
  provider-request bound across repeated invalidations.
- Companion specimen suite: **630/630 passed**; API and Companion TypeScript
  passed after rebuilding merged shared-library declarations. The first final
  validation also exposed a provenance test that swapped provider fixtures
  without expiring the previous valid snapshot; its cache isolation was corrected,
  preserving all published/private provenance assertions.
- Fresh production-mode web export/source maps and six fixture startup runs
  passed. Existing native module graph/build settings were not changed.
- Workflows restarted after code changes; API serving; catalogue preview at
  390 × 844 renders navigation, filters, explicit basket state and 27 products
  without page exceptions. Normal development warnings are not release scores.
- Physical Android/iPhone baseline, representative INP, production font/auth
  reliability and post-release canonical speed targets remain **unverified**.
  The existing physical-device usability work must include the startup evidence
  below; browser simulation cannot close that gate.
- No payment/order/customer mutation journey was exercised. No new production
  release is authorized by this report.

## Reproduction

```sh
# Public, read-only canonical baseline; optional route list and run count.
node artifacts/uc-companion/scripts/measure-canonical.cjs \
  https://app.ucfilters.com docs/performance/new-canonical.json
node artifacts/uc-companion/scripts/measure-catalogue-http.cjs \
  https://api.ucfilters.com docs/performance/new-api.json --no-media

# Production-mode local specimen only; do not publish or activate this export.
cd artifacts/uc-companion
CI=1 NODE_ENV=production EXPO_PUBLIC_PREVIEW_SAFE_MODE=1 \
EXPO_PUBLIC_DOMAIN=localhost:8098 EXPO_PUBLIC_API_DOMAIN=localhost:8098 \
EXPO_NO_BUNDLE_SPLITTING=0 UC_WEB_EXPORT_BASE_PATH= \
pnpm exec expo export --platform web --output-dir /tmp/companion-speed-export \
  --source-maps --clear
cd ../..
node artifacts/uc-companion/scripts/measure-loading.cjs \
  /tmp/companion-speed-export /tmp/startup.json
node artifacts/uc-companion/scripts/profile-web-payload.cjs \
  /tmp/companion-speed-export /tmp/startup.json /tmp/payload.json
```

Leave the root fixture export's base URL unset: an explicit `/` caused SDK 57
to emit `//assets/...` URLs interpreted as a hostname. The initial failed
fixture run was diagnosed and replaced, not counted as a passing speed sample.
Real packaging retains the artifact's prefix and version-paired resource URLs.

For physical measurements, first record actual phone model, OS, browser/native
runtime, app/build ID, network condition and signed-out state. Record at least
five force-closed launches and five warm returns for Home → catalogue → selected
product → blog → guide. Separate launch-to-navigation, launch-to-content, JS
execution/profile work, HTTP latency and media bytes. Native Expo Go timings
must not be labelled release-binary startup. Use read-only actions; do not place
orders or alter customer accounts. Collect representative typing/navigation
interactions for web INP and record LCP/CLS using the browser trace. Repeat after
an explicitly approved release on the same devices/network/build paths, checking
complete products, changed prices/stock, provider errors and published snapshot
freshness before attributing improvements.