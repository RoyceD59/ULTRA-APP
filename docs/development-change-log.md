# Development change log

## 2026-10-07 — Editable shared product pages (development only)

- Added validated persistent v2.4 editorial records, conflict-aware ProjectHub
  editing and non-destructive six-slot media mapping, separate from WooCommerce
  stock/identity authority.
- Connected public HTML/SEO/schema and web/native Choose / Understand / Decide
  pages; added record comparison and clearly labelled selected-SKU product links.
- Preserved verified variation identity in persistent cart, quotes, saved order
  lines and existing fulfillment; unavailable mappings/stock
  block purchasing rather than guessing.
- Added explicit opt-in privacy-filtered Google product event adapter without
  replacing Umami, installing collectors or changing native collection.
- Verification and rollout limitations: `editable-product-pages-verification.md`.
  No publication, activation, tariff/provider changes or real payment occurred.

- Later owner clarification: uploaded Excel supersedes WooCommerce pricing.
  Verified CATALOGUE RETAIL prices/children for all 19 priced full records;
  imported prices once into persistent records (Hydra Flux KES 4,399), retaining
  non-price edits and subsequent staff price changes. Enquiry records stay null.
  Checkout and Woo order line subtotals use approved Companion prices; Woo
  reference mismatches remain visible but do not block verified in-stock SKUs.
  No WooCommerce catalogue prices or provider settings were changed.
  Added an additive import-revision column and workbook verification script.
  Legacy variant order branches now reject before anchors/provider calls.
  Verification: 9/9 isolated editorial API tests, 62 Companion checks and
  refreshed shared/API/Companion/ProjectHub typechecks. No ignore-rule changes.
  Final checkout fixes enforce live parent publication during pricing and use
  exact child identity/quantity for summary subtotals. Published Woo fixtures now
  explicitly include their status. Fixed the library test's time-sensitive JWT
  string comparison; library authorization behavior itself is unchanged.


## 2026-10-07 — Unified My Filters (development only)

- Replaced Account's separate assignment, purchase-activation and nested
  offline surfaces with one My Filters block: current tracker, all ready units,
  collapsed registered/assigned details and purchase history. Receipt lookup
  remains a secondary recovery action.
- Home keeps its existing health card and offers every eligible app/store
  and linked offline unit even while another filter is active. View all filters
  targets the Account block.
- Display identities use exact registered IDs/source units, never names,
  dates, contacts or raw order numbers. Offline reads expose registration IDs;
  legacy records without proof remain honest. Independent app records survive
  store outages without granting unconfirmed mirrored eligibility.
- Added account-scoped reads/cancellation, focus/poll/manual refresh and
  registration invalidation. Additional activation and restore preserve the
  primary installation, cleaning/check-in history and reminder identities.
  Installation date stays an explicit customer confirmation.
- Focused client checks, 42 isolated API checks and library/API/Companion type
  checks passed. Web, Android and iOS exports were prepared in a temporary
  directory; browser evidence and remaining device limits are recorded in
  `docs/my-filters-verification.md`.
- The 24 focused client checks and a browser-only signed-in fixture pass
  confirmed phone/tablet/desktop layout, keyboard disclosure, every unit's
  explicit date selection, primary preservation, source recovery, Account
  navigation/scrolling and no registration replay. The configured login
  returned 400; fixture responses are not live ownership/payment evidence.
  Physical-phone and deployed verification remain unavailable.
- Ignore-rule record: no `.gitignore` or ignore policy changes. No publication,
  release archive/serving manifest activation, hosting changes, rollout flags,
  ownership reconciliation, payments, rewards or impact changes.

## 2026-10-07 — prepared record-backed public product pages

- Imported the supplied v2.4 product records and schema, with a public allowlist,
  exact-SKU identity resolution, live operational stock reads, matching FAQs and
  structured data, stable slug canonicals and empty noindex topic routes.
- Reused the existing opt-in renderer and media reads. Browser enhancement keeps
  document scrolling and record wording; native commerce, checkout, payments,
  delivery and uploads remain unchanged.
- Read-only diagnostics found 11 matched / 10 unmatched identities and 11 price
  disagreements. The public-rendering runbook records per-product media gaps and
  release prerequisites. No provider records or activation flags were changed.
- Verification is local, not publication, physical-phone, Rich Results or
  WhatsApp evidence. Source JSON/schema/validator and tests are tracked; temporary
  exports and diagnostic reports remain under `/tmp`.

## 2026-10-07 — Publishing image-size failure

- **Cause:** The failed publishing build compiled the approved API candidate,
  predecessor Hub and browser/iOS/Android Companion bundles successfully, then
  failed while creating the deployment image: layers exceeded the 8 GiB limit.
  Metro's optional debugger and Vite source-map/chunk warnings were not the
  fatal error.
- **Change:** Replace the store-prune-only deployment post-build hook through
  schema-validated `.replit` replacement. First remove installed dependency
  trees from marked frozen stages and their workspace packages, then run the
  unchanged pnpm store prune. Refuse invalid stage markers and symlinked
  parent/workspace directories before removal.
- **Preserved:** Root/workspace runtime dependencies, all three source archive
  identities, stage compiled worker output, stage/core-Node servers, browser and
  native static builds, preparation markers and retained rollback assets. No
  recursive node_modules-name sweep: public asset paths may use that name.
- **Ignore record:** Exclude local tooling caches, not frozen runtime stages or
  static asset node_modules paths. Stage dependencies are removed by the hook.
  No `.gitignore`, application source, API/client artifact build
  selection, schema or account/payment data changes.
- **Verification:** Deployment cleanup fixtures and the existing 21 package/
  consistency checks; frozen Companion runtime HTTP smoke check after cleanup;
  frozen compiled logging-worker smoke check using retained root dependencies.
  API/Hub preview workflows restarted; API health screenshot returned status ok.
  Final counts and reproduction limits are recorded in publishing failure
  evidence. No new full browser/sign-in/device test pass is claimed.
- **Status:** Packaging correction only; not republished. Actual image-layer
  size and successful promotion still require a publishing retry. This does not
  incorporate recently merged application fixes into the frozen archive or
  authorize candidate clients before the compatible API/snapshot gate.

Track development progress here in Git. Record changes, verification, remaining
work and publication status. Never include secrets or customer identifiers.
Git history records exact file changes; entries here explain their purpose.


## 2026-10-07 — Public upload SVG execution hardening

- Replaced broad image/video MIME-prefix trust with a shared explicit safe-media
  allowlist. Public SVG, HTML, XML, unknown media and documents are forced to
  octet-stream downloads, including the thumbnail failure path.
- Added restrictive sandbox content-security headers and retained nosniff for
  public originals and generated thumbnails. Supported raster photos and videos
  remain inline; no new upload flow or storage migration was introduced.
- Attachment validation now inspects a bounded byte prefix even when an
  uploader supplies allowlisted stored MIME metadata. SVG/HTML disguised as
  photos or videos are rejected; unlabelled legitimate media still use the
  existing declaration/size checks and detected metadata repair.
- The sidecar signer still does not bind Content-Type. The security boundary
  is therefore independently enforced at public serving and attachment, not
  solely in the upload-URL request.
- Verification: 42 focused upload, public-serving, signature and private-evidence
  tests passed in an isolated database; shared-library and API type checks
  passed. Development API restarted and its health endpoint returned OK.
  Completion code review, the full API suite, all project type checks and
  Companion startup-font validation passed. The initial Expo Doctor check found
  six stale installed Expo packages despite correct manifest/lockfile versions;
  restored the existing frozen-lockfile installation without dependency-file
  changes. No production publication or ignore-rule changes.

## 2026-10-07 — Authentication session hardening

**Scope:** Security fixes only; no new login, refresh or logout flows.

**Changes:**
- All server-issued sessions now receive an eight-hour expiry by default.
  This covers customer password login, registration, WooCommerce and social
  login, development fallback, and password-change replacement sessions.
- Verification requires a valid expiry and rejects tokens at the exact expiry
  boundary. Existing customer tokens without expiry must sign in again.
  Explicit team-session expiry remains unchanged.
- Customer-count statistics now reload the live team account and reject
  deactivated, deleted, unknown and legacy passcode principals. Active members
  retain access; admin role claims do not bypass the account check.
- Added focused expiry and live-team-account regression tests.

**Ignore changes:** None.

**Verification:** Shared-library and API typechecks passed. The 36 existing
credential-version, Woo identity, social email, temporary-password and admin
gate tests passed. The final focused run passed all nine new expiry/count
authorization tests after correcting a test-only camelCase field assertion.
The development API rebuilt and started cleanly; proxied health returned 200
and unauthenticated customer-count access returned 401.

**Status:** Source changes and development verification only; not published.


### Approved completion-blocker fixes

**Scope/approval:** The owner approved fixing the unrelated Expo check and
receipt projection findings that blocked authentication-task completion.

- Preserved WooCommerce's verified paid state when merging a linked local
  order whose COD collection ledger has not yet caught up. This changes the
  customer display projection only; it does not mark local cash as collected.
- Added regression coverage through the real `/uc/orders` response into receipt
  email, page/PDF HTML and sharing text. Unpaid orders remain unpaid, and local
  staff-confirmed collection still overrides a stale unpaid Woo mirror.
- Resynchronized installed Expo dependencies with the already committed
  lockfile using `pnpm install --frozen-lockfile`. No manifest or lockfile edits:
  expo 57.0.27, expo-auth-session 57.0.14, expo-constants 57.0.21,
  expo-linking 57.0.12, expo-router 57.0.25, expo-notifications 57.0.22.
- Verification: all 11 receipt/order-scope tests and API typecheck passed;
  Expo Doctor passed all 20 checks. Development API rebuilt and restarted.
- Dependency audit: existing advisory totals are one critical, four high and
  two moderate (including patched packages reported by version). No new
  dependency was added. This is not a clean security-audit or shipping claim.

**Ignore changes:** None. **Status:** Development verification only; no publish.

## 2026-10-07 — Payment verification hardening

- Restricted credential-free payment simulations to explicit development/test
  environments. Production, unset and unrecognized environments fail closed
  for Paystack, Stripe and M-Pesa verification, including guest legacy orders.
- Unconfigured providers return an unavailable error from public initialization
  and status endpoints instead of fake references or successful payment status.
  Initialization rejects before reserving a checkout; production availability
  hides unconfigured methods without changing the existing mode enum.
- M-Pesa OAuth failures no longer fall back to demo initiation or status,
  even in development. Numeric shortcode and all server credentials are required
  for real M-Pesa readiness. COD and explicitly permitted local demos remain intact.
- Added production regression coverage for forged guest references, missing and
  partial credentials, initialization/status endpoints, provider-confirmed
  Paystack verification, and M-Pesa authentication failure.
- Verification: shared-library and API type checks passed; 103 focused payment
  tests passed. The final 19 security regressions also passed after preserving
  the existing config enum and adding the initialization OAuth-failure assertion.
  Development API restarted successfully. No production publication or live
  secret inspection was performed; no ignore rules changed.
- Initial completion checks also passed code review, the full API test suite,
  all four project type checks and Companion startup-font verification, but
  Expo Doctor rejected six stale installed Expo packages.
- With owner approval, restored the installation using the existing frozen
  lockfile. The manifest and lockfile already specified the required versions;
  neither needed changes. Verified the six versions against the official Expo
  packages in the registry. Expo Doctor now passes all 20 checks, and the
  Companion preview restarted with the updated installation.
- Dependency audit reported seven existing advisories (one critical, four high,
  two moderate). Existing patches for braces, http-cache-semantics and node-forge
  passed all seven dependency-security regression tests. Unresolved shell-quote
  and sharp advisories remain outside this payment patch and block a production
  readiness claim; moderate fast-copy and postcss-selector-parser findings also
  remain. No production publication or broader dependency upgrade was performed.

## 2026-10-05 — Consistency release preparation

**Scope:** The owner approved splitting preparation in the isolated task from
publication and live verification in the main workspace. This entry does not
announce a production release.

### Changes

- Recorded exact candidate approval, isolated compilation evidence and the
  historical-adjustment evidence gap in
  `infra/cloudflare/forest/companion-consistency-release.md`.
- Searched project files and Git history; found one real historical zero-offset
  file, but no serving-instance evidence. The owner explicitly chose its zero
  offsets as initialization input after the omission risk was explained.
- Checked available deployment logs without recording raw contents or private
  attribution; they did not establish historical production adjustments.
- Saved the approved source archive and scope metadata in
  `infra/cloudflare/forest/approved-consistency/`, separate from the unchanged
  predecessor. No unrelated working-tree sources enter the package.
- Added an isolated handoff builder and fail-closed live API snapshot gate.
  Default production commands are unchanged; the candidate is not selected.
  Local-only checks cannot copy deployment outputs or serve as published clients.
- Added package, snapshot-gate and handoff checks.
- Added explicit retention input and collision checks before production client
  preparation, including normalization of legacy native rollback manifests
  and checks for referenced font/image/manifest assets.
- Added the approved-source README with API-first main-workspace commands,
  audited initialization, safe rollback and credential/access prerequisites.
- Corrected the handoff after its completion check: removed external API and
  baseline gates from serving approved static assets. Build preparation still
  fails closed, but API outages no longer prevent server startup/restart.
  Added an executable production-command regression for that distinction.
- Added a `.consistency-build/` ignore pattern for disposable compilation, plus
  `docs/gitignore-record.md` to explain exclusions without hiding this log.

### Verification

- Original source-boundary/server-selection tests: passed.
- Candidate shared-library, API, ProjectHub and Companion type checks: passed.
- Candidate API, ProjectHub and browser/iOS/Android builds: passed.
- Local compiled Companion ID: `1791190818435-5334`.
- Saved candidate source SHA-256:
  `db2ef861871dcff39cde08350d9374e9b8d1220409e2f506141cf9c4666cad59`.
- Detailed build hashes and credential-free live observations are in the release
  document. Native compilation is not physical-device verification.
- Final saved-source handoff: 17 package/gate checks passed; the eight gate and
  retention checks passed again after referenced-asset validation was added.
- Fresh isolated API, Hub and Companion builds/type checks passed through the
  handoff builder. Its local-only HTTP server selected
  `1791259615348-6264` consistently across browser/version/iOS/Android. The
  compiler reports `2026-10-06T04:08:12.043Z`; this is not a publication timestamp.
- The current production response was rejected by the client snapshot gate.
- Existing signed-out ProjectHub preview rendered normally. No authenticated
  or physical-device verification was performed.
- After the startup correction, all nine handoff tests passed, including the
  production-command regression with all external requests unavailable and
  rejection of API outages during Hub/Companion build preparation. Archive and
  predecessor checks remain valid; no source recompilation was needed.

### Status

**Prepared/compiled, not selected or published.** No production write,
initialization, migration, rollback selection or customer login occurred.
Hosting, authentication and disabled OTA are unchanged. Publication must follow
the main-workspace handoff, with compatible API first, explicit audited
initialization, then client delivery and exact live snapshot comparisons.

### Still required

- Apply this preparation to main; inspect its actual deployment target and schema
  diff, preserving shared adjustment/audit tables and all rollback assets.
- Publish the API separately before clients; initialize only the authorized
  historical baseline if the shared record is still absent.
- Confirm both public API hosts return the same fresh snapshot.
- Publish paired browser/iOS/Android Expo Go clients; verify served IDs and origins.
- Compare Home/About/ProjectHub signed out and with approved accounts. The second
  customer's unambiguous identifier and secure credentials remain needed.
- Keep the paused customer-login investigation out of scope.

## Entry template

### 2026-10-06 — Owner-approved security-only consistency revision

- **Scope:** Prepare a dependency-only revision before publication; preserve
  consistency functionality and the original approved source.
- **Changes:** Saved a separate security archive and checksum, selected it in the
  handoff, and verified the exact lockfile delta independently. Only proxy-addr
  2.0.8, source-map-js 1.2.2 and compression 1.8.2 change, plus compression's
  required reference to already-locked destroy 1.2.0. Updated the main lockfile
  for the same three fixed releases without changing workspace manifests,
  application code, hosting, schema, SDK pins, authentication or OTA activation.
  Preserved both original archives. Added full archive-scope and real-consumer
  security regressions; deployment preparation executes consumer checks before
  compiling/copying, not during static-server startup.
- **Dependency hygiene:** Verified real package names, registry releases and
  acceptable licenses. Discarded broad resolver output that pruned the absent
  sandbox importer and changed unrelated peer resolutions. Installed the exact
  minimal lockfile using frozen installation. Main's cached installation had
  inactive backports despite patch-hash directory names; forced frozen reinstall
  restored their implementation and all seven main backport checks passed.
- **Verification:** Exact candidate API compiled; shared libraries, API, Hub and
  Companion typechecked. Packaging/scope checks, four fixed-dependency runtime
  checks and seven archived backport checks passed; detailed final counts and
  output are saved in the security preparation evidence/report.
- **Audit:** Candidate and main npm audits now have zero critical findings and
  only the two version-only highs covered by tested braces/node-forge patches.
  Security Center's dependency feed adds the tested cache-policy backport and
  two moderate findings outside the requested update. No scanner-wide clean
  result is claimed. The tracked Security Center scan remains waiting for input.
- **Runtime:** Restarted existing API, Hub and Expo workflows after installation.
  API/Hub serve; Metro runs. Expo's optional debugger reports a missing libglib
  shared library; this is not a completed native-device verification. An external
  Woo catalogue request also returned a transient 502 before later succeeding;
  it is not attributed to this dependency delta or represented as fixed.
- **Ignore rules:** Unchanged in this revision. Disposable preparation stays
  under `.consistency-build/`; security archive and metadata remain tracked.
- **Publication:** Not published; no production database writes or baseline
  initialization. API build selection targets the security candidate; client
  commands remain predecessor. Full publication/scan/account/device gates remain
  distinct from successful preparation.

### 2026-10-06 — Main-workspace API-first consistency rollout preparation

- **Scope/approval:** Continue the approved consistency rollout in main. Publish
  the API-compatible response before advancing either client. Preserve hosting,
  authentication, OTA, source freeze and historical impact evidence.
- **Changes:** Confirmed the saved approved source candidate and predecessor
  checksums. Changed only API production build selection through artifact
  validation to `build-approved-consistency.mjs api --copy-output`. Its production
  run command is unchanged; Hub and Companion retain predecessor build commands.
  No production database write, initialization or publication was performed.
- **Verification:** `explainSchemaDiff()` returned success with no diff, no SQL
  statements and no destructive/backward-incompatible changes. Read-only
  production queries confirmed both impact tables exist, with no adjustment row
  and zero audit entries. Handoff/package tests: 18 passed, zero failed, exit 0.
  Isolated approved API source and libraries typechecked and API compiled, exit 0.
  The live-API compatibility gate still rejects the old served contract.
- **Rollback:** Captured served build `1791182522315-296`, public version metadata,
  all three bundles and both native manifests. Saved 60 unique files with
  checksum/provenance evidence in `infra/cloudflare/forest/rollback-static/`.
  Several public dependency URLs return 404. Recovered dependency bytes from
  retained local output only when their MD5 matches a platform/scale file hash
  declared in the actually served native bundles. No older build metadata or
  bundles were substituted. The handoff retention helper validated and copied
  the inputs to a disposable verification directory, retaining 61 files including
  the capture evidence. This is not certification of multi-scale/platform visual
  parity and does not repair the existing public asset URLs.
- **Ignore changes:** Added narrowly scoped exceptions for public rollback
  dependencies nested in `node_modules`, ensuring these release inputs can reach
  the publishing builder. Workspace dependencies and generated stages stay ignored.
- **Security gate:** The exact candidate's production dependency audit exited 1:
  four high findings and one critical finding. Existing braces/node-forge patches
  were verified by seven passing dependency-security regression tests (exit 0);
  a version-only audit still reports those two patched packages. The remaining
  findings are proxy-addr 2.0.7 (critical), source-map-js 1.2.1 (high) and compression
  1.8.1 (high). The latter two paths are Expo tooling; the proxy-addr advisory
  depends on an unsafe IPv6 trust-subnet configuration, not observed in the API
  source. This is not proof of a production exploit, but the clean shipping
  dependency gate is unmet. No dependency or approved archive was silently changed.
- **Status:** Main API build selection prepared and compiled; publication paused
  at the dependency-security gate. No initialization or client activation.
- **Remaining:** Owner Publish action for API-first stage; verify compatible live
  API before approved staff initialization with `expectedRevision: 0` if still
  empty. Preserve any intervening staff revision. Compare both API hosts, recapture
  the actually served predecessor after first publication, then configure/publish
  paired clients. Account/device checks and existing public asset failures remain
  distinct from successful compilation or schema inspection. Obtain approval for
  a narrowly scoped security revision/new candidate checksum before proceeding.

### YYYY-MM-DD — Change title

- **Scope/approval:** What was requested and any explicit operational approval.
- **Changes:** Every related change and its purpose; link focused evidence.
- **Verification:** Commands/results and evidence limits.
- **Ignore changes:** Patterns added/removed and reasons, or none.
- **Status:** Source / prepared / compiled / selected / published / rolled back.
- **Remaining:** Concrete unfinished checks or blockers.
