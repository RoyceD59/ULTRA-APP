# Development change log


## 2026-10-08 — Release observability and implementation test guide

- **Scope:** User-requested operating guide; no publication approval supplied.
- **Changes:** Added `docs/release-observability-and-test-guide.md` with exact
  retained-candidate checks, disposable-database test commands, live snapshot
  gates, build/image-size evidence, privacy-safe monitoring and recovery criteria.
- **Evidence:** Read-only public snapshots agreed at the recorded probe time.
  Live API source identity and actual candidate publishing/image size remain
  unverified; the guide does not describe historical freshness as a current pass.
- **Verification:** Checked command targets, frozen test-wrapper filtering and
  documentation whitespace. No production-write or signed-in checks performed.
- **Ignore changes:** None.
- **Status:** Documentation prepared; no runtime, client selection, cleanup,
  schema, production initialization or publication changes.
- **Remaining:** Separate publication approval and authoritative build-to-runtime
  evidence are required before declaring the security candidate live.


## 2026-10-08 — Alternate release-path duplicate checks

- **Scope:** Disposable regression fixtures only; production verifier and builder
  behavior, retained releases, rollback assets and publication settings unchanged.
- **Changes:** Added leading/inner `./` and repeated-separator aliases for the
  approved Companion `app.json` member. Each fixture keeps all original approved
  archive members and appends one literal alias without extracting it. Assertions
  confirm the two distinct names resolve to the same file.
- **Verification:** `node --test
  infra/cloudflare/forest/release-integrity-negative.test.mjs` passed all 33 checks.
  Before fixture-only envelope re-pinning, checksum gates reject each archive;
  afterward, the approved literal-path delta guard rejects it. Direct auth/upload
  verification, handoff verification and API local-only/API copy-output/Hub
  copy-output builders all reject before extraction or staging. Subprocess probes
  forbid installation, compilation, fetching and output copying; retained output
  sentinels and production input/tool/config hashes remain unchanged.
- **Ignore changes:** None; all forged archives and envelope pins are temporary
  copies cleaned up by the fixture harness.
- **Status:** Tests verified locally; no publication or production re-pinning.

## 2026-10-08 — Release archive external-link boundary checks

**Scope:** Disposable regressions and evidence only; retained archives,
rollback assets, production verifiers, approved pins, publication configuration
and release selections are unchanged.

- Added symbolic-link and hard-link members with absolute and parent-relative
  targets outside the candidate extraction directory, but inside each temporary
  fixture. Replaced one real member without changing the complete member-name
  list, so the path-delta check cannot mask the link-target check.
- Each forged archive first fails the unchanged outer checksum gates before
  extraction. Fixture-only outer re-pinning then exercises the auth/upload
  verifier directly, without changing any per-file reviewed hashes or lengths.
- **Finding:** All four repinned link fixtures reach candidate extraction
  without a link-type/target rejection. The unchanged predecessor is extracted
  first, so this is not a rejection before filesystem writes. The production
  verifier's name-only path check does not supply a link preflight guard.
- A subprocess probe allows only the pinned fixture predecessor to extract and
  blocks the forged candidate before tar runs. Assertions check exact extraction
  arguments, actual link-target resolution outside the extraction root, cleanup,
  unchanged external sentinels, retained outputs and production input/tool/config
  hashes. Tests characterize the guard limitation; they do not demonstrate an
  actual outside write or establish GNU tar's extraction defenses.
- Literal ustar targets are checked in raw headers and in listing-only `tar -P`
  output, because ordinary GNU tar listings strip leading `/` and `../` from
  hard-link targets. `-P` is never used for extraction.
- No ignore-rule changes, publication, real archive re-pinning or rollback
  modification was needed.
- Verification: `node --test
  infra/cloudflare/forest/auth-upload-security.test.mjs
  infra/cloudflare/forest/consistency-handoff.test.mjs
  infra/cloudflare/forest/release-integrity-negative.test.mjs` passed all 42
  checks; `git diff --check` passed.

## 2026-10-08 — Forged security file-review regressions

**Scope:** Isolated tests only; no real approval record, release selection,
archive, production verifier or publication changes.

- Added separate forged-record cases for the before-file digest, before and
  after byte counts, and unchanged-parent file count.
- Each case first fails the original scope checksum, then advances only the
  disposable scope checksum pins to reach its independent review-record guard.
  Candidate archive bytes and candidate metadata remain unchanged.
- Both verifiers and all three existing approved-builder invocations reject
  each forgery before staging, compilation, network calls or output copying.
  Retained output sentinels and original retained-input hashes remain unchanged.
- Verification: `node --test
  infra/cloudflare/forest/release-integrity-negative.test.mjs` passed all 25
  checks; `git diff --check` passed. No ignore-rule changes were needed.

## 2026-10-08 — Unsafe release archive path regressions

**Scope:** Disposable test fixtures only; no retained archive, rollback asset,
publication configuration or production verifier changes.

- Added literal ustar fixtures containing an absolute member path, leading and
  nested parent-directory traversal, and duplicate member names. Tests verify
  that archive listing preserves the exact offending names.
- Each fixture first fails its archive checksum, then fails with `Unsafe archive
  paths` after fixture-only outer pins advance. Both verifiers and all three
  existing approved-builder invocations exercise these failures.
- Subprocess probes block extraction before it can run, alongside existing
  compilation/network/output-copy probes. Assertions require empty fixture
  temporary directories, no staging or escaped output, and unchanged output
  sentinels and original retained-input hashes.
- Verification: `node --test
  infra/cloudflare/forest/release-integrity-negative.test.mjs` passed all 21
  checks; `git diff --check` passed. No ignore-rule changes were needed.


## 2026-10-08 — Approved security release corruption regressions

**Scope:** Isolated tests only; no production publication, schema mutation, or
release/client selection change.

- Added disposable byte-copy fixtures for the auth/upload verifier, handoff
  verifier and approved builder. Unmodified copies pass both verifiers.
- Negative cases cover a changed byte in each retained archive, altered scope
  hash, mismatched approval identity/flags, same-length route/test/frozen-file
  corruption, and extra/missing reviewed or frozen paths.
- Fixture-only outer re-pinning tests the independent file-scope/path guards
  rather than stopping every case at the complete-archive checksum.
- Builder probes prohibit network, child build processes and output copying;
  tests assert no stage is created and retained output sentinels are unchanged.
  Original retained inputs are hash-checked after all cases. Temporary fixtures
  are removed in cleanup; real rollback files are not used or modified.
- Documented the focused Node test command in the forest README. The existing
  positive hash/scope, exact merged-file and narrow-route restoration tests
  remain unchanged. No ignore-rule changes were needed.
- Verification: all 13 existing positive/handoff checks passed alongside the
  initial negative suite. After adding the disposable-copy positive control,
  all 17 checks in the final negative test file passed. `git diff --check` passed.


## 2026-10-08 — Consolidated source review prepared, not selected or published

- **Owner direction:** Prepare/review the merged feature and security scope
  together. This is not candidate-selection, publication, schema, feature-
  activation or native-distribution approval.
- **Retained review:** Committed source snapshot plus three narrowly constrained
  dependency-overlay inputs produces candidate
  `57b70b22b6faf692cc14c17b7858da52111d208354acab84f4e5d14f24c36feb`.
  It includes 1,908 source files and a complete 928-path source/execute-mode
  comparison against the narrow auth/upload parent. Thirteen central approved
  consistency/security files remain byte-identical. Original archives and the
  initial committed-only review archive are retained.
- **Additional isolated fixes:** Registry-verified sharp 0.35.5 (Apache-2.0),
  shell-quote 1.11.0 (MIT), fast-copy 4.1.0 (MIT). Existing dependency age
  restrictions were unchanged. Actual installed sharp/librsvg and quote/copy
  regressions passed. Root manifests/lock and production dependencies were
  not changed.
- **Local checks:** Shared libraries and all three consumers typecheck; API and
  ProjectHub compile; Companion exports web/iOS/Android JavaScript. Expo
  dependency alignment passes. Focused API checks: 130 passed, zero failed,
  disposable database dropped. Client-state checks: 19 passed. Existing
  dependency/backport/mail checks: 7 passed. New installed-dependency checks:
  3 passed. Scope/non-activation checks: 2 passed.
- **Scanner evidence:** Workspace scan had five high/two moderate version
  advisories. Isolated final candidate audit has zero critical, three high and
  one moderate. Three retained high-version advisories have installed backport
  evidence, not a clean scanner result or new risk acceptance. Two medium SAST
  findings concern preview infrastructure outside the archive. Privacy scan
  returned no findings. Remaining scanner and CSS-parser review is explicit.
- **Publication blocker:** API compilation externalizes sharp; a future
  separately approved publication must apply the matching root runtime
  manifest/lock first. A secure staging graph alone does not update main's
  external native dependency.
- **Main verification:** Existing managed API and ProjectHub workflows were
  restarted once and came up. Normal development API startup/reconciliation
  ran. Public ProjectHub sign-in screenshot renders normally. These are not
  production or signed-in journey proofs.
- **Unchanged gates:** Auth/upload parent remains selected; clients remain
  predecessor. No production writes, initialization, schema application,
  publication, client/native activation or provider-setting changes. Preserve
  production revision/audit, inspect/review the eleven additive statements,
  prove actual live API source, recheck fresh public agreement, recapture the
  current served rollback assets and complete approved provider/device checks.
- **Handoff:** `infra/cloudflare/forest/consolidated-review/README.md`,
  `candidate.json`, `scope.json`, `validation.json`, `security-scans.json`.
  Staging remains under the existing ignored `.consistency-build/` convention;
  no new ignore rule was introduced. Review artifacts are tracked; credentials,
  runtime records, raw logs and unrelated products are excluded.

## 2026-10-08 — Coordinated consistency and security-live verification in main

- **Scope:** Continue the consistency rollout and its security-live verification
  handoff; confirm actual deployment rather than equating merged task status
  with public delivery. No candidate expansion or client selection change.
- **Prepared main:** Verified archive and owner-approved scope identity
  `88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`.
  All 13 auth/upload scope and main handoff checks passed. Existing immutable
  archive compilation/regression evidence remains separate from live evidence.
- **Production target/schema:** Public successful Autoscale deployment. Full
  schema diff now contains 11 additive statements for guest-payment links,
  product editorial records, order variants and AI feedback. No removals,
  truncations, structural data loss, compatibility warnings or other warnings
  were reported. These statements are outside this approved package's schema
  scope, so publication stopped rather than silently applying them.
- **Live impact:** Both public API hosts returned fresh agreeing snapshot IDs,
  revision 1 and numeric totals at the recorded probe time. Production read-only
  queries confirmed the existing zero offsets, approved legacy hash and one
  attributed legacy-import audit. Preserve them; no reinitialization is needed.
- **Security-live provenance:** Latest successful publication used a standby
  build. Referenced source-build details were unavailable from the deployment
  callback and a narrowly filtered runtime-log query found no package identity.
  Fresh global-impact responses establish compatibility, not exact live
  authentication/upload source or a blanket security pass.
- **Other merged work:** Compared runtime paths from receipt, session, upload,
  My Filters, record-driven/editorial page, guest-payment and AI changes against
  the frozen package. Multiple feature/AI modules are absent. Approved partial
  security transplants remain valid; whole-file differences in the large route
  do not invalidate their verified scope. Existing served clients are still
  predecessor on both hosts. Do not claim all merged features are deployed.
- **Preserved:** Four pre-existing generated client/Zod modifications were left
  untouched. No application code edit, workflow restart, schema mutation,
  production write, publication, provider call or client activation performed.
  No new sign-in, payment-sandbox or physical-device QA pass claimed.
- **Evidence:** `infra/cloudflare/forest/rollout-evidence/main-coordinated-verification-2026-10-08.json`
  records the full schema diff, source inventory and safe public/audit summaries.
  Broader release/scope review and exact live-security provenance are required
  before client rollout. The public freshness gate must be repeated at build time.


## 2026-10-07 — AI endpoint access and feedback integrity

**Scope:** Security hardening only. No production publication performed.

- Private project-context queries now require a signed ProjectHub team session
  and a live active team account before context loading or provider work.
  Requests are limited to ten per account per minute; questions are capped at
  4,000 characters.
- Alison feedback requires a live customer account and an owner-bound signed
  receipt for the exact delivered question/answer. One rating per customer/turn
  is enforced by a unique database key, including concurrent submissions.
  Repeated or rejected feedback does not invalidate topic summaries.
- Feedback is limited to twenty submissions per customer per minute. Like
  existing application limiters, new limits are process-local and reset on
  restart; they are not a distributed quota.
- Companion carries receipts in both ordinary and regenerated answers and
  saves them with account-scoped recent history. Older answers without receipts
  remain readable but cannot submit ratings. Existing feedback rows are retained.
  Anonymous server transcripts remain anonymous; identity is attached only to
  authenticated feedback.
- Updated the OpenAPI contract, regenerated clients/validators, and included
  matching shared SQL and idempotent API-startup migrations.
- Focused API security regressions pass: unauthorized/inactive principals,
  provider-call limits, modified/wrong-owner/expired receipts, turn question
  conflicts, duplicate/concurrent writes, and feedback throttling. API,
  Companion, and shared-library typechecks pass.
- Related API chat/auth/persistence/export regressions pass (32 checks, including
  updated successful-response receipt assertions), as do ten local chat-history
  checks. The running development API returns 401 for anonymous requests to both
  hardened endpoints and its health endpoint reports healthy. No signed-in
  browser or physical-phone check was performed for this backend-focused patch.

**Rollout:** Deploy API and updated Companion together. Old clients without
answer receipts intentionally fail closed on feedback. Orchestrator callers of
the formerly public project query must authenticate with an active team session;
no public or shared-secret bypass was added. No ignore-rule changes were needed.

**Completion validation:** All configured TypeScript and startup-font checks
passed, and completion code review approved the changes. The full API run
identified two additional knowledge-route fixtures needing the new receipt
contract and consistent retry questions; both were corrected, and all nine
tests in that file pass in isolation. Expo Doctor initially failed on six
pre-existing Expo patch-version mismatches. The owner approved the six SDK 57
patch updates, but the first installation was blocked by the 24-hour minimum-release-age
rule for the official transitive `babel-preset-expo@57.0.14`. The owner chose to
retain that protection and retry no earlier than 2026-10-07 15:10 Africa/Nairobi.
No exception or registry bypass was added. The unapplied manifest changes were
restored to match the unchanged lockfile while waiting. The owner requested a
retry after the window; installation then succeeded without any safety-rule
exception. Verified all six releases against the official Expo repository:
`expo` 57.0.27, `expo-auth-session` 57.0.14, `expo-constants` 57.0.21,
`expo-linking` 57.0.12, `expo-router` 57.0.25 and `expo-notifications` 57.0.22.
The SDK-aligned manifest ranges and lockfile were updated together.

**Recovery and safety:** Saved the pre-update security-patch source revision in
the local Git branch `backup/ai-endpoints-before-expo-update`, plus a dependency
baseline archive under the already-ignored `.local/state/ai-endpoint-recovery/`.
These are source/dependency recovery points, not database backups. The deferred
package update required no data deletion or database migration. Restarted the
managed Expo workflow once after installation; the public mobile-width browser
preview renders without a fatal application error. The optional desktop React
Native debugger cannot launch because the workspace lacks a system library;
Metro and the application still serve normally. No physical-phone test was
performed. The completion gate reruns the configured compatibility, typecheck,
startup-font and API checks. The post-install dependency audit matches the
baseline exactly, with no new advisories.

**Accepted scope limitation:** The baseline dependency audit reports one
critical (`shell-quote`) and four high (`node-forge`, `http-cache-semantics`,
`braces`, `sharp`) advisories, plus two moderate findings. The owner explicitly
approved leaving those existing findings outside this task; they are not fixed
or waived for production publication. This approval does not cover newly
introduced findings. No production publication or data backup was performed.
Completion remains subject to all configured validation checks passing; this
entry is development evidence, not a production-release approval.

**Preview isolation:** Completion validation after syncing with main caught
background-worker startup in the listener-only preview branch. Restored the
preview branch to HTTP listening and shutdown signal handlers only; normal
startup retains scheduler, review-analysis and referral-settlement workers.
All four existing preview-safety regressions and seven release-package checks
pass after the correction, without starting background work against shared data.
The restarted development API reports healthy and rejects anonymous requests
to both hardened AI endpoints with 401.

**Validation resource isolation:** A subsequent full API run hit the unchanged
PDF parser deadline in the library route integration test. The serial-test
group covered the direct PDF tests but omitted the route fixture's exact file
name. Added that fixture to the existing serial phase; no production timeout,
document limit or assertion was relaxed. All twelve direct and route-level
knowledge tests pass together under the isolated database harness.

## 2026-10-08 — Frozen sign-in/upload security integration

- Compared the retained dependency-security archive against exact merged
  sign-in/upload changes before transplanting. Added a deterministic narrow-hunk
  preparation script, complete readable delta, old/new per-file hashes and byte
  counts, separately retained archive and pinned scope verifier.
- Carried only eight-hour session expiry, live active-team customer-count
  access, upload MIME serving/sandbox protections, attachment byte verification,
  the merged per-router test adapter and five exact merged regression files.
  Preserved the frozen statistics query and all receipt/other feature bytes.
  Six existing files changed, four tests added; 1,254 other parent files match.
- Owner approved selection of candidate
  `88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`
  after the scope and validation summary. Updated only the main handoff identity
  and packaging guards; API-first build and post-build cleanup remain in place.
  Clients, all previous archives and rollback files remain unchanged.
- Frozen shared libraries and all three consumers typechecked; the API compiled;
  all 49 transplanted security regressions passed via the disposable test
  database wrapper, which removed its database afterward. Production build
  guards run only the three non-database fixtures, never DB-backed tests.
- No application workflow source, provider setting, production initialization,
  development/production schema, account data or client source was changed.
  No new ignore rule: checksum-scoped installations/outputs remain under the
  existing ignored `.consistency-build/`; archive/evidence sources are tracked.
- **Prepared and selected, not published.** Publishing must explain the one-time
  sign-in for expiry-free customer sessions. API publication, live compatibility,
  agreeing fresh public-host snapshots, actual final image size and eventual
  client/native/device verification remain separate, unclaimed operations.

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

### 2026-10-07 — Saved-order scoped guest payments

- **Scope/approval:** Development implementation of saved-order “Ask someone to
  pay”; no production activation, DNS changes or real financial transaction.
- **Changes:** Authenticated, retry-safe 72-hour hashed capabilities, additive
  fresh/startup DB migration; variant-safe existing checkout sharing/recovery;
  saved-total WhatsApp/copy messaging and deliberate bearer warning; isolated
  noindex/no-store/referrer-protected signed-out pay document/proxy; shared
  order-attempt guard, live pricing/stock/benefit checks, provider timeout
  reconciliation and signed callback binding; original-order confirmation,
  idempotent receipt dispatch, redacted diagnostics and privacy-filtered events.
- **Verification:** Focused lifecycle, existing checkout-benefit, document/proxy
  tests and API/Companion type checks. Evidence and remaining controlled external
  checks: [Guest-payment readiness](saved-order-guest-payment-readiness.md).
- **Completion correction:** Validated order capabilities scope separate guest
  polling/initialization limits; invalid-link abuse has an independent budget.
  A real proxy-to-API test confirms concurrent payers and polling beyond the
  former shared five-request allowance without trusting forwarded IPs.
- **Ignore changes:** None. Source, migrations, tests and readiness record remain
  tracked; no bearer/contact/provider secret material or generated staging added.
- **Status:** Source implemented and locally compiled/tested; not published.
- **Browser evidence:** Signed-in actual API pending save and reload/link
  idempotency using a read-only approved catalogue fixture; actual signed-out
  allowlisted summary/private document and readable phone/tablet/desktop layouts;
  browser-mocked pending/verified/interrupted payment states. Fixtures and
  temporary overrides removed; no provider or Woo order created.
- **Remaining:** Satisfy the explicitly separate live-catalogue mapping and
  sandbox/physical-device/notification/collector/ingress release gates
  before any later approved activation.

### YYYY-MM-DD — Change title

- **Scope/approval:** What was requested and any explicit operational approval.
- **Changes:** Every related change and its purpose; link focused evidence.
- **Verification:** Commands/results and evidence limits.
- **Ignore changes:** Patterns added/removed and reasons, or none.
- **Status:** Source / prepared / compiled / selected / published / rolled back.
- **Remaining:** Concrete unfinished checks or blockers.
