# 19 October 2026 — Preserve pending Replit work and reconcile tested main

- Recovered the clean Replit tip 5e632ed16cbbda73f0f26f0c92a2d4924f375017 (13 unpushed commits) through a verified Git bundle after Replit GitHub authentication failed. Preserved the original history on codex/replit-preserved-2026-10-19; main and the live selection were not overwritten.
- Integrated those commits with tested main 7b392e75b800ad99aaf96a7e070a89e5230a8e7e. Resolved 18 overlapping test/fixture conflicts while retaining main account/recovery, mounted analytics, provenance and portable browser guards.
- Reconciled stale Companion expectations with the selected release: native derivatives fall back to original photos and stop loading after success; Notify me opens the restock form while existing alerts keep scoped toggles; collapsed HTML menus are opened before navigation; authored questions/details remain visible without inventing FAQ search markup. Added the clipboard boundary to the recovered physical ESM checkout fixture. No production authorization or payment guard was relaxed.
- Added the complete API integration CI workflow against disposable PostgreSQL, with literal CI-only connection details and no production secrets. The existing runner creates/removes an isolated test database. Its result remains pending until observed.
- Verification: initial Companion run 995/1001; repaired six stale assertions, focused recheck 16/16, final full Companion suite 1001/1001 with no skips. Frozen archive ee734d2d0e4d0fbb890900b694809b552e409e21a57e0fb8b53d3732dda75c7f passed existing source/scope validation: 1355 files, 1219 unchanged, 136 allowlisted changes, parent lock unchanged. This is not a compiled-stage or live-publication result.
- Reviewed the new restock table/index/erasure-trigger migration and explicit inventory SKU constraint naming. Executed no production DDL, imports, stock initialization, account writes, publish or Cloudflare activation. Replit rollback installation remains incomplete after the browser connection dropped; customer/phone/binary gates remain open. See docs/replit-main-reconciliation-2026-10-19.md for identities and next actions.

# 17 October 2026 — Product browser navigation and restock follow-up

- Repaired public-document/interactive-page layout ownership. A parent effect
  cannot restore zero-height record layout after the current route is ready;
  client-side loading/error screens without a fallback keep their viewport.
- Added an accessible menu on stack and tab screens, including product loading
  and error states, Escape/focus return on web, and scrolling on short screens.
  Fixed Expo Router's wrapped-child style-array rendering error.
- Kept category-specific authored layers in both interactive and initial HTML
  product pages; activated safe related-product, topic, enquiry and explicit
  authored links. Public pages retain two installation-video slots.
- Added guest/customer restock requests with name, international phone, typed
  location and exact product/variant identity. Requests are prospects/pending
  restock demand, never accounts, unpaid orders, reservations or payments.
- Added ProjectHub stock follow-up filters, demand counts and status updates,
  with live-admin checks, bounded pagination, private/no-store responses and
  no contact or credential logging.
- Added transactional duplicate protection, stale/deleted-account rejection,
  customer export/erasure support and 180-day resolved-guest contact retention.
  Erased contacts cannot be reopened into active demand.
- Completion review found and corrected nested-pool acquisition starvation:
  editorial reads now precede transaction-client reservation. A bounded test
  exceeds pool capacity; the related customer-count test no longer depends on
  concurrent fixture visibility-map/planner costs. Production count SQL is unchanged.
- Product photos use bounded derivative widths, cached web images, original
  fallback and deferred thumbnails. Prepared an explicit Cloudflare cache for
  public image files only; private requests, HTML and errors remain uncached.
- Prepared a bounded release archive over the previously selected product
  release, preserving its security/dependency and catalogue/cart prerequisites.
  The new preparer fails on ambiguous backports. No stock initialization,
  payment activation, DNS change or production publication is implied.
- Ignore rules were not changed. Dependency and build outputs continue to use
  the existing ignored staging directories; small reviewed release-source
  archives follow the existing release convention.
- Verification and activation details: `docs/product-browser-restock-release.md`.

# 17 October 2026 — Selected test registration record cleanup

- Added individual selection and confirmed clearing on Unsynced Registrations
  for recovered/resolved, pending, conflicted, retryable and contacted records.
  Administrators choose which records are tests; there is no name/email-based
  automatic classification or newly added clear-all-unresolved operation.
- Customer accounts, assignments, orders, payments and customer history are
  outside the approved removal scope. The empty state no longer incorrectly
  claims every registration synced after records have been cleared.
- Added a live-admin-gated API accepting explicit confirmation and at most
  100 unique opaque snapshot keys. Changed/missing/ambiguous selections fail
  all-or-nothing. Removal shares the existing registration/recovery write
  queue, uses atomic replacement and retains unselected/malformed lines.
- Logs record administrator identifier/action/count, not registration contents.
  Storage errors produce safe user messages and never report false success.
- API contract/codegen and shared-library, ProjectHub and API typechecks passed.
  Focused checks: **17 API + 4 ProjectHub tests passed**, no failures. Coverage
  includes cancellation, mixed-state selection, stale selections, permissions,
  duplicate identities, concurrent appends, write failure and retained accounts.
- Restarted the API and ProjectHub successfully. Mocked browser checks at
  390/768/1440 pixels confirmed selection/confirmation/removal, retained
  unselected rows, no page overflow, fitting dialogs and no browser page errors.
  The unsigned screenshot showed sign-in, not the authenticated screen.
- Added `docs/projecthub-registration-record-cleanup.md`. **Development only:**
  no publication or GitHub push; no real test/customer records cleared and no
  unrelated payment-task completion. API tests used a disposable database and
  temporary ledger files; browser checks intercepted API requests with fixtures.

# 17 October 2026 — Alison viewer access and guarded client deletion

- Added an explicit Alison viewer quick-create option with only `alison.read`.
  The matching client ID and one-time secret are now displayed together for
  both creation and rotation; copying failures are reported rather than hidden.
- Corrected pasted credential whitespace handling and distinguish missing
  scope, rejected credentials, throttling and API/connectivity errors.
  Unexpected success responses cannot establish a false connected state.
- Clear anonymous conversation query caches on disconnect/expiry/unmount and
  isolate each connection's cached pages. Credentials remain memory-only;
  existing server-side secret hashing and team-session separation are retained.
- Added administrator-only client deletion with permanent-removal confirmation.
  Only suspended/revoked clients without live unrevoked tokens may be deleted.
  Token cleanup and retained audit entries are transactional. Token issuance
  rechecks locked client state to serialize with rotation/suspension/deletion.
- Regenerated the API contract. Shared-library, ProjectHub and API typechecks
  passed. Focused tests: **23 ProjectHub + 12 API passed**, no failures.
  API checks used a disposable database and fixture credentials, not saved keys.
- Restarted the API and ProjectHub successfully. Checked both updated screens
  and the deletion dialog at 390, 768 and 1440 pixels with mocked browser
  fixtures: no horizontal overflow or browser page errors. The unsigned
  screenshot correctly displayed sign-in; it did not validate authenticated UI.
- Added `docs/alison-client-access.md` with setup, recovery and removal steps.
  **Development only:** no publication, GitHub push, production credential
  changes or unrelated payment-task completion. Existing live credentials
  were not inspected or verified.

# 18 October 2026 — Companion regression suite repaired

- Resolved the previously reported 52 Companion test failures. The final full
  suite reports **990 passed, 0 failed, 0 skipped**. The count increased because
  the previously failing rendered-checkout file now executes its three tests,
  and the loader artwork has a separate static-frame assertion.
- Repaired extracted payment-handler fixtures to supply ready account/recovery
  state and the mounted checkout's navigation, receipt and sharing boundaries.
  Plain ESM fixtures avoid Node/tsx treating data URLs as filesystem paths.
  Cancellation, retry identity and server-refusal assertions remain enforced;
  no live provider or payment credentials were used.
- Public-rendering fixtures now expose the current editorial list/detail API
  and Companion catalogue provenance. Retired WooCommerce/demo provenance is
  still rejected, and unavailable editorial data still fails closed. Updated
  canonical-product identity and keyboard accordion checks to the current
  structured-fields-only public page; did not restore retired FAQ prose.
- Fixed the product detail's eager root API import and moved the impact type
  import to its public model entry point. Matched the optional water-test
  field's accessible name to its visible label.
- Updated stale loader-artwork, map event, analytics and hydration assertions
  to current behavior without disabling their safety checks. The recovery
  browser fixture now stubs native Expo constants instead of bundling native
  module internals through React Native Web.
- Shared-library and Companion typechecks passed; diff whitespace check passed.
  Restarted Expo and confirmed the phone-width Products preview renders with
  no browser page errors after Metro startup. The immediate screenshot was
  blank during loading; a settled browser check confirmed visible content.
- **Source/development only:** no frozen-package selection, publication,
  GitHub push, physical-device certification or live-payment verification.
  This does not certify the separate API suite or Expo Doctor checks.

# 17 October 2026 — project-wide architecture and queue recovery review

- Added `docs/companion-projecthub-development-status.md`: current development
  status, full-system dependency map, 18 failure/common-dependency risks,
  architecture requirements, evidence gaps and ordered ownership/actions.
- Rechecked all 54 accepted unfinished tasks and stale input holds. Capacity
  still blocks 31 tasks. Google collector verification returned to an input
  hold during this review; no capacity or main-assignment change was made.
- Existing workflow evidence: typechecks and startup-font checks finished;
  API suite failed; Expo Doctor reports 11 SDK patch mismatches (19/20 checks).
  Running API logs also warn of missing trackable-product lifespan metadata.
- Preserved product/publication and web-foundation dependency chains and the
  incomplete payment verification. No tasks falsely completed, no new tasks
  created, no production changes and no fresh device verification.
- Documentation is not a release approval or a new GitHub sync. Main priority
  selection and worker capacity management require the task-board controls.

# 13 October 2026 — Product clicks, restock action and gallery recovery

## 19 October 2026 — Repair post-merge CI and document deployment validation

- **Scope:** User approved a focused repair branch from merged `main` and a
  practical deployment-validity guide. Base: PR #6 merge `3731f841…`; work is on
  `codex/repair-merged-main-ci`.
- **Runtime/build utilities:** Product requests use the existing Companion
  customer API export instead of the root barrel; the global-impact type import
  uses its existing domain-model export. The web-export chunk check and font
  consumer report normalize Windows path separators. Added LF checkout policy
  for checked schema JSON in `.gitattributes` so Windows preserves its checksum
  bytes without changing retained release assets. No
  schema, generated client, validator, payment handler or loader asset changed.
- **Test boundaries:** Route tests inject the persisted flag reader with
  `NODE_ENV=test`, reset it per test and verify that storage errors still return
  503. Notification tests map the local-only facade to the stateful mock.
  Rendered checkout fixtures provide current router/clipboard boundaries and
  portable file-backed ESM modules. Extracted provider tests supply the added
  account/recovery/storage boundaries; their production cancellation, retry and
  stale-response handlers remain the code exercised.
- **Current contracts:** Public-data fixtures require the API's actual
  `companion-published` provenance while explicitly rejecting legacy/demo
  provenance. Source guards recognize the added recovery/link state, unmounted
  Alison guard, marker-event isolation and optional visible assessment label.
  Artwork tests cover the retained owner-supplied single falling drop/ripples
  and still fallback, superseding the earlier stationary-pulse expectation.
  The payload fixture uses the platform temp directory.
- **CI browser:** Both workflows that run Companion tests install the pinned
  Playwright Chromium. Browser fixtures use an explicit override, provisioned
  Replit browser, or Playwright's browser rather than a required Replit path.
  No tests were skipped and no production capability was enabled.
- **Hub tests:** Inventory mocks retain the real stock-label export; customer
  mocks include the current assignment-query hooks. Vitest selects its source
  test files and the Hub test command separately runs the existing Node photo
  ordering suite, so that suite is executed by its intended runner.
  Inventory quantity checks locate their column by its header. The two order
  enrichment integration tests retain all assertions with 20-second deadlines:
  a successful isolated Windows run measured 6.1 seconds for the first test.
- **Documents:** Added `deployment-validity-guide.md` and a timestamped public
  deployment review. The guide distinguishes Git commits, selected source
  archives, published build IDs, preview checks and actual account/device proof.
- **Verification:** Full Windows Companion suite passes 984/984 with no skipped
  tests; Companion typecheck and isolated refill routes (9/9) pass locally.
  GitHub on `0160065` passes Companion (984), foundation (9 API tests, 38 Hub
  Vitest files plus the Node photo-order test, then 984 Companion tests),
  governance and isolated three-surface preview. A simultaneous local Hub
  repeat was stopped after resource-related UI deadlines; the full Hub result
  above is from the normal Ubuntu CI runner. This follow-up narrows the schema
  attribute, bounds two UI-test deadlines and records completed public capture;
  inspect the resulting exact-head checks on PR #7 before merging.
  Public version/manifest/health/snapshot observations and the verified
  62-file/60-asset capture with equal cross-host bundle hashes are recorded in
  the deployment review. Captured files are local evidence, not a changed main
  Replit publication selection.
- **Ignore/dependency changes:** None. Lockfile unchanged; local tooling and
  test-browser downloads are outside the tracked source.
- **Status:** Source and review evidence only; no publication, customer-data
  write, database migration, DNS or repository-protection change.
- **Next:** Finish checks, review the repair PR, complete served-asset/rollback
  verification and obtain the existing secure-account/device evidence before
  a separately selected publication.

## 19 October 2026 — GitHub main/App reconciliation prepared for review

- GitHub `main` (`3f5da0c340471becf001ea384ff4e4356047181c`) and `App`
  (`60e91e261701f19786b9e87362c4a6627cdc7fb9`) have unrelated root
  commits. A normal fast-forward or direct pull request cannot reconcile them.
- The public Companion `version.json` served build `1792278093274-833` (built
  2026-10-17T23:04:38.593Z) with candidate source fingerprint `41d38f627258152d7cc7132b275f7c495e44e1ca1503391a165efed316e5212a`.
  The candidate package and validation record are present on `App`. Served
  assets, API/Hub source lineage, physical-device behavior and rollback capture
  still require separate verification.
- A review-only integration commit joins both Git histories and retains the
  `App` file tree except for this entry. This is a repository-history proposal,
  not a product feature, database migration or production deployment.
- Before merging, review the main-to-App file delta, privacy/secret scan,
  GitHub checks, deployment triggers, rollback assets and exact served-client
  source parity. The draft pull request is not release approval. No customer
  data, schema or production service was changed by preparing it.

## 14 October 2026 — published catalogue image 404 investigation

- Confirmed published catalogue JPEG endpoints return 404 for browser and
  native-style requests, while the approved uploaded galleries return JPEGs.
- Replaced working-directory-relative catalogue paths with one shared
  source/bundle-relative resolver for static originals and resized derivatives.
  Required missing image packaging now fails explicitly.
- Added a no-database regression for non-API working directories, both module
  layouts, JPEG/WebP responses and missing-image 404s. A development browser
  capture shows the returned photograph.
- Frozen API/Hub builds, web/iOS/Android exports and scope integrity passed.
  Selected source `41d38f62…`, local build `1791957255767-6680`; **not published**.
- Confirmed live source is the preceding `59f5a238…`, now retained as the
  published predecessor. No production data or secret values were changed.
- iOS rating failure remains unresolved; do not mark the overall task complete
  or say all release checks pass. More precise phone failure evidence is needed.

## Latest preparation: photo display names and phone diagnostics

- Added ProjectHub photo display names (maximum 80 characters) without changing
  stored image URLs. Moving a photo preserves its name, alt text, approval and
  colour/SKU metadata. Names reach public JSON, initial HTML and web/native
  gallery captions.
- Included the newer authored record editor in the frozen Hub package; it had
  been absent from the retained publication source.
- Native product photos now use original images through React Native Image with
  measured frames, explicit gallery height and bounded loading/retry feedback.
  Web keeps its optimized image path.
- Rating forms use a regular scroll view with handled keyboard taps, a bounded
  save request and safe error feedback; failed sign-in offers recovery navigation.
- Current selected source `59f5a238…`, local build `1791922548096-6587`:
  API/Hub builds, platform exports, typechecks, scope checks and focused name/
  order/native-image unit checks passed. The full API suite attempt timed out
  with failures and is not recorded as passing.
- **Not published; not complete:** previous physical checks confirmed Android
  startup but failed photos on both phones and iOS ratings. New phone verification
  and the remaining payment evidence are still required.

## Preceding preparation

- **Reproduced:** Published product content looked interactive, but the server
  document layout remained active after the React handoff; ordinary pointer
  clicks hit HTML rather than the buttons. Removing that layout mode restored
  enquiry navigation.
- **Fixed:** Interactive records release the fallback layout on mount. Group
  navigation selects a published record, not an unpublished first entry;
  empty groups are explicitly disabled. Restock saves show progress/errors
  rather than swallowing failures, and signed-out customers return to their
  product after sign-in.
- **Gallery:** Explicit absolute image bounds, loading/retry feedback and
  original-image fallback after a failed thumbnail derivative. Existing photo
  approvals and draft publication restrictions are unchanged.
- **Verified:** Shared and consumer typechecks, API/Hub builds and
  web/Android/iOS exports passed. Browser fixtures confirmed partial-group
  navigation and signed-out Notify me routing. No production writes.
- **Selected source:** `c49a560276fd7114eff73fdaa44e09f47c467265e260411bcdf944a1f32ad9ad`;
  local build `1791918978635-32131`. Not published. Exact native-device image
  failure still requires the affected product and Expo platform.
- **Retention:** The actually published predecessor was byte-reconstructed
  and verified; the earlier published archive is also retained.
- **Ignore changes:** None.

## Android Expo Go startup follow-up

- Owner reports all product photos missing on iPhone Expo Go and Android
  failing to load. Supplied Android screenshot identifies the SDK's remote-push
  import exception, not a payment, catalogue or photograph permission error.
- Local notification imports now exclude the remote token-registration graph.
  Remote registration remains lazily available for supported Android builds;
  existing local reminders and notification routing remain enabled.
- Transitive import-graph regression passed; four existing reminder scheduling
  tests passed. Updated web/iOS/Android exports and API/Hub builds passed.
- Preview browser loads the Sweet Home primary photo and gallery thumbnails
  without page exceptions. That is not an iPhone-device pass.
- Additional ad hoc Node require smoke was inconclusive because mock resolution
  reached Expo's native TypeScript modules. It is not counted as a phone test.

## Blank Chrome page and native rating follow-up

- Chrome-sized published-page reproduction: product data was present, but
  the root container measured zero height while fallback document mode remained
  active. Both slug and numeric product URLs exhibited this condition.
- Removed render-time DOM deletion. The fallback's ancestor-style cleanup and
  the interactive handoff now run before paint. Preview with injected fallback
  mode measures a full 503-pixel root and loads the primary image.
- Native location details coerce optional text guards to booleans, avoiding raw
  text inside views. Marker taps no longer bubble into the map's deselection.
  Rating selection runs before optional haptics and survives haptic failure.
  Rating controls also require a loaded customer identity.
- Read-only fixtures confirm no raw view text for empty ATM/vendor fields and
  star selection under synchronous haptic failure. All frozen builds passed.
  Actual native rating submission is still not a physical-device pass.

# 13 October 2026 — Layered product-page structure restored

- **Owner request:** Use the supplied Ultra Clear Product Pages HTML as the
  structure reference. Restore the layers in web and Expo publication, not
  only the development page.
- **Cause:** The selected frozen client retained the abbreviated buying/specs
  page and old category labels. The approved gallery URLs were reachable;
  missing authored sections were a client/release-content gap.
- **Prepared:** Shared responsive layers, five authored navigation groups,
  replacement navigation when public records exist, four canonical catalogue
  categories, complete package/care/service/FAQ/search information and
  source-authored savings examples with assumptions and an estimate disclaimer.
  No new photo activation, stock initialization or draft publication.
- **Product videos:** ProjectHub has independent upload/removal controls for
  video slots 1 and 2, MP4 previews and a 60 MB per-clip preflight limit.
  Server attachment checks serialize simultaneous uploads per product and
  reject occupied slots. Both full-record and legacy web/Expo galleries read
  the two slots; the first-video field remains compatible with older clients.
  Existing clips are not automatically deleted. Four slot-mapping tests pass.
- **Selected source:** `34478f5c5d1d91f49575aa902f45e30e1f79e52325f9a4fc8dcf92fe5731caf8`.
  Its exact review scope and predecessor archive are verified. The previous
  published candidate remains an explicitly accepted rollout baseline.
- **Checks:** Frozen shared/API/Companion/ProjectHub typechecks and builds;
  web/Android/iOS exports; release structure manifest; existing patch/media
  fixtures; deployment-cleanup tests. Sweet Home preview gallery and authored
  headings verified; no horizontal overflow at 390/820/1280px.
- **Not completed:** Actual publication, physical-phone verification and the
  separate payment sandbox checks. Eleven draft records remain unpublished.
- **Ignore changes:** None; screenshots remain in the previously ignored
  `generated-artifacts/product-page-release/` directory.

# 13 October 2026 — Companion startup after deployment cleanup

- The latest publish passed compilation, rollback retention and image upload,
  then the selected Companion server crashed because image cleanup removed
  its `@workspace/api-zod/blog-inline-links-core` resolution link.
- Approved stages now retain validated relative workspace links into their own
  retained libraries/artifacts. Installed third-party/build dependencies still
  get removed. Escaping or absolute workspace links fail before any deletion.
- Corrected the startup regression to load the selected product-page server,
  not the older legacy server. It checks the shared import after cleanup,
  browser/native HTTP responses and repeat-cleanup idempotency.
- All 13 deployment-image regressions pass, including escaping-link rejection
  before deletion. Read-only workspace preflight verified 49 frozen links;
  development installations were not pruned.
- No source archive, payment settings, schema or production data changed.
  This prepares a publication retry; it does not publish the project.

# 13 October 2026 — recurring republication rollback failure

- Compared failed publishing logs: the earlier failure lacked the currently
  served rollback metadata; automatic live capture now handles that case.
- The latest failure was not compilation: fresh capture timestamps conflicted
  with an old report inside a reused static output.
- Rollback retention now copies only the verified release's client tree.
  Operational capture reports are additive, content-addressed observations;
  existing reports, pointers and client bytes are never replaced.
- Regression coverage repeats retention with changing individual/aggregate
  reports, preserves prior evidence, ignores unrelated releases, and still
  rejects missing files, changed client bytes and release-directory symlinks.
- The production-preparation Companion command completed successfully with
  a fresh live capture. Product-page source and payment configuration unchanged.
- All 12 image-cleanup/runtime regressions pass. Updated the obsolete API-first
  assertion to enforce the actual coordinated API/Hub/Companion build commands.
- Current cached stage markers were checked: approved/scratch only, no invalid
  marker classification. No development dependency trees were removed.
- Publishing itself remains a user action.

# 13 October 2026 — product-page release handoff and preview verification

- Connected the approved archive to the main API/ProjectHub/Companion selector.
- Added checksum-bound source/stage verification and guarded local adoption;
  unreviewed executable sources are rejected.
- Kept development previews on their development API; Sweet Home mobile and
  Gym Buddy desktop render with approved photos. Viva Drop's API record and
  five images pass; its initial-loading screenshot is not a completed UI check.
- ProjectHub typecheck/build and four selection safety tests pass. The actual
  production-preparation Companion build passes with live rollback retention.
- Captured the current live rollback from public responses with checksum
  evidence, including all referenced assets. No old bytes or pointers replaced.
- Schema comparison reports no changes. No publication or provider requests.
- Physical-phone and separate payment sandbox verification remain outstanding.

# 13 October 2026 — product-page compatibility implementation

- Reconciled catalogue, pricing, fulfillment, receipt and cart contracts in the
  isolated release candidate; retained unrelated customer/session/QR methods.
- Added the missing checkout route-array handlers and kept guest Ask-to-Pay out.
- Shared/API/Companion typechecks, four isolated product/variant/cart regressions
  and seven installed security-backport fixtures passed without provider calls.
- Verified all fifteen approved photo URLs return image responses.
- Fixed API authored-data output ordering and the cold web renderer's missing
  CommonJS helper export; prepared matching API/web/Android/iOS builds.
- No production data, running service source, release selector or publication
  changed. Browser checkout and coordinated activation remain separate gates.

# 13 October 2026 — approved product-page prerequisite review

- Recorded the owner's approval to include the required catalogue, price,
  stock/SKU and variant-cart prerequisites; no repeated scope approval needed.
- Prepared a separate, unselected review archive and isolated dependency stages,
  preserving the selected frozen package and its unchanged lockfile.
- Shared libraries compile, but the candidate API and Companion typechecks fail
  on cross-version shared contracts. No coordinated platform exports were made.
- Recorded the exact failed-candidate fingerprint and remaining gates in
  `docs/product-page-publication-handoff.md`; the candidate is **not publish-ready**.
- No running app, production data, credentials, provider settings, canonical
  hosts or release selection changed. No payment-provider calls were made.

# 13 October 2026 — product-page publication compatibility investigation

- Confirmed the live browser still selects `1791820215559-828`; the new public
  product-record endpoints return 404 on the production origins checked.
- Compared the original product-page feature with the selected frozen archive.
  The cart changes match some predecessor contexts, but API, startup, checkout
  and client input contracts need a scoped compatibility integration.
- Did not select the whole working tree, alter production data, change payment
  providers, replace secrets, advance releases or publish.
- Added `docs/product-page-publication-handoff.md` with the required prerequisite
  scope and verification gates. No ignore-rule changes.

# 13 October 2026 — saved Paystack key rejected by test-only gate

- Owner conditionally approved saved-key reuse only in test-mode.
- A private, non-network format check classified the current key as live-mode.
  Stopped with zero provider requests; no payment, secret update, source/runtime
  change, publication or DNS change.
- A separate test-only key is needed; do not overwrite the live application
  credential. The existing unresolved M-Pesa context remains independently held.

# 13 October 2026 — owner configuration confirmation and read-only Daraja access

- Owner confirmed saved shortcode/passkey match sandbox Test Data and Express
  Sandbox is enabled; do not present the common-example difference as a fault.
- Actual sandbox OAuth HTTP 200 and status-endpoint HTTP 400 / `400.002.02` were
  observed. The read-only query omitted CheckoutRequestID intentionally; no
  invented reference, payment initialization, callback or customer write occurred.
- This is basic access evidence, not payment confirmation, credential-pair
  validation or recovery of the original missing response.
- Original pending context stays paused/retained; saved secrets unchanged.
  Sanitized read-only evidence is already ignored. No source/runtime change,
  publication, DNS change, new native app or additional test runner was required.

# 13 October 2026 — bounded provider diagnostics, without another payment

- The original fixture silenced provider-error logging. Added fixture-only
  bounded response diagnostics so a future safe run records HTTP status,
  allowlisted public code, fixed issue category and reference-presence only.
  No raw provider messages, references, contacts, URLs or credentials are emitted.
- Response inspection is capped at 8 KiB/one second, leaves the payment response
  consumable, and neither retries a request nor lets a failing diagnostic sink
  alter the payment response. Nineteen focused tests and API TypeScript passed.
- Non-charging configuration checks show a shortcode different from the usual
  sandbox PayBill example; this is a hypothesis requiring actual simulator
  Test Data comparison, not a confirmed error cause. Saved values remain unchanged.
- No new provider request, production write, publication or DNS change. The
  original unknown attempt remains retained. The prepared logging enhancement
  does not recover its missing historical response or establish payment success.
- Gracefully paused the original supervisor, confirmed its unresolved context was
  retained, and confirmed public namespace 503 without normal-checkout fallback.
- Ignore rules unchanged; configuration-check evidence stays in the existing
  ignored result directory. End-to-end sandbox verification remains incomplete.

# 13 October 2026 — temporary HTTPS payment fixture and unresolved sandbox attempt

- **Scope/approval:** Owner approved development HTTPS test exposure and the
  saved M-Pesa test credential source only. No publication, DNS, production
  routing, live funds, Paystack credential reuse or notification activation.
- **Changes/purpose:** Added a development-only attested namespace in the existing
  API. Its fixed loopback destination and narrow route/origin/body guards prevent
  fallback into customer checkout. Added initial HTTPS privacy preflight,
  encrypted M-Pesa capability/signing context and unresolved-attempt retention.
- **Verification:** Fourteen focused tests and API TypeScript passed. Actual HTTPS
  privacy/isolation checks passed; ingress/fixture application logs were token-safe.
  The phone-sized no-link screenshot is presentation evidence only. Gateway-internal
  logs, actual physical-phone execution and broader failing validation workflows
  are not claimed verified.
- **Sandbox result:** One M-Pesa attempt returned API HTTP 500 without a reference;
  pending state and no-retry response remained bound to the original buyer/order.
  Read-only reconciliation remained pending. No simulated success or repeat charge.
- **Ignore changes:** None in this phase; sanitized results remain under the
  already ignored `generated-artifacts/guest-payment-fixture/` directory.
- **Status:** Development test preparation/partial sandbox evidence only; not
  published and not end-to-end complete.
- **Remaining:** Confirm authoritative Daraja outcome first. Paystack, controlled
  recovery/callback/void evidence, approved receipt destinations and signed-out
  real-phone checks remain blocked/incomplete.

# Development change log

## 2026-10-13 — Owner-approved saved M-Pesa test credentials

- **Approval:** Owner requested use of saved M-Pesa credentials and confirmed
  they are test credentials. This does not authorize reuse of Paystack keys,
  production payments, publication or DNS changes.
- **Check:** Presence-only configuration inspection, followed by one isolated
  Daraja sandbox OAuth GET. HTTP 200 authentication succeeded; shortcode syntax
  was valid and passkey/callback-secret presence confirmed. Those latter values
  have not yet been verified in a transaction.
- **Isolation:** Only five approved M-Pesa secret names and minimal runtime
  configuration entered the authentication child. Fixed sandbox endpoint,
  redirects rejected, bounded timeout; no other credentials, database, app
  imports, STK push, callbacks or notification requests.
- **Evidence:** Sanitized result at
  `generated-artifacts/guest-payment-fixture/mpesa-authentication.json`, covered
  by the existing ignore rules. No secrets or access token logged or persisted.
- **Changes:** Documentation/provenance only; no saved values, runtime payment
  code, order data, publication, production URLs or collectors changed.
- **Remaining:** Approved temporary HTTPS test routing before payment/callback
  checks; Paystack test key and notification test recipients remain outstanding.

## 2026-10-13 — Isolated guest-payment preparation fixture

- **Approval:** Owner approved the written isolated-fixture design and build.
  This does not approve public exposure, live credentials, DNS or publication.
- **Changes:** Added a supervised loopback-only fixture with its own temporary
  PostgreSQL database, synthetic buyer/original saved order, real payment router
  and private document/proxy. Added restricted child configuration, outbound
  transport guards, bounded credential-free request events and owned-database
  cleanup. Unrelated eager AI dependency is fixture-scoped and explicitly
  unavailable; normal application behavior is unchanged.
- **Validation:** Six safety tests passed; API typecheck passed; local
  verification passed private headers, minimal summary, unavailable-not-demo
  initialization, original-order retention, denied routes/foreign origins,
  private files/logs and database removal. No full-suite or Expo validation claim.
- **Lifecycle:** Retained fixture health and explicit graceful stop passed.
  Background-tool force-stop skipped cleanup in the first retained check; its
  owned synthetic orphan was recovered without touching other databases.
  Added restricted control metadata and an identity-checked stop/recovery
  command; private files and listener removal were independently confirmed.
- **Evidence:** Sanitized local-only result under
  `generated-artifacts/guest-payment-fixture/local-verification.json`; runbook at
  `docs/guest-payment-fixture-runbook.md`. Bearer state was confined to a private
  temporary directory and removed after verification.
- **Ignore changes:** Added `/generated-artifacts/guest-payment-fixture/` to
  `.gitignore` and `.replitignore`; no existing ignore rules removed.
- **Publication:** None. No live tables, existing secrets, DNS, provider funds,
  real recipients, Stripe activation or collector settings changed.
- **Still blocked:** Actual provider transactions/callbacks, permanent voiding,
  buyer notifications, physical phone and actual ingress privacy. Dedicated
  test credentials, approved callback routing and test recipients are required.

## 2026-10-13 — Guest-payment sandbox verification blocked by test-origin DNS

- **Approval:** Owner authorized test-only transactions and receipt
  notifications in an isolated setup, and is available for a real signed-out
  phone check. Both supplied origins were `https://www.app.ucfilters.com`.
- **Verification:** Read-only resolver and HTTPS checks failed to resolve that
  hostname; an independent public DNS lookup confirmed NXDOMAIN. No request
  reached a guest-payment endpoint. M-Pesa's environment flag is sandbox;
  credential existence alone does not establish approved sandbox identity.
  Stripe remains disabled.
- **Changes:** Evidence categories and blocked prerequisites recorded in
  `docs/saved-order-guest-payment-readiness.md`; no application/configuration
  changes or provider transactions.
- **Ignore changes:** None.
- **Status:** Awaiting reachable isolated test origins. No publication,
  DNS changes, real funds, production writes or collector activation.
- **Clarification:** Owner supplied real configuration addresses, not a separate
  test host. The selected build injects `app.ucfilters.com` and
  `api.ucfilters.com`; the unreachable `www.app.ucfilters.com` is neither.
  No isolated test fixture has been verified.

## 2026-10-13 — Three-product photo approval and anonymous prerequisite checks

- **Approval:** Owner approved photo activation for Sweet Home, Viva Drop and
  Gym Buddy only, including the different-SKU legacy Gym Buddy upload match.
  Use ProjectHub uploads only; no approval for other product pages or old
  website-image substitutions.
- **Verification:** All 15 approved upload derivatives returned HTTP 200 to
  an anonymous crawler user agent, decoded successfully, and were visually
  reviewed. Direct development product-record responses confirmed Sweet Home
  slots 1/2/3/5, Viva Drop 1–5 and Gym Buddy 1–6, the 21 exact parent-SKU
  identities and 20 matching numeric prices. Eighteen eligible records still
  have no approved photos. Sweet Home lacks slots 4/6; Viva Drop lacks slot 6.
- **Release limits:** The live product-record API still returns 404, while
  crawler product URLs serve a generic app shell and robots.txt returns 404.
  The selected frozen release omits the newer product-record implementation;
  repeated publishing alone cannot include it. The old catalogue appends the
  uploads after legacy images, so a first-six gallery can hide them.
- **Audit limit:** The legacy audit adapter renumbers Sweet Home's last image
  as slot 4; direct record responses establish the correct approved slot 5.
  See `docs/product-operational-review-2026-10-12.md` for the release handoff.
- **Preview:** Sweet Home's 402×874 browser preview showed the uploaded main
  photo and four thumbnails without a runtime error; this is not live evidence.
- **Changes:** Approval, evidence and unresolved gates documented; no
  application code, release selection, production database or checkout changes.
- **Ignore changes:** None; temporary image/audit outputs stayed in `/tmp`.
- **Status:** Prerequisites reviewed; live activation/publication not performed.

## 2026-10-12 — Failed publish: rollback retention captured for served build 1791747237127-812

- **Cause:** Build `c2ee52f9` failed in `retainRollback` with ENOENT for `rollback-static/1791747237127-812/build-info.json`. Every earlier check in that build (API, Hub and Companion typechecks, Hub build, security tests, live API snapshot) passed. The previous publish made `1791747237127-812` the served build, but it had not been retained. The gate worked as designed.
- **Changes:** Captured the served build from `https://app.ucfilters.com` (`version.json` confirmed `1791747237127-812` before and after) into `infra/cloudflare/forest/rollback-static/1791747237127-812/` (web, iOS and Android bundles, both native manifests, 56 referenced assets, 60 files, 0 failures) plus `1791747237127-812-capture.json`. Older retained builds untouched; the rollback gate was not weakened.
- **Verification:** `retainRollback` accepts the new directory in a scratch destination (306 files).
- **Ignore changes:** None.
- **Status:** Assets only; not published.
- **Remaining:** The build served after the next publish must be captured before the following publish.

## 2026-10-12 — ProjectHub photos mapped to product records (development only, not published)

- Owner instructed: use the pictures uploaded in ProjectHub. Uploads sit on the
  old website product IDs. They are mapped by record code into the approved
  gallery slots of the v2.6 records: Sweet Home (exact SKU UC-HOU-TAP-005) 4
  photos in slots 1, 2, 3, 5; Viva Drop (exact SKU UC-BOG-TRB-010) 5 photos in
  slots 1-5; Gym Buddy 6 photos in slots 1-6. Gym Buddy's old listing has a
  different SKU (UC-EA-BOT-GYM-BK-1200ML-25), so that link rests on the owner's
  upload, not SKU equality.
- Existing databases receive the mapping through a once-per-row startup import
  that never overwrites a slot staff already approved.
- Held back: the Flex photo (draft record stays without approved images), the
  Viva Drop video, and the 8 photos on "Faucet Filter Cartridge" (no SKU).
- Still no photos for 18 of the 21 published-eligible records.

## 2026-10-12 — Product page reduced to structured fields; categories aligned (development only)

- Product pages (Companion screen and server-rendered HTML) no longer show the
  authored outcome/intro/suitability prose, benefits, evidence claims, FAQs,
  replacement/delivery/returns text, or FAQ and description schema. They keep
  photos, name, type line, category link, SKU, price, options, stock, buy
  actions, specifications, included-items list, compatible-fitting images (no
  captions) and the hot-liquid safety warning. List entries show names only.
- Store category tabs were still the old website labels, so none of the 21
  app-owned products matched any tab. Tabs are now Bottles & On-the-Go, Home &
  Kitchen, Skincare & Wellness and Business & Community; old labels remain as
  aliases. A test asserts every authored record maps to a tab.
- Production database (read-only) now has 12 team photo rows for legacy products
  8042 and 10170, all at position 0. None attach to the new product IDs, so no
  record has an accepted gallery yet. Nothing was written to production.
- Not published. Existing unrelated failures remain in checkout, public-schema
  and browser tests.

## 2026-10-12 — Read-only public product prerequisite review

- Re-ran the anonymous operational audit against development: 21 exact SKU
  matches, 20 agreeing numeric prices, ATM price absent, no accepted gallery
  slots for any of the 21 records. Recorded the per-product review in
  `docs/product-operational-review-2026-10-12.md`.
- Published crawler probe finds robots.txt unavailable and Hydra Flux raw HTML
  still a generic app shell. No image URLs were available through the commerce
  interface to verify; six-slot image approval remains unresolved.
- Updated the runbook to distinguish historical WooCommerce discrepancies from
  current app-owned evidence. Owner review and scoped photo remediation remain
  prerequisites. No writes to commerce, uploads, activation, publication,
  checkout, dependencies or ignore rules.

## 2026-10-11 — Extended archive filename checks; failed publish diagnosed

- Added four disposable cases to `release-integrity-negative.test.mjs`: PAX `path`
  and GNU `L` long-name metadata give one approved member an absolute or
  parent-traversal effective name, while its literal ustar name stays approved.
  Each case checks unchanged outer pins reject first, then fixture-only envelope
  re-pinning must reach the `Unsafe archive paths` error (not tar behavior), with
  extraction-blocking probes, sentinels and retained outputs unchanged.
  Full file: 45 of 45 pass. No verifier, real archive, pin, rollback asset or
  publication configuration changed; no ignore rules changed.
- Failed publish build `f3f6e35d` stopped at the live API snapshot check: a
  15-second timeout against `api.ucfilters.com` after an earlier check in the
  same build passed. Both hosts answer in under a second afterwards, so it looks
  transient. Nothing was published; the gate is unchanged.

## 2026-10-11 — Companion sign-in guidance for old website accounts (development only)

- Investigated "all sign-in fails". Production holds 15 password accounts (all
  with valid bcrypt hashes and E.164 phones) and one social account; none is a
  Woo-provisioned identity. Published API traffic shows 401s taking ~0.8-25 s
  (an outbound website-login attempt) while a local-password sign-in took
  0.15 s and succeeded, so the failures are website-era customers with no
  Companion password. The current source has retired Woo authentication, so
  those customers can only get in through verified recovery or registration.
- Changed the Companion's neutral sign-in failure text to point to Forgot
  password / create account. It stays identical for every failure, so it does
  not reveal whether an account exists. No server, schema, password or account
  data was changed; no passwords were reset.
- Not published. The currently served API predates Woo retirement; the
  rollback-static capture for build `1791737829836-806` was completed
  later on 2026-10-11 (see that entry). Publishing also forces the one-time sign-in from the
  eight-hour session policy.

## 2026-10-10 — App-owned commerce source prepared, not published

- Implemented the approved WooCommerce-disconnection design in development:
  persistent app-owned product/variant identities, shared authored pricing,
  stock revision checks, unknown/unmanaged stock distinctions, and atomic
  managed-stock reservations. Fulfillment consumes reservations once; uncertain
  payment cancellations retain their holds for independent staff review.
- ProjectHub now supports creating drafts, editing shared records and prices,
  managing parent/variant inventory, publication/purchase switches and archiving
  without deleting order history. Companion uses the same source contracts.
- Runtime catalogue transports are local-only even with Woo credentials
  configured. Woo authentication, order writes/status synchronization and
  webhook ingress are retired. Verified self-service recovery can transition
  an existing Woo-backed local account to a local password without relinking.
- Added a bounded, reviewed offline historical-import tool. Preview is
  read-only; unmatched/conflicting ownership and pre-existing order anchors
  remain under review. Imports do not send mail, issue rewards, charge money
  or treat source status/paid timestamps alone as payment or COD evidence.
- Regenerated API contracts. Shared libraries, API, ProjectHub and Companion
  typechecks pass. Five focused isolated-database checks pass covering runtime
  retirement, stock admission/settlement, price persistence, import preview
  safety, draft creation and archive identity retention.
- Development API and ProjectHub workflows restarted and serving; public
  development catalogue uses app IDs and explicitly unknown stock. ProjectHub
  signed-out preview checked. A bounded real-browser wait confirmed the
  Companion public products page renders after cold-start loading. Signed-in UI and physical-phone receipt PDF
  evidence are not established by these checks.
- No production import, publication, release-selector change, customer payment
  or change to the separate WooCommerce website was performed. Verified stock
  baselines, app-owned media mapping and reviewed historical exports remain
  cutover prerequisites. Native iPhone/Android receipt checks remain incomplete.
- No dependencies, ignore rules or retained publication artifacts changed.

## 2026-10-09 — Approved security package selected and main aligned

- Recorded explicit exact-source selection and braces/forge backport acceptance
  for the verified cache revision. Immutable preparation archive/metadata and
  prior candidates remain retained.
- Updated handoff source and main's three dependency overrides/cache patch key;
  reused the identical guard file. Deterministic full-lock comparison preserved
  all 11 importers and unrelated resolutions instead of replacing main's graph
  with the older archived graph.
- Main frozen forced install, seven backport and seven actual-consumer checks,
  four typechecks, and 74 complete selection/handoff/integrity/policy tests pass.
  The earlier partial integrity timeout is resolved by this completed run.
- Main all-scope audit: two retained high braces/forge findings, zero critical
  or moderate. Findings are not suppressed.
- Relevant managed development workflows restarted and serving; ProjectHub
  preview checked. Existing optional native DevTools missing-library warning
  remains outside this security dependency scope.
- Latest read-only production target remains a successful public autoscale
  build. Full schema diff remains empty, without warnings/destructive changes.
  No production schema/data writes or publication performed; live API identity
  is not yet verified against the newly selected package.
- No published client pointers, publication outputs, product v2.4 source,
  unrelated feature files or ignore rules changed during this selection.

## 2026-10-09 — Security cache installation blocker resolved in a separate review

- Forced frozen reimport restored the existing cache backport; preserved
  manifest/lock checksums and did not edit installed code.
- Prepared genuine cache 4.3.0 with the identical retained guard, alongside
  fast-copy 4.1.0 and selector-parser 7.1.6. Source delta remains root manifest
  and lock only; all other 1,262 source files/modes and 11 importers unchanged.
- Two independent installations, including a clean exact-archive extraction
  with production NODE_ENV, passed both seven-case consumer/security suites.
  Fifteen lock/negative/policy checks passed, plus all consumer typechecks and
  API/Hub builds. Audit now has two high retained backport versions, no
  critical/moderate findings. Broader old integrity matrix timed out after six
  passing cases and is not claimed complete.
- Preparation uses forced frozen import and explicit build dependencies;
  consumer gates still run before output copy. Existing deployment pruning and
  schema/publication logic remain unchanged.
- Read-only production preflight: successful public autoscale build; empty full
  schema diff; both current hosts returned fresh agreeing snapshots. New package
  is not verified live and these observations do not authorize client advance.
- No runtime pins/lock/selection/client pointers, production data/schema,
  publication outputs or ignore rules changed. Prior review archives retained.

## 2026-10-09 — Uploaded Companion water-loader artwork applied in development

- Replaced shared bundled loading artwork with the supplied glossy falling
  droplet and two expanding ripples; retained the supplied SVG source geometry
  and gradients with a deterministic 1.5-second animated WebP conversion for
  Expo Image. Full alpha preserves soft ripples that binary GIF alpha discarded.
- Generated reduced-motion/error PNG from the actual supplied static SVG.
  Kept visible loading labels, motion/focus/background gates, layout footprint,
  retry behavior and all request/payment/authentication/navigation logic.
- Loader-specific regression checks passed; source frames and mobile app
  preview inspected. An existing broader layout test still expects obsolete
  immediate AuthProvider/CartProvider nesting and was not altered.
- No packages, manifests, lockfiles, frozen selectors, publication outputs,
  production schemas or ignore rules changed. This development artwork is not
  included in the retained security-only release package.

## 2026-10-09 — Additional dependency review; release blocked on patch installation

- Owner chose security-only remediation with a separate product-schema review.
  Prepared a separate unselected archive with only root manifest/lock changes
  for fast-copy 4.1.0 and postcss-selector-parser 7.1.6.
- Genuine registry releases/licenses/integrities verified; preserved every
  non-target package, all 11 importers, peer contexts and 1,262 other source
  files/modes. Rejected resolver pruning rather than including unrelated changes.
- Verified upgraded logging/selector consumers and compiled logging-worker
  dependency. API/typography builds and typechecks passed during review.
- Cache 4.3.0 failed the existing private/max-stale safety fixture. Original-hash
  and distinct-hash rebased declarations also failed installed-consumer checks.
  Stopped that upgrade path; review source retains the original 4.2.0 backport.
- Isolated installation of the retained cache backport also lacks its guard
  despite frozen-install success and a hash-qualified path. Main and its
  unchanged selected parent's installed consumers retain the guard. Root cause
  is unresolved; archive is explicitly blocked, not release-ready.
- Candidate all-scope audit: zero critical/moderate, three retained high versions.
  No suppressed advisories or implied additional risk acceptance.
- No main manifest/lock/handoff selector updates, client advances, schema writes
  or publication. No ignore-rule changes; unrelated uploaded assets untouched.

## 2026-10-09 — Select verified security-only dependency revision in main

- Owner approved the exact three-file revision and its two tested backport
  mitigations. Saved a separate selection-only approval; retained previous
  archives, original preparation evidence and prior owner records unchanged.
- Main handoff selects the exact reviewed archive. Root runtime pins are aligned
  for sharp, shell-quote and music-metadata without replacing main manifests
  with frozen ones or activating consolidated feature source.
- Preserved main importer semantics except the approved sharp version and its
  existing WhatsApp peer reference. Retained original codegen peer contexts and
  minimized generated-lock formatting churn.
- Verified all 1,264 retained source files/modes before adopting the previously
  installed review stage. Local-only handoff/API compilation passes. Seven
  selection/runtime approval checks and all 41 archive-safety checks pass;
  patched startup and consolidated-review fixtures remain compatible.
- Main and selected source typechecks/build verification pass. Development API
  and Companion services restarted successfully; API health endpoint responds.
- Production target inspected read-only: public autoscale, successful build.
  Full current schema diff is empty, with no destructive or compatibility
  warnings. Public API snapshots agree/fresh at 10:44 UTC, but this does not
  prove the new selected source is published.
- Production-only audit reports zero critical/zero moderate/two accepted
  backport advisories. Broader Security Center reports three high version-based
  backport advisories and two additional moderate findings. Publication remains
  on hold for that additional review; no implicit extra risk acceptance.
- No production publication/schema application, deployment-output copies,
  client selector changes or native distribution. No ignore rules changed.

## 2026-10-09 — Unselected security-only dependency review

- Prepared an exact dependency-only archive derived from the approved frozen
  parent. Only the root/API manifests and lockfile change; all 1,261 other
  retained files remain byte-identical. No consolidated feature changes.
- Registry-verified sharp 0.35.5 (Apache-2.0), shell-quote 1.11.0 (MIT) and
  music-metadata 11.16.0 (MIT). Preserved unrelated frozen lock importers and
  codegen peer contexts instead of accepting incidental pnpm pruning.
- The exact installed candidate passes shared-library and all three consumer
  typechecks, API/ProjectHub/Companion static builds and 72 targeted checks.
  Auth/upload tests used a disposable database and dropped it afterward.
- The candidate production audit reports zero critical, zero moderate and
  two high version-based advisories covered by unchanged backports and
  installed-consumer tests. The advisory feed is not declared clean; risk
  review remains a selection/publication gate.
- Added deterministic byte-scope verification, negative scope tests, runtime
  dependency regressions and a review README/evidence. Main still selects the
  earlier archive. External runtime dependencies must be aligned in main
  before a later API publication; prepared archive bytes alone are not a live
  sharp fix.
- No production writes, schema changes, provider changes, deployment output
  copies, active client changes, native binary distribution or publication.
  No ignore rules changed.

## 2026-10-09 — Fresh client-publication gate and dependency blocker

- Revalidated the selected archive and fresh agreeing snapshots on both public
  API hosts. The full current production schema diff remains empty.
- Inspected the newly served predecessor client build. All three bundles and
  56 referenced assets are available; active native manifest routes identify
  the matching build. Versioned manifest paths return 404, but the existing
  active/root-manifest fallback works. Availability does not constitute a
  complete retained rollback copy.
- Audited production dependencies from the exact frozen archive in a
  disposable `/tmp` extraction, without installing or modifying dependencies.
  The audit reports one critical, three high and three moderate advisories.
  Braces and node-forge have recorded backports; shell-quote and sharp fixes
  are absent from the selected package and block further publication.
- Recorded the gate result in
  `infra/cloudflare/forest/rollout-evidence/fresh-client-release-gate-2026-10-09.json`.
  No publication, client pointer changes, production writes, dependency/source
  changes or application tests were performed. No ignore rules changed.

## 2026-10-09 — Coordinated main consistency/security release verification

- Verified the exact selected retained archive and saved owner scope without
  changing selection. Inspected the verified public autoscale target and full
  production schema diff: zero pending statements and no destructive warnings.
- Fetched matching successful publication build logs. They identify the
  checksum-specific approved API stage, passing retained fixtures, compilation
  and successful publication; runtime-log search alone had returned no logs.
- Found eleven additive schema statements outside the narrow consistency
  source scope in that prior publication. Recorded them in the coordinated
  evidence and stopped client advancement for scope review.
- Verified fresh agreeing snapshots from both public API hosts. API version
  probes still lack public source attestation. The served Companion retains
  its predecessor revision with a newly served build ID, so older rollback
  evidence is insufficient.
- Updated the shared guide to distinguish latest evidence from the historical
  security handoff. No publication, production writes, initialization, source
  selection or application/dependency changes. Existing development port
  mapping changes were left untouched; no ignore rules changed.

## 2026-10-08 — Approved observability roadmap and testing procedures

- Recorded approval of the written staged specification and added the requested
  testing locations and steps.
- Added an eight-milestone implementation/release plan covering exact source,
  integrity/security, isolated checks, API-only publication, live verification,
  independent uptime, native coverage and final acceptance.
- Extended `docs/release-observability-and-test-guide.md` rather than creating a
  competing command guide. Section 9 separates root guards, frozen stages,
  disposable databases, development browser/Expo Go, signed native devices,
  read-only production checks and external uptime tests.
- Included exact current test commands, browser synthetic-event steps,
  expected results, cleanup, privacy/permission checks and stop conditions.
  Working-tree, frozen-package, production and physical-device evidence are
  explicitly distinct.
- Inspected the merged security handoff: its source-live check remains
  unverified; a merged guide/evidence file is not publication proof.
- Documentation-only changes. No production writes, release selection,
  application code/dependencies, provider activation, client advancement or
  publication. No ignore rules changed.


## 2026-10-08 — Extended archive link metadata checks

- **Scope:** Disposable regression evidence only. No production verifier edits,
  real release re-pinning, archive changes, rollback changes or publication.
- **Changes:** Extended the existing symbolic/hard-link matrix with PAX
  `linkpath` and GNU `K` long-link metadata for both absolute and parent-relative
  external targets. Each extension overrides a harmless literal linkname with a
  target longer than the ustar field can hold. Exactly one approved regular
  member is replaced; tar listing confirms the complete approved name order
  and the effective link target. All possible destinations belong to the fixture.
- **Verification:** `node --test
  infra/cloudflare/forest/release-integrity-negative.test.mjs` passed all 41 checks
  with GNU tar 1.35, including eight new extended-header cases. Unchanged outer
  pins reject the forgery first. After fixture-only envelope re-pinning, direct
  auth/upload verification, handoff and all three builder entry points must
  report the hardened link preflight error. Probes block every extraction and
  build/network/output effect; external and retained-output sentinels remain
  unchanged, no extraction directory appears, and fixture removal is asserted.
  Real retained input/tool/publication-config hashes remain unchanged.
- **Evidence limit:** These checks depend on tar recognizing the metadata during
  listing; they do not exercise forged extraction or prove tar's own extraction
  defenses. Expectations use the existing hardening policy prohibiting all
  symbolic/hard links, rather than accepting tar-specific warnings or later
  byte/path failures as preflight evidence.
- **Ignore changes:** None. Forged archives and pins remain disposable copies.
- **Status:** Locally verified only; no publication or release selection change.

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


### 2026-10-16 — Approved Google product-event debug transport check

- **Scope/approval:** Owner supplied `G-K224XGM5KB`, Google Analytics collection,
  and debug markers for a bounded development check, not permanent activation.
- **Changes:** Recorded approved destination, sanitized per-event network
  evidence and its limits in
  [Google product-event debug verification](google-product-events-debug-verification.md);
  linked it from the original product-page verification record. No runtime
  source, app flags, payment configuration, hosting or dependencies changed.
- **Verification:** Six existing focused product-selection tests passed.
  Six synthetic non-purchase debug events left an isolated browser once each;
  two Google collector requests returned HTTP 204. No real payment or external
  purchase event. The owner separately confirmed all six in DebugView and
  clarified that they appeared after the supplied empty-state screenshot.
  Final report visibility is owner-attested, not agent-observed.
- **Ignore changes:** None. Disposable diagnostic stayed under already-ignored
  `.cache/`; no raw browser/session identifiers or customer data retained.
- **Status:** Approved development ingestion check complete; not activated or
  published. No additional events sent after owner confirmation. Task completion
  is blocked by configured project-wide validation: `cd artifacts/uc-companion
  && npx expo-doctor` reported 11 SDK patch mismatches, and `cd artifacts/api-server
  && pnpm test` failed across existing API flows. All typechecks, startup-fonts
  and completion code review passed. Checks were not bypassed.
- **Remaining:** Any positive external purchase check requires separate
  verified-paid setup/authorization. The downloaded tag omitted item context
  for share/compare and attempted extra collection during preliminary blocked
  checks; permanent-loader privacy and report completeness need separate work,
  and no broad rollout is approved.


### 2026-10-17 — Owner-approved Expo and API validation repairs

- Aligned eleven Expo SDK patch versions and the lockfile. Expo Doctor now
  passes 20/20; no version/age gates or activation settings were disabled.
- Replaced demo-product assumptions with isolated app-catalogue fixtures in
  supported checkout tests. Preserved local identity, administration checks,
  payment recovery, guest-payment safety, promotions and repeat-confirmation
  assertions without enabling WooCommerce.
- Fixed missing per-field checkout errors and explicit payment-verification
  retryability. No payment approval rules, collector flags or production data
  changed.
- The repaired focused batch passes 235/235, with no skips/cancellations.
  Shared-library, API and Companion typechecks pass. API health and signed-out
  Companion rendering were confirmed after workflow restarts.
- Existing dependency backport regressions pass 7/7. Upstream-version audit
  still flags two high advisories; those warnings are not described as a clean
  audit.
- The owner additionally approved replacing retired Woo success-path tests
  while preserving app-owned coverage. Consolidated explicit disconnection
  checks and retained local payment/receipt/ownership/export/inventory and
  editorial assertions; see the [coverage transfer](api-retirement-validation.md).
  No dormant integration was enabled and no new test was skipped.
- Startup-fonts passes with the aligned packages. Project-wide validation
  remains the final completion gate; focused runs and the earlier review are
  not substitutes for that gate.
- The full repair check exposed three remaining test-isolation failures:
  shared-seed price pollution and a customer-count plan under concurrent
  fixture writes. Added cleanup/serial execution rather than relaxing prices
  or the index-only assertion.
- No publication, payment execution, additional Google debug events or ignore
  changes. Details: [verification and repair record](google-product-events-debug-verification.md).

### 2026-10-10 — Fail-safe publish scratch folders

- **Scope/approval:** Task: stop leftover build folders from failing a publish after every build step passed. No publication, API or client behavior, or database change.
- **Changes:** The post-build cleanup now classifies folders under `.consistency-build/` and `.hydrate-release` as approved, scratch or invalid-marker. Unmarked hash-named and other non-stage folders are scratch and only lose installed `node_modules`; wrong markers, a legacy stage without a marker and symlinks still fail closed before any removal. The build prints a per-folder status/size summary and an image total, with a warning above 7 GiB (`DEPLOYMENT_IMAGE_WARN_BYTES` overrides).
- **Verification:** `scripts/tests/deployment-image.test.mjs` (12 tests) including unmarked hash-named, scratch-with-dependencies, approved-stage, wrong-marker, symlink, summary and limit cases. Read-only report run on the real workspace.
- **Ignore changes:** None.
- **Status:** Source implemented and tested locally; not published.
- **Remaining:** Confirm the next real publish shows the summary and completes the image upload.

### 2026-10-10 — Approved consistency clients: evidence, retention and selection

- **Scope/approval:** Rollout of the paired Hub/Companion clients after the API-first publication, on the owner's chat instruction. Out of scope: the clean-water-days formula, shared-row initialization/import, schema statements.
- **Changes:** Retained the complete actually served build `1791627160418-469` (browser/iOS/Android bundles, both native manifests, 56 referenced assets, 0 failures) under `infra/cloudflare/forest/rollback-static/`; older retained build left untouched. Through the artifact validation tool, set the Hub build, Companion build (`--retain-static=infra/cloudflare/forest/rollback-static`) and Companion run commands to the approved-consistency builder. Added evidence record `rollout-evidence/main-client-gate-2026-10-10.json`.
- **Verification:** The builder's retention check passed on the new directory; consistency handoff tests (9) passed; handoff, schema diff (no statements) and both-host snapshot gate (fresh, compatible, agreeing, revision 1) checked at about 11:15Z. API build evidence is in the record: candidate, command, cleanup result, 3346.4 MiB against the 7168 MiB warning threshold, startup. Unverified and marked as such: publication-approval timestamp, runtime attestation of the running API source, platform hard image limit.
- **Lineage finding:** The published API was compiled from `d7ee99bd…` (main's selected security-only revision), not `db2ef861…` as the instruction states. A byte comparison shows only security-only API changes and dependency pins; Hub, Companion, impact routes, schema and generated clients are identical. The saved approval record for `d7ee99bd` still reads client advancement not approved.
- **Ignore changes:** None; the existing rollback-static node_modules exception already covers the retained dependency files.
- **Owner confirmation:** The owner confirmed in chat that client advancement covers the `d7ee99bd` lineage.
- **Status:** Retained and selected in configuration; clients not yet published.
- **Remaining:** Publish click, served-asset verification on both hosts, signed-out/admin/customer snapshot comparison (second customer identifier and access needed), physical-phone checks with the separate usability task.

## 2026-10-10 — Owner-approved independent public-impact monitor prepared

- **Scope/approval:** Owner approved GitHub Actions with a dedicated issue,
  five-minute probes, fifteen-second request timeouts, three matching failures
  to warn and two healthy checks to recover. Activation remains separate opt-in.
- **Changes:** Added standalone read-only health/impact probes reusing the
  existing compatibility/freshness/agreement contract. Added strict persisted
  issue state, serialized opt-in scheduling, claimed-before-send comments,
  uncertain-delivery reporting and fourteen-day sanitized evidence retention.
  Added the approved design and guide section 10 with no-send, activation,
  investigation and disable steps.
- **Verification:** 41 isolated checks passed, including unavailable-target
  external delivery, threshold/recovery boundaries, corrupted state,
  oversized/hung bodies, duplicate/gapped runs and ambiguous write outcomes.
  Workflow YAML parsed; schedule and safe manual default verified. At
  2026-10-10T13:56:30.193Z, a no-send public check returned HTTP 200 health and
  fresh compatible agreeing snapshots from both hosts: adjustment revision 1,
  six users, 1,550 litres, 3,100 plastics and zero clean-water days.
  Public snapshot agreement is not running API-source identity evidence.
- **Ignore changes:** Added only `/generated-artifacts/public-impact-monitor/`
  to Git and publication ignores; reason recorded in `docs/gitignore-record.md`.
- **Status:** Source prepared and locally verified, not active or published.
  GitHub issue setup, scheduler execution and recipient delivery are unverified.
  No issue created, repository opt-in changed, live alert sent, production row
  initialized, schema applied, client advanced or hosting/DNS/auth/OTA/native
  distribution changed. Existing application workflows were not changed.
- **Remaining:** Owner-controlled issue/subscriptions and explicit activation,
  followed by scheduled evidence and separately approved recipient-delivery
  verification. Indefinite scheduler failure needs a separate dead-man monitor.

## 2026-10-10 — Bounded WhatsApp session backup retries

- **Scope/approval:** Owner approved retrying failed credential uploads only,
  with four application-level save calls and one-, two- and four-second backoff.
  Transient network/TLS, timeout, rate-limit and server failures are eligible;
  unknown, permission, configuration and certificate-trust failures are not.
- **Changes:** Added an injected session-sync helper with safe structured
  categories and cancellable backoff. Production wiring captures the socket
  generation and aborts obsolete backoff on Disconnect/new lifecycle. Every
  admitted parallel upload settles before the serialized queue returns, so
  existing Disconnect cleanup cannot run ahead of another pending write.
  Re-read local bytes before retry; do not replay successful sibling uploads.
  Removed raw exception text from upload and credential-queue failure logs.
- **Verification:** All 20 isolated checks passed. Storage/timer fixtures cover transient recovery
  without another credential event, retry exhaustion, permanent failures,
  generation changes during read/backoff/save, cancellation, parallel-write
  draining and Disconnect cleanup. Existing reset-ordering tests are included.
  API typecheck passed. Development API compiled/restarted and returned
  health status `ok` after startup; no Connect/Disconnect endpoint was invoked.
  These checks establish source/development behavior, not a production backup.
- **Privacy/isolation:** Synthetic in-memory storage only. No live WhatsApp
  prefix, real credential files, customer notifications or operational resets
  used in tests. New logs contain fixed categories, attempt counts and delay
  durations, not filenames, credential contents, provider messages or URLs.
- **Ignore changes:** None. No packages, manifests, locks, schemas, production
  data, frozen selectors, retained assets or publication settings changed.
- **Status:** Development source verified; production publication and actual
  session backup health remain unverified. Existing SDK internal retries are
  unchanged; four calls is not a hard end-to-end network deadline.

## 2026-10-10 — Complete WooCommerce disconnection design

- **Scope/approval:** Owner requested Companion-owned products with the shared
  ProjectHub schema, then selected complete disconnection including Woo-backed
  authentication and historical order syncing. Detailed design is proposed for
  review, not yet implementation/cutover approval.
- **Investigation:** Phone evidence showed a product-verification checkout
  failure, not a receipt PDF result. Reproduced HTTP 422 with a read-only
  development quote. Fresh provider metadata showed the EcoSmart product
  published/in-stock with price 9799 but not purchasable. Public deployed API
  also lacked the current source quote route; the phone's precise build/origin
  was not established. No order, payment or customer communication was created.
- **Changes:** Wrote the shared product/inventory, local commerce, identity and
  historical-data migration design with retirement and release safeguards.
  Updated remembered owner direction so Woo verification is not incorrectly
  retained as a permanent catalogue requirement.
- **Verification:** Read-only source/provider inspection only. No code, schema,
  production data, store configuration, secret or release selector changed.
  Existing browser/unit receipt evidence does not prove native OS handoff;
  iPhone/Android saving/sharing/cleanup verification remains incomplete.
- **Ignore changes:** None. Design and development history are tracked; supplied
  screenshots containing contact information are not copied into documentation.
- **Status:** Complete migration scope confirmed; written design awaits review.
  No migration, operational cutover or publication is claimed.

### 2026-10-10 — Company master workbook v7: retail prices and SKU register

- **Scope/approval:** Owner supplied `UC_MASTER_v7_FINAL_7Oct2026` as the company SKU and price authority and asked for it to be saved in ProjectHub and applied to the earlier uploaded product pages (not WooCommerce). Development workspace only.
- **Changes:** `retail-prices_v7.json` (revision 2) replaces v6; the one-time price import therefore re-prices matching pages once at startup (Hydra Flux 4399 to 4199, Aqua Stream UC-COM-ROS-002 49990 to 56999, Derma Flux gains 7099 but stays not purchasable). `sku-master_v7.json` holds the 49 child SKUs; `uc_sku_register` stores them (no cost, margin or trade prices) and ProjectHub Inventory shows them. `apply-sku-master-stock.ts` copies the workbook quantities into app stock only for rows still "unknown" (explicit action, audited). `build-sku-master.mjs --check` verifies the JSON against the workbook.
- **Verification:** API and ProjectHub typecheck; `sku-master.test.ts`; dev API shows the new prices and stock. `product-editorial.test.ts` already failed 6 tests before this change.
- **Ignore changes:** None.
- **Status:** Source and development data only. Not published.
- **Remaining:** Production stock application needs separate approval (`--approved-production-import`). Publishing runs the price revision automatically. Workbook stock provenance is unconfirmed.

### 2026-10-11 — Reproducible security patch installation gate

- **Scope/approval:** Task assignment to resolve the blocked, unselected Security Center dependency review (`a982fb10…`). No selection, publication, schema or client change.
- **Changes:** `security-patch-installation.mjs` (installed-backport verification and a reproduction harness), its unit tests, and gates in `build-approved-consistency.mjs` before the prepared marker and on every cache reuse; builder tool lists in the handoff and integrity tests include the new module. Retained `installation-root-cause.md` and `installation-verification.json` in the review folder and updated its README and validation record. The sealed archive, candidate, scope and patch files are unchanged.
- **Verification:** Two independent cold installs (one with `NODE_ENV=production`) and two warm repeats pass 7/7 backport fixtures; negative inactive-patch checks reject; typechecks, api/hub builds, runtime consumers, worker fast-copy 4.1.0, lock checks, integrity (41) and handoff (9) suites pass. Audits: 3 high all-scope, 2 high production-only, none suppressed. Root cause partly established: plain frozen installs trust an existing hash-qualified directory; how the original unpatched directory arose was not reproduced.
- **Ignore changes:** None. Disposable stages and stores lived under `/tmp` and were removed.
- **Status:** Source and retained evidence only; ready for owner review. Not selected, not published.
- **Remaining:** Owner source selection, acceptance of retained high-version advisories, separate API publication approval.

### 2026-10-11 — Publish build failure: served Companion build not retained for rollback

- **Scope/approval:** User asked to debug a failed publish build. No source, dependency, schema or client-behaviour change; nothing published.
- **Cause:** The Companion build step failed in `retainRollback` with ENOENT for `rollback-static/1791639585757-806/build-info.json`. Every earlier check in that build passed (backport gate and fixtures, API tests, typechecks, Hub build). The builder fetches `https://app.ucfilters.com/version.json` and requires the currently served build to be retained first. The previous publish (2026-10-10) made `1791639585757-806` the served build, but only `1791627160418-469` and `1791182522315-296` were retained. The gate worked as designed.
- **Changes:** Captured the served build from the public origin into `infra/cloudflare/forest/rollback-static/1791639585757-806/` (browser/iOS/Android bundles, both native manifests, 56 referenced assets, 60 files, 0 failures) with `1791639585757-806-capture.json`. Older retained builds untouched.
- **Verification:** `retainRollback` accepts the new directory in a scratch destination (184 files); consistency handoff tests 9/9. The full publish build was not rerun locally.
- **Ignore changes:** None; the existing rollback-static node_modules exception covers the files.
- **Status:** Source/assets only; not published.
- **Remaining:** Publish again. Each publish changes the served build, so the next one needs this retention repeated for the build then being served.

### 2026-10-11 — Served-client verification after the paired client publication

- **Scope/approval:** Read-only verification for the consistency rollout; no change to hosting, DNS, auth, OTA, native distribution, API or database.
- **Observed (about 17:00Z):** `app.ucfilters.com` and `team-horizon--jerryaroyce.replit.app` both serve build `1791737829836-806` (revision `consistency-d7ee99bd…`, built 2026-10-11T16:58Z, API origin `https://api.ucfilters.com`). The iOS and Android launch manifests on both hosts show the same IDs and launch keys `bundle-1791737829836-806` with launch URLs on `app.ucfilters.com`. Web, iOS and Android bundles hash identically on both hosts (SHA-256 prefixes 072196dd, 58ec2c96, 7432ae98). The web bundle references only `api.ucfilters.com`.
- **Not yet verified:** Home/About/ProjectHub snapshot comparison signed out, as the configured admin, and as the two approved customers (needs the second customer's identifier and secure access); physical-phone checks (separate usability task); fresh API snapshot agreement was not re-taken in this entry.
- **Retention note:** the now-served build `1791737829836-806` is not in `rollback-static/`; capture it before the next client publish.
- **Ignore changes:** None.
- **Status:** Clients are live; the rollout task is not complete.

### 2026-10-11 — Product records v2.6 (grouping, comparison, replacement filters, fit photos)

- **Scope/approval:** User supplied the v2.6 product-page demo and chose "Everything, new pages unpublished".
- **Changes:** Records and schema moved to v2.6 (21 existing products updated, 11 new products as unpublished, non-purchasable drafts, 5 comparison groups). One-time guarded database import (`content_import_revision`) adds new fields and replaces suitability/evidence text only where a row still equals the old seed; staff edits are kept. API `/uc/product-records` now returns `groups`. Companion shows fit photos and "Fits" tags, and compares within a group. Public HTML renders fit photos. 17 new images added under `artifacts/api-server/public/products/`. Prices and SKUs still come from the v7 workbook; demo price differences (Timbo, Breeze, Flex, Survivor replacement) were not applied.
- **Verification:** record tests, new migration test, type checks, and a live check of `/api/uc/product-records`. Existing failures in `product-editorial.test.ts` (6) and one record-products adapter test were failing before this change.
- **Ignore changes:** None.
- **Status:** Source only; not published.
- **Remaining:** Staff review of the 11 drafts; prices for RRO and ROT; child SKU `UC-HOU-TAPF-006-XX` missing from the SKU master.

### 2026-10-11 — Rollback retention captured for served build 1791737829836-806

- **Scope/approval:** User approved capturing the currently served Companion build so the next publish passes the rollback-retention gate. No source change; nothing published.
- **Changes:** Downloaded the served build from `https://app.ucfilters.com` (confirmed via `version.json` as `1791737829836-806` immediately before and during capture) into `infra/cloudflare/forest/rollback-static/1791737829836-806/` (web, iOS and Android bundles, both versioned native manifests, 56 referenced assets, 60 files, 0 failures) plus `1791737829836-806-capture.json` with sizes and SHA-256 hashes. Older retained builds untouched; the rollback gate was not weakened.
- **Verification:** `retainRollback` accepts the new directory in a scratch destination (245 files).
- **Ignore changes:** None.
- **Status:** Assets only; not published.
- **Remaining:** Each publish changes the served build, so the build then being served must be captured before the following publish.

### 2026-10-17 — Repair inventory schema reconciliation after merge

- **Scope:** Repair the failed post-merge setup without deleting inventory.
- **Root cause:** Startup SQL created `UNIQUE (sku)` under PostgreSQL's name
  `uc_catalogue_inventory_sku_key`; the unnamed Drizzle declaration expected a
  different constraint name and triggered a populated-table truncation prompt.
- **Change:** Declare the existing constraint name explicitly. Keep the setup
  script's non-interactive prompt-failure protection unchanged.
- **Verification:** Read-only development constraint inspection confirmed the
  existing unique SKU constraint. Full post-merge setup then succeeded in
  28 seconds, including schema reconciliation, codegen and library typecheck.
  API and ProjectHub workflows were restarted after reconciliation.
- **Ignore changes:** None.
- **Status:** Development repair only; no production publication, credential
  access or intentional inventory data change. Payment and product-page
  verification tasks remain incomplete.

### 2026-10-18 — Products banner slideshow implemented in main

- **Scope:** Owner explicitly requested execution of the attached specification
  here. Use first/left artwork for shower filters, middle for household systems,
  and third for bottles. No publication or payment-task completion.
- **Changes:** Bundled three compressed 1200×600 images; excluded poster
  headlines/contact/footer content and preserved photographed products. Added
  three-second slideshow, all-image readiness gate, motion/focus/visibility
  pauses, first-frame reset, animation cleanup and accessible cart overlay.
  Preserved search/categories/list/Alison and Home/Blog/detail pages.
- **Verification:** Companion typecheck passed. Full Companion tests:
  987 total, 935 passed, 52 failed outside the banner checks. Banner/loading
  checks passed. Chromium confirmed image decoding, 390/820/1440 layouts
  without horizontal overflow, cycling, reduced-motion reset and tab navigation.
  Screenshots were visually inspected at phone and desktop widths.
- **Ignore changes:** None. Three new image files total about 122 KB.
- **Status:** Main source only; frozen candidate and publication not changed.
  Physical native verification and unrelated suite failures remain open.

### YYYY-MM-DD — Change title

- **Scope/approval:** What was requested and any explicit operational approval.
- **Changes:** Every related change and its purpose; link focused evidence.
- **Verification:** Commands/results and evidence limits.
- **Ignore changes:** Patterns added/removed and reasons, or none.
- **Status:** Source / prepared / compiled / selected / published / rolled back.
- **Remaining:** Concrete unfinished checks or blockers.
