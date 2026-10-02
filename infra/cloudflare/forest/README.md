# Hydrate the Future forest release

Source design: `RoyceD59/ULTRA-APP`, branch `claude/reforestation-ltv-integration-t16xhc`,
revision `403b840fffb91de278d788dfdf51f08e09bfb202`.
Destination approved by the owner: a new `release/hydrate-the-future` branch in
`RoyceD59/ULTRA-APP`, with a pull request, no protected-branch merge.

## Static package

Run from the repository root:

```sh
node infra/cloudflare/forest/build.mjs
node --test infra/cloudflare/forest/*.test.mjs
```

`FOREST_API_BASE` defaults to the existing public API origin `https://api.ucfilters.com`.
For staging, supply a credential-free HTTPS origin. The package contains only
`index.html`, `404.html`, `programme-status.json`, and `_headers`. The supplied canvas
design is retained. There is no GitHub redirect, API runtime, account data, repository
browser, build tooling or secret in the package.

Cloudflare account: `c6ef5ecddd874fc1891f829f9c6e2ba7`. Pages project:
`uc-hydrate-forest` (direct upload; production branch `main`). Authenticated deployments
use the Cloudflare connection or the documented Wrangler Pages CLI with the
configuration in this directory. Keep any deployment credentials in the workspace
secrets or CI secrets, never in files or command-line arguments.

Preview deployment only (requires authenticated Wrangler):

```sh
node infra/cloudflare/forest/build.mjs
pnpm dlx wrangler@4 pages deploy artifacts/uc-companion/forest-dist \
  --config infra/cloudflare/forest/wrangler.jsonc \
  --project-name uc-hydrate-forest --branch release/hydrate-the-future
```

Never omit `--branch` during a preview: a default production branch can publish live.
Production uses `--branch main` only after explicit approval. DNS/custom-domain setup
is separate and also requires approval. Proposed hostname: `forest.ucfilters.com`.
Do not modify the existing app, hub or API DNS records.

## Data and privacy

The public aggregate is `GET /api/uc/impact/forest`; it requires no credentials.
Both Express and the Cloudflare API router permit credential-free CORS only for
this exact read endpoint. No private API origin permissions are widened.
The customer's own endpoint is `GET /api/uc/customer/tree`; it uses the existing
DB-backed active-customer gate, rejecting team sessions and deleted customers.

Eligible funding comes only from paid, customer-linked KES canonical purchases
not cancelled, failed or refunded. Logged refills never add funding.
Programme allocation is **3%, split equally between trees and clean-water access**.
Historic unmatched purchases are not guessed or relinked. Baseline revenue defaults
to zero and must only be configured with documented, nonoverlapping eligible sales.
No fabricated lifetime-value benchmark, partner, donation date or field count is
published. Programme status fields stay null/pending until confirmed by the team.
When the API is unavailable, amounts are pending, not assumed zero or demo totals.

Links contain only a device-generated, per-account anonymous ID and a supported
digital growth stage. They convey illustrations, not independently verified field
status. They are not certificates, donation receipts, carbon credits or offsets.
Account switches remount local tree state. The link builder rejects non-HTTPS
or credentialed URLs and discards all preconfigured query/hash values.

## Approved release order (not executed during preview)

1. Confirm production approval, hostname and a release window.
2. Publish only the required backend/Companion release via the existing release
   process, with `EXPO_PUBLIC_FOREST_URL` set for that release. Do not publish unrelated
   workspace changes. Migration `0056_uc_hydrate_trees.sql`, matching Drizzle schema and
   idempotent startup DDL add two tables; there is no drop or data rewrite.
3. Confirm the production aggregate returns valid JSON without auth and the private
   tree endpoint still rejects guests, team sessions and deleted customers.
4. Update the existing `ucfilters-host-router` with the narrowly scoped forest CORS
   change; retain its existing routes and all other permissions. Verify actual GET
   and OPTIONS through `api.ucfilters.com`.
5. Publish the exact tested static package to Pages production. Attach the approved
   custom domain and add only its required DNS record. Verify HTTPS, root HTML,
   programme JSON, 404, live totals and the card's anonymous link.
6. Record final deployment IDs, source/release revisions, URLs and check results.

## Rollback

Hide the forest CTA by removing the production `EXPO_PUBLIC_FOREST_URL` and rebuilding
the Companion release, or restore the previous Companion release. Restore the previous
API and Cloudflare router versions if needed. Pages can be rolled back to its prior
successful production deployment; for the first release, detach only the new forest
hostname/DNS record if withdrawal is necessary. Do not drop allocation tables or erase
contribution history: additive tables are safe to leave during rollback.

## Preview evidence and remaining release gate

Pages preview: `https://907751d8.uc-hydrate-forest.pages.dev/`
(branch alias: `https://release-hydrate-the-future.uc-hydrate-forest.pages.dev/`).
Deployment environment is **preview**, not production.
The production endpoint/router are unchanged until approved; therefore production
live-totals validation is a release gate, not a preview pass.
Native device checks must be reported separately from web/unit/build checks.