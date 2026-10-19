# Linked offline registration — prepared, not published

## Scope and release boundary

Linked offline purchase visibility and registration use the persisted Companion
account link, not edited contacts. They do not manufacture an order, receipt,
payment, reward or recorded-impact entry. Registered cycles remain after source
edits/deletion. Retired unit identities stay consumed when quantities decrease.

The working preview is Metro. Production uses a separate frozen source archive.
The approved `release-sources.tar.gz`, release manifest and `.hydrate-release`
selection were **not changed**, and nothing was published.

The scoped candidate is reproducible with:

```sh
node infra/cloudflare/forest/prepare-offline-registration.mjs
cd .offline-filter-release/source
CI=1 pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck:libs
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/uc-companion typecheck
pnpm --filter @workspace/projecthub exec tsc --noEmit
```

This produces `.offline-filter-release/release-sources.tar.gz` and a
`candidate.json` with the baseline/candidate checksums and exact changed paths.
It preserves 1,231 unrelated frozen source files byte for byte. Existing whole-file
replacements are guarded by both archived-preimage and approved-source hashes.
Generated candidate files and dependencies are disposable and ignored by Git.

For the **development-host-only candidate used for verification**, build with:

```sh
cd .offline-filter-release/source/artifacts/uc-companion
EXPO_PUBLIC_DOMAIN="$REPLIT_DEV_DOMAIN" \
EXPO_PUBLIC_API_DOMAIN="$REPLIT_DEV_DOMAIN" \
BASE_PATH=/ METRO_PORT=0 NODE_ENV=production GOMAXPROCS=2 \
node scripts/build.js
cd ../../../..
node infra/cloudflare/forest/verify-offline-registration-candidate.mjs
```

Run the verifier from the workspace root (after the build, return there).
Do not publish the development-host build. An approved future release must
select the candidate through the existing frozen-package release procedure and
rebuild it with that procedure's production domains. Preview restarts do not
activate this candidate in production.

## Evidence

- API, Companion, ProjectHub and shared-library typechecks passed, including
  all three applications in the frozen-source candidate.
- 26 isolated API checks passed: provisioning and historical reads, edit/add/
  reorder/quantity changes, delete/history preservation, owned-source checks,
  retries/concurrency, privacy, and existing app/store ownership rules.
- Account render regression passed for assignment ID/account ID `4`, namespaced
  sibling keys, account switch remounts, and opening the existing Register Filter.
- Signed-in Expo **web** journey passed with an inert synthetic linked sale:
  explicit sale label/product/quantity/date, custom-product explanation,
  installation confirmation, successful registration and refresh. One durable
  filter, no order/reward/recorded-impact rows. Fixtures were removed.
- iOS and Android production-mode candidate bundles built. The verifier fetched
  the candidate server's selected manifests and launch assets, compared their
  served bytes to prepared files, and checked key namespaces, purchase reads,
  installation UI and restore-registration markers. Web entry was served too.
- The candidate test build was `1791147301193-8630`. iOS launch asset SHA-256:
  `6fcfc5b94b7b2c00824d384da66fdb8516f28ac883dd6e0ef9897d2196916cf0`.
  Android: `59c4bf28372dd6faed2b276664019ab807f93a4d99b48112b56716de5905884b`.
- Current legacy/migrated release-selection, manifest-serving and retained-build
  regression checks passed. Expo Doctor passed 20/20; startup-font checks passed.

## Explicit limits

Physical Expo Go/device interaction was not available. Served native bundle
verification is **not** evidence that a particular phone refreshed its cache.
The signed-in browser reported an existing stray-text-node warning and platform
prop/deprecation warnings; the changed journey still completed. Broader runtime
observability/recovery work is separate.

The full mobile suite had 901 passing and three unrelated failures:

- `checkout.tsx hydration guard`: early-spinner source tripwire.
- `review, support, and Alison events include only successful outcomes and safe dimensions`.
- `every assessment, booking and verification TextInput has a persistent accessible name`.

No claim is made that the entire existing mobile suite is green.

## Restart/update instructions

For the development preview, the API and Expo workflows are running with this
source. Close the old Expo Go experience, reopen it using the **current workspace
QR code**, then open Account and refresh Offline purchases. If already attached
to that workspace Metro session, use Expo Go's Reload. Do not use a saved
production/frozen launch QR and expect a preview restart to update that package.

On web use the Expo artifact's own domain, not the shared `/uc-companion/` proxy
URL. A cold Metro bundle can take longer than a five-second browser timeout.

Existing active registrations can restore reminders on the current device using
their original installation date; that retry keeps the server cycle and
maintenance history. Removed/deleted purchase sources cannot create a new
registration, but their existing server filter history is retained.