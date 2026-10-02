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

## Approved release order

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
5. Publish the exact tested static package to Pages production. Custom-domain/DNS
   attachment is deferred until certified data is available and separately approved. Verify HTTPS, root HTML,
   programme JSON, 404, live totals and the card's anonymous link.
6. Record final deployment IDs, source/release revisions, URLs and check results.

## Rollback

Hide the forest CTA by removing the production `EXPO_PUBLIC_FOREST_URL` and rebuilding
the Companion release, or restore the previous Companion release. Restore the previous
API and Cloudflare router versions if needed. Pages can be rolled back to its prior
successful production deployment; for the first release, detach only the new forest
hostname/DNS record if withdrawal is necessary. Do not drop allocation tables or erase
contribution history: additive tables are safe to leave during rollback.

## Production forest and remaining release gate

The owner approved the Pages domain now and deferred `forest.ucfilters.com` until
certified data is available. No custom domain or DNS change is approved or applied.

Production forest: **https://uc-hydrate-forest.pages.dev/**
Deployment ID: `4c62cfea-4fed-44b6-905a-f391996bbb1c` (successful production deployment).
Immutable URL: `https://4c62cfea.uc-hydrate-forest.pages.dev/`.
HTTPS HTML/JSON return 200; repository/archive paths return 404. Programme milestone,
partner, certificate and donation date remain pending. A production screenshot
confirmed the supplied forest design and the explicit live-figures-unavailable state.

The static site was published before the backend because it safely labels unavailable
totals pending. The live API/Companion release and router update are **not yet deployed**.
No live-totals or production-card pass is claimed.

Pages preview: `https://4ad447b1.uc-hydrate-forest.pages.dev/`
(branch alias: `https://release-hydrate-the-future.uc-hydrate-forest.pages.dev/`).
Deployment environment is **preview**, not production.
Draft pull request: `https://github.com/RoyceD59/ULTRA-APP/pull/5`.
The source branch was rechecked before creating the release branch; no existing
branch was rewritten or merged.
The production endpoint/router are unchanged until the approved backend is actually
published; therefore production live-totals validation remains a release gate.
Native device checks must be reported separately from web/unit/build checks.

Do not use a normal workspace-wide republish for this release without first isolating
the approved changes: the inspected live Companion revision predates other workspace
features. Preserve the live release as the deployment baseline, apply only this
forest/impact integration, and leave unrelated newer workspace work untouched.

### Frozen app/API package

`release-sources.tar.gz` contains only source/dependency manifests from the observed
live baseline `9f113c2f847e3631fb59f97774f64e5e8f23c85f`, with this task's impact/API
integration applied. It excludes repository metadata, environment files, runtime data,
dependencies, compiled outputs, browser fixtures and newer unrelated features.
The Zod barrel follows the existing codegen command's single generated-module export,
avoiding conflicting split-type reexports in the old snapshot.

`release-manifest.json` records the source, baseline, integration revision and archive
SHA-256. `release-build.mjs` validates that digest and checks the live baseline before
building. Parallel artifact builds share one locked extraction/install. Newer live
releases cause an explicit refusal rather than an accidental overwrite.

API and Hub builds copy generated output to their original production output folders.
The Hub retains its live-baseline UI; no new Hub feature is released. Companion is
served from its isolated build using the baseline static server. The production forest
URL is pinned to the approved Pages origin; account details and tokens are never links.
Its build metadata identifies the integration revision; the manifest separately
identifies the production baseline used in this composite release.

```sh
node infra/cloudflare/forest/release-build.mjs api
node infra/cloudflare/forest/release-build.mjs companion
node infra/cloudflare/forest/release-build.mjs hub
node --test infra/cloudflare/forest/*.test.mjs
```

The registered production build commands use this frozen package, not the current
working-tree app source. Development previews still use the working tree.
This is a **temporary release gate**, not the normal pipeline for future features.
After production verification, restore the original artifact production commands
through the validated artifact-config workflow before preparing another release.
Do not delete or replace newer working-tree source to accomplish the isolation.

Checks on the isolated baseline: library/API/Companion typechecks passed; 10 hydrate
API tests passed in a fresh database that was dropped; Hub/API builds passed; web,
Android and iOS Companion bundles/manifests/assets built successfully.
The additional signed-in browser continuation did not finish and was stopped; it is
not a passed account-switch/litres-entry check. No physical-phone checks were performed.

Publishing requires the owner's Replit Publishing action. Review any database proposal
and do not approve unrelated schema changes or development-data replacement. The release
needs only the two additive Hydrate tables and their indexes; startup DDL ensures them.
Once published, verify the production endpoint, narrowly update the router, and verify
the final production card-to-forest flow before declaring this task complete.