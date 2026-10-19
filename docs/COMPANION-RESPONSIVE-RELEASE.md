# Companion responsive release

## Scope and repository provenance

This repository contains Companion (`artifacts/uc-companion`), ProjectHub
(`artifacts/projecthub`), and their API (`artifacts/api-server`). This change
targets Companion navigation, content sizing and release identification. The
separate agent orchestration source is not migrated into this repository.

The baseline is the downloaded ULTRA-APP Replit snapshot at
`70d51faa495fe6ebdf8980d71a18995b0f3da8a5`. The GitHub repositories found in
the Replit/Git configuration did not contain that revision: Ultra-AI-Team and
AI-Team-2 were older, Ultra-Build-HBD was empty, and Team-AI-Embedded was not
available. Agents contains the separate orchestration application. A new
private ULTRA-APP repository was chosen under the owner's authorization.

The import starts fresh history. It excludes local agent configuration,
generated static builds, node_modules test doubles, pasted attachments,
screenshots and test output. Original downloads are preserved locally.

## Behavior

| Window width | Navigation | Content |
| --- | --- | --- |
| Under 600 px | Bottom dock | Compact spacing; cards fit available width |
| 600–1023 px | 88 px side rail | Wider grids and four home actions |
| 1024 px and above | 216 px labelled sidebar | Bounded content and responsive grids |

Home, Products, Blog, Support, Map and Account come from one route registry.
Blog also participates in swipe navigation. Map keeps its own gestures.
Resizing keeps the same navigator mounted. Card counts account for the rail
and accessibility font scale. Cart spacing remains hydration-aware and
touch targets are at least 44 px where changed. Portrait locking is removed
and iPad support is enabled; native release testing is still required.

The custom production build writes build-info.json. The server exposes the
matching build ID, source revision and tab list at `/version.json`; HTML and
version responses use `no-store`. The edge router applies the same policy.
Timestamped bundle caching remains available. This helps detect and prevent
stale HTML retaining an older five-tab deployment.

## Validation on 2026-09-28

The dated validation below is reported by the external source branch's prior
validation record. It is not a current Replit test run; Replit verification is
limited to cheap static/script/config checks unless stated separately.

- 484 Companion regression tests passed, with zero failures or skips.
- Shared API client/Zod builds and Companion TypeScript checking passed.
- Expo production web export passed. Its JavaScript bundle is approximately
  4.9 MB uncompressed; this is not a measured loading-speed improvement.
- Local browser checks used a fixture API, not production customer data:
  390 × 844 bottom dock, 768 × 1024 rail, 1440 × 900 sidebar. Blog and Account
  navigation worked; tablet and desktop document widths matched the viewport.
- Node 24 test interop exposed a pre-existing AsyncStorage mock shape issue;
  mock operations now share the same implementation for both import shapes.
- A direct Babel preset dependency fixes a clean Expo build failure.

## Deploy and verify

1. Use Node 24 and pnpm 10.28.2. Install the frozen lockfile and pass the
   Companion checks workflow. Keep production secrets in deployment settings.
2. Configure the actual deployment/API domains and the existing Clerk public
   configuration. Do not deploy the fixture configuration used in CI.
3. Run the existing Companion `build` script for the timestamped `static-build`
   format used by `server/serve.js`. The CI Expo export is a web compilation
   check, not a replacement for this production artifact format.
4. Connect the chosen release commit to the current Replit deployment. Preserve
   the existing ProjectHub/API configuration and database. Deploy the updated
   Cloudflare router and invalidate previously cached Companion HTML if needed.
5. Check `/version.json` against the release commit and all six tab names, then
   verify every tab, deep link, product/cart flow and login on staging and live.
6. Test Android Chrome, a physical Android app build, rotation, safe areas,
   enlarged text and checkout with the actual API before promoting the release.

## Remaining limits

### Account freshness follow-up

Shared products, promotions, locations, ratings and editorial queries now
refresh every 60 seconds while active (background polling is disabled).
Queries also refresh on browser focus/reconnect; native AppState transitions
feed the query focus manager. This is eventual refresh, not an instantaneous
cross-device synchronization guarantee.

Rewards consumers, redemption and filter-registration updates use the same
customer-scoped cache key. Personal location ratings are now scoped to both
customer and location, with mutation invalidation bound to the initiating
customer. Other customers' balances and private ratings remain isolated.

The inspected source uses one DATABASE_URL connection pool. Live equality of
deployment database settings and multi-account write/read behavior still need
verification in the authenticated Replit deployment. The supplied project URL
currently returns an access-required 404 in the available browser session.
No schema migration, account merge, data backfill or production deployment has
been performed by this follow-up.

No production deployment or cache purge has been performed. The original
loading-time complaint needs before/after network measurements with the live
API. The web Map is still the source's location-list implementation; this
release does not add an interactive browser map or certify native map keys.
ProjectHub and the separate orchestration runtime have not been regression
tested in this Companion-focused change. Keep the pull request in draft until
the production build and device/API checks above are complete.
