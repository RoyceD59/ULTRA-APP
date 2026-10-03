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
is separate and also requires approval. Approved hostname: `forest.ucfilters.com`.
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
    workspace changes. Migration `0057_uc_hydrate_trees.sql`, matching Drizzle schema and
   idempotent startup DDL add two tables; there is no drop or data rewrite.
3. Confirm the production aggregate returns valid JSON without auth and the private
   tree endpoint still rejects guests, team sessions and deleted customers.
4. Update the existing `ucfilters-host-router` with the narrowly scoped forest CORS
   change; retain its existing routes and all other permissions. Verify actual GET
   and OPTIONS through `api.ucfilters.com`.
5. Publish the exact tested static package to Pages production. The owner separately
   approved custom-domain/DNS attachment with evidence pending on 2026-10-03. Verify HTTPS, root HTML,
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

The owner initially deferred `forest.ucfilters.com` until certified data was available.
On 2026-10-03, the owner changed that gate and explicitly approved connecting the
custom domain now with temporary, clearly labelled pending information. This does
not approve invented programme facts or verified-outcome claims.

Custom forest: **https://forest.ucfilters.com/**
Pages domain ID: `4ac108e4-4712-49af-9648-bbfe0ac67b97`.
Forest DNS record ID: `21e1f02a63f073cc28ade1068db35a14`
(`CNAME forest.ucfilters.com → uc-hydrate-forest.pages.dev`, proxied, automatic TTL).
The active `ucfilters.com` zone and Pages project are in the same connected account.
The hostname had no existing DNS record or Pages binding before attachment.
All 36 pre-existing zone DNS records and all three Worker routes were compared before
and after attachment and remained unchanged. No Worker or application release was made.

Verification on 2026-10-03: credential-free HTTPS root HTML, programme JSON and an
anonymous growing-stage link returned 200; unknown pages, `.git/config` and the source
archive returned 404. The browser screenshot showed the forest, funding policy and
digital-illustration disclaimer. JSON evidence fields remain null and updates empty.
The production HTML is unchanged apart from Cloudflare's injected security script;
external fonts loaded successfully. Focused static package/router tests passed.
Cloudflare's final domain status, ownership verification and HTTP/certificate
validation all report **active**. The initial pending state resolved after DNS
propagation; public HTTPS and the programme JSON were verified separately.

Production forest: **https://uc-hydrate-forest.pages.dev/**
Deployment ID: `4c62cfea-4fed-44b6-905a-f391996bbb1c` (successful production deployment).
Immutable URL: `https://4c62cfea.uc-hydrate-forest.pages.dev/`.
HTTPS HTML/JSON return 200; repository/archive paths return 404. Programme milestone,
partner, certificate and donation date remain pending. A production screenshot
confirmed the supplied forest design and the explicit live-figures-unavailable state.

The static site was published before the backend because it safely labels unavailable
totals pending. The API/Companion release and forest router update have since been
deployed; see the dated checks below. Signed-in production-card verification is
still blocked by test-account sign-in.

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
live baseline `9cf3861de793aab6322038f4affa4b51316b432a`, with this task's impact/API
integration applied. It excludes repository metadata, environment files, runtime data,
dependencies, compiled outputs, browser fixtures and newer unreleased features.
Already-published Reviews, Alison and refill-governance changes are preserved.
Review analysis owns migration 0056; Hydrate uses the collision-free 0057.
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
The refreshed package also passed Hub typechecking, 20 focused tree/sky/geometry tests
and four hosting/package tests. An explicit string callback type fixes a pre-existing
Alison TypeScript inference error without changing runtime behavior; its nine focused
knowledge tests passed. The API development workflow restarted cleanly.
After main-project synchronization, current-source product/library typechecks, ten
isolated Hydrate API tests and twenty tree/sky tests passed separately from the frozen
package checks. A preview-startup regression confirms only the HTTP listener starts:
no scheduler, worker or referral-settlement timer. Companion typed API errors and
rejected-session handling remain imported and publicly reexported where required.
The archive now has an additional safety check for those same boundaries.
The additional signed-in browser continuation did not finish and was stopped; it is
not a passed account-switch/litres-entry check. No physical-phone checks were performed.

Publishing requires the owner's Replit Publishing action. Review any database proposal
and do not approve unrelated schema changes or development-data replacement. The release
needs only the two additive Hydrate tables and their indexes; startup DDL ensures them.
Once published, verify the production endpoint, narrowly update the router, and verify
the final production card-to-forest flow before declaring the production release complete.

### Owner-approved integration / production split

The owner approved finishing this integration task so it can merge, with the live
API/card rollout moved to a separate follow-up. Publishing uses the main project,
not an unmerged isolated task. This completion therefore covers the integrated code,
reconciled isolated release package, GitHub synchronization and published static forest.
It does **not** claim live API totals, live card behavior, router rollout, production
schema rollout or native-device verification have passed.

After this task merges, the follow-up must recheck the live revision and package guard.
If production changed, refresh the archive first:

```sh
node infra/cloudflare/forest/reconcile-release.mjs <exact-current-live-revision>
```

The reconciler derives only the existing integration delta, preserves already-published
changes, regenerates contracts from the combined specification and refuses ambiguous
conflicts. The old and new Git revisions must be available locally and dependencies
installed. It never replaces working-tree application code.

Then publish from Replit, allow only the additive Hydrate database change, verify the
API, preserve the current live worker while adding only forest read CORS, and confirm
the final card/forest flow. Restore normal artifact production commands using validated
artifact configuration after verification, so future releases are not frozen.
The custom forest hostname is separately approved; leave all other DNS and routing
unchanged. The live API/card rollout remains separate from domain activation.


### Rollout check and sign-in blocker — 2026-10-03

Production now serves the frozen integration revision
`a20475fad106ff663dc1cf674c8b9e5ad0720f79`, build
`1791046893101-342`, built at `2026-10-03T17:02:43.509Z`. Read-only production
inspection confirmed both Hydrate tables. The public forest aggregate returns
200 JSON through `api.ucfilters.com`, with the 3% allocation and equal split;
field evidence remains null/pending. A guest request for the private tree returns
401 JSON. Team/deleted-principal checks and signed-in production card flow remain
unverified. The fetched router before any rollout change is preserved in
`rollout-evidence/router-before.txt`; forest CORS is not yet applied.

The owner reported sign-in network failures and could not publish. A real browser
reproduced a preview-only cross-origin preflight 404; the same-origin Expo route
returned proper JSON. The preview launch command now routes its API to the Expo
origin, and a focused browser check passed without a preflight. A separate
phone-only session-persistence bug was found: the API intentionally returns an
empty public email for those accounts, which the local session validator rejected.
The working-tree validator now accepts a phone-only contact; focused persistence
and preview-origin tests and Companion typechecking passed.

**These sign-in changes are not in the frozen release archive.** Do not tell the
owner that republishing the unchanged frozen package deploys the session fix.
Before another publication, package and validate only the approved sign-in delta
against the observed composite release, preserving its already-published features.
Do not reconstruct that composite from its integration revision alone: its manifest
separately records the newer baseline used in the archive.

No customer credentials were used in the browser diagnosis, and the specific
successful-login failure in Safari remains unverified. No physical/native device
check was performed. Do not restore normal production commands until the rollout
and signed-in checks succeed.

Production Google/Apple authentication is also blocked: browser requests and
direct checks of `/api/__clerk/v1/environment` and `/api/__clerk/v1/client` on
`app.ucfilters.com` return 400 JSON with Clerk `host_invalid` ("Invalid host").
The proxy build wiring was compared with the current managed-Clerk guidance.
No managed credentials, DNS records, identity-provider settings or production
router permissions were changed while diagnosing this separate blocker.


### Public forest totals connected — 2026-10-03

The live router now has only the three forest-CORS additions applied to its
retrieved source, not a wholesale replacement with the local router.
Deployment ID: `42a99cfe1b4c4492afc8b62755b37da3`. Its bindings, compatibility
settings, logging, placement, tags, tail consumers and usage model are unchanged.
`rollout-evidence/router-before.txt` and `router-after.js` preserve both versions.
The local router's unrelated HTML-cache changes were not deployed.

Actual checks through `api.ucfilters.com` passed: forest GET/HEAD return 200 and
wildcard credential-free CORS; GET/HEAD preflight return 204; POST preflight has
no forest CORS. The private tree, trailing-slash and suffix paths do not gain
forest-origin access. Guest and signed team-principal requests for the private
tree return 401. Eleven focused API tests passed in a disposable database,
including a signed deleted-customer token. No deleted production fixture exists,
and no production account was created or deleted for that check.

The live forest browser now shows **Live figures**, not unavailable totals.
Current eligible allocations are zero; zero is the actual aggregate response,
not a demo fallback. The 3% programme allocation remains equally divided.
Programme field evidence remains pending. Screenshot and safe check results are
in `rollout-evidence/live-totals-forest.png` and `verification.json`.

The owner confirmed that the test account was created in the live Companion and
that the Companion is the forest entry point for now; no new WooCommerce linking
flow was added. The test phone was supplied in local format; after explicitly
converting the same number to international format for a diagnostic request, the
server returned a neutral 401 rather than establishing a customer session.
This does not prove whether the account exists or the password is incorrect.
The signed-in card flow remains blocked. Normal production build commands remain
frozen until that verification succeeds, as required by the release plan.


### Approved Companion entry points — 2026-10-04

The owner requested a small forest hyperlink below global UC Impact, a visible
updated personal impact card, and uniform global figures managed through
ProjectHub. They selected an **in-app About Us page with global impact and a
forest link**, not a redirect-only About Us page.

Home and `/about` now use the same account-independent impact query and endpoint,
with refresh on navigation, foreground, reconnection and every minute. Missing
figures show a loading/error state, not substitute zeros; failed refreshes label
previous figures explicitly. The global endpoint sends `Cache-Control: no-store`.
There is no bulk rewrite of registered accounts or personal impact history.
The personal card opens expanded, remounts for a changed account, and retains
litres, carbon estimates, milestones and refill behavior. A no-tree/error customer
can open the public forest without an invented personal ID or stage.

The narrow refresh to `release-sources.tar.gz` includes these UI changes and the
previously diagnosed phone-only persistence correction. The differing archived
Home/layout files were edited only at the approved navigation insertion points.
All other archived modules are byte-for-byte unchanged; a package test enforces
that whitelist and preserves the preceding composite release.
`release-manifest.json` records the preceding archive hash, the approved source
delta, and both preceding/current integration revisions. The live-baseline guard
accepts that exact preceding composite while the owner publishes the new package;
it still refuses an unrelated changed live release.

The current working-tree Companion and API typechecks passed. Focused tests cover
credential-free public links, invalid personal stages, shared/global cache versus
private customer caches, and phone-only sessions. A Chromium browser confirmed
the public About page, equal settled Home/About global totals, and a new forest
tab with no account, token, query or fragment parameters. These are preview checks,
not successful production customer sign-in or native/device checks.

The refreshed isolated package passed all seven hosting/package tests, library
and Companion typechecking, and eighteen focused tree/cache/session tests. Its
web, iOS and Android bundles/manifests/assets built successfully. Library
declarations must be built (`pnpm run typecheck:libs`) before running a standalone
Companion typecheck in a newly extracted package. Bundle success is not a
physical-device or native sign-in result.

The new UI is **not yet published to `app.ucfilters.com`**. After this task merges,
the owner must use Replit Publishing. No new schema/data replacement is needed for
these UI changes. Production customer card/account-switch verification and
restoration of normal production commands remain pending; do not claim those
passed merely because the refreshed package builds.
### Publishing certified evidence later

1. Obtain documented programme dates, partner details, donation records, certification
   and independently supported field evidence. Confirm each field/document that may
   be publicly disclosed and redact private information before packaging.
2. Update `artifacts/uc-companion/forest/programme-status.json` only with supported,
   approved facts. Missing values remain null/pending. Funding estimates and digital
   growth are not planted or established tree counts; a donation alone does not
   establish either outcome. Never invent receipts or lifetime value.
3. Prepare updates through the approved `release/hydrate-the-future` repository branch
   and pull-request process. Do not merge a protected branch without approval.
4. Run the static build and tests above, then inspect a Pages preview. The current
   static package has an explicit allowlist: adding certificate/report files requires
   updating that packaging allowlist and its tests, not merely dropping files beside
   the HTML. Use only publicly approved HTTPS evidence links until files are packaged.
5. Obtain publication approval for the exact update, deploy the tested package to
   Pages production, and verify both hostnames, programme JSON, evidence links,
   anonymous card links and correct pending/verified labels. Preserve the 3% equal
   split and the rule that refills add no funding.
