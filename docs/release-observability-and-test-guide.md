# Release observability and implementation test guide

## Purpose and current status

Use this guide to determine whether approved code is actually running, not just
whether a build succeeded. It covers the API-first sign-in/upload security
release and provides a reusable checklist for later implementations.

**This guide is not publication approval.** No publication, production
initialization, schema changes, client advancement, or native distribution is
authorized by it.

The retained security candidate is:

`88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`

Expected build source identity:

`consistency-88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`

### Latest verification — 2026-10-09

The retained archive and owner scope pass verification. The latest successful
publication's full build logs now show the checksum-specific API stage,
API compilation/deployment preparation and successful publication. This
provides stronger package provenance than the October 8 check below; public
API `/version.json` responses still do not provide runtime attestation.

The current full production schema diff is empty, with no destructive or
compatibility warnings. However, the successful publication logged eleven
additional additive statements for guest-payment links, product editorial,
order variants and AI feedback. These are outside the narrow consistency
package. **Stop client advancement pending scope review**; an empty current
diff must not conceal changes already included in the preceding publication.

At **06:15 UTC**, both public API hosts returned compatible, fresh, agreeing
snapshots. The served Companion remains on the predecessor revision, but now
has build ID `1791490658960-487`; rollback evidence must match the actual served
build, not an older captured build. Remaining security-live checks are not
established by these read-only probes. No publication or production writes
were performed during this verification.

Evidence:
`infra/cloudflare/forest/rollout-evidence/main-coordinated-verification-2026-10-09.json`.

### Historical verification — 2026-10-08

At the read-only check on **2026-10-08 at 15:20 UTC**, both public API hosts
returned compatible, fresh, agreeing impact snapshots. The API custom host
returned 404 for `/version.json`; the Replit host returned HTML rather than
revision JSON. Neither response identifies the API source. Deployment metadata
reported a successful public autoscale build, but matching build/image-size logs
were unavailable. **The security candidate is not verified live.**

These snapshot results are historical evidence, not a permanent freshness pass.
Repeat them after verified publication and immediately before client advancement.

Evidence:

- `infra/cloudflare/forest/rollout-evidence/auth-upload-security-live-verification.json`
- `infra/cloudflare/forest/rollout-evidence/auth-upload-security-preparation.json`
- `infra/cloudflare/forest/auth-upload-security/owner-approval.json`

## 1. Approval and release boundaries

Before publishing, record separate owner approval for the exact API candidate.
The existing record approves source selection only.

Tell customers:

> This security update requires a one-time sign-in for older sessions that had
> no expiry. Newly issued sessions expire after eight hours. No new refresh or
> logout feature is included.

Preserve these production settings:

| Setting | Required state |
| --- | --- |
| API build | `node infra/cloudflare/forest/build-approved-consistency.mjs api --copy-output` |
| ProjectHub client | Existing `release-build.mjs hub` predecessor selection |
| Companion client | Existing `release-build.mjs companion` predecessor selection |
| Post-build cleanup | `node scripts/prepare-deployment-image.mjs --post-build` |
| Production initialization / schema | No changes without separate approval |

Do not switch to whole-workspace source builds, change client pointers, remove
rollback assets, or manually run cleanup to make a verification check pass.

## 2. Verify retained inputs before testing

Run from the repository root:

```sh
node --input-type=module <<'JS'
import { verifyHandoff } from './infra/cloudflare/forest/consistency-handoff.mjs';
const info = await verifyHandoff();
console.log(JSON.stringify({
  candidateSha256: info.candidateSha256,
  baselineSha256: info.baselineSha256
}, null, 2));
JS
```

Pass only when verification exits successfully and the candidate hash matches
the exact approved hash above. This checks retained release inputs and approval
records; it does not establish that production uses them.

Read the retained README, scope and patch to identify the implementation being
tested. A passing working-tree test cannot substitute for a frozen-candidate
test.

## 3. Local implementation checks

### Packaging and rollout gates — no production writes

```sh
node --test \
  infra/cloudflare/forest/auth-upload-security.test.mjs \
  infra/cloudflare/forest/consistency-handoff.test.mjs \
  scripts/tests/deployment-image.test.mjs
```

Inspect failures rather than regenerating approval records. These checks cover
release validation, snapshot compatibility rules and cleanup behavior. They are
not proof of live deployment or actual publishing image size.

### Compile the selected candidate

This command installs/builds into the checksum-specific local staging folder;
it is not a publish command and does not copy deployment outputs:

```sh
node infra/cloudflare/forest/build-approved-consistency.mjs api --local-only
```

The builder runs retained dependency/security fixtures, API typechecking and
compilation. It does not run the two database-backed security fixtures or all
consumer typechecks. Verify shared libraries and each frozen consumer separately
when revalidating a changed candidate; use its staging folder, not the current
working tree.

### Database-backed checks — disposable test database only

Use the retained stage after successful local preparation. The stage root is:

`.consistency-build/88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`

Run the existing test wrapper from its API directory:

```sh
cd .consistency-build/88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82/artifacts/api-server
TEST_GLOB='src/tests/{customer-count-auth,storage-upload-allowlist}.test.ts' pnpm test
```

Use an approved development test infrastructure connection that can create and
drop disposable databases. Never use production credentials. Do not print the
connection string. Confirm the wrapper creates its per-run database and drops
it afterward. Do not invoke these fixtures directly against an existing
development or production database.

### Required security outcomes

| Area / retained fixture | Pass criteria |
| --- | --- |
| `jwt-session-expiry.test.ts` | Default eight-hour expiry; missing, malformed, expired and exact-boundary expiry rejected |
| `customer-count-auth.test.ts` | Active team members/admins retain access; the same bearer loses access immediately after deactivation/deletion; customer and invalid principals rejected |
| `review-media-signature.test.ts` | Exact MIME allowlists and bounded byte inspection; a claimed safe MIME cannot bypass signature checks |
| `storage-public-media-security.test.ts` | Safe inline types only; unsafe originals forced to download; original/derivative responses have sandbox CSP and nosniff |
| `storage-upload-allowlist.test.ts` | Unsupported uploads rejected; attachment verification enforces retained rules |

A test pass applies to those tested bytes and conditions. Record command,
candidate hash, time, exit code, failures and database cleanup result. Do not
copy access tokens, customer data, upload contents or secrets into evidence.

## 4. Publication evidence and image size

After separate approval and API-first publication, inspect the publishing build
logs and runtime logs. Save a sanitized release record containing:

1. Approval and publishing timestamps, and exact candidate hash.
2. Build command and proof that it selected the retained candidate.
3. Successful fixture, compilation and post-build cleanup results.
4. Final publishing image/layer measurement, its units and the platform limit.
   The earlier failure was at an 8 GiB image limit; use the actual limit reported
   by the new build. Local directory size is not an image measurement.
5. Successful image acceptance, deployment activation and startup.
6. A trusted connection between that build and the currently served API.

Check deployment metadata, but do not treat `hasSuccessfulBuild: true` as
candidate evidence. It may describe an older successful build. Missing logs
mean **unverified**, not **passed**.

Do not delete entire stage folders to reduce image size. Compiled workers and
static servers can still depend on their paths; keep rollback archives and
runtime assets.

## 5. Read-only live API checks

### Health

```sh
for origin in https://api.ucfilters.com https://team-horizon--jerryaroyce.replit.app; do
  curl --fail --silent --show-error --max-time 15 \
    -H 'Cache-Control: no-cache' "$origin/api/healthz"
  printf '\\n'
done
```

The current health endpoint reports application liveness. It does not certify
the database, external providers, security behavior or candidate identity.

### Fresh, agreeing snapshots

```sh
node --input-type=module <<'JS'
import { verifyLiveApi } from './infra/cloudflare/forest/consistency-handoff.mjs';
console.log(JSON.stringify(await verifyLiveApi(), null, 2));
JS
```

Pass requires HTTP success on both hosts, valid JSON and the exact compatible
contract: 64-character hex snapshot ID; positive integer adjustment revision;
`maxAgeSeconds: 60`; boolean lifespan availability; nonnegative finite totals;
calculation within the validator's freshness/future-clock bounds. Both hosts
must agree on comparison fields; their calculation timestamps may differ.

Timeout, stale calculation, incompatible fields, disagreement or an old
zero fallback blocks advancement. An unavailable probe does not prove downtime.
Capture UTC time and check clock accuracy before interpreting age failures.

### Source identity — publication provenance versus public attestation

Do not assume `/version.json` exists on the API. Do not accept a 200 HTML
fallback as revision JSON. The Companion version at
`https://app.ucfilters.com/version.json` describes the client baseline checked
by the build script, not the running API's security implementation.

Require trustworthy build-to-runtime provenance or an owner-approved API
attestation mechanism identifying the candidate. A health response, matching
global totals, client version, or configured environment string alone does not
prove which API executable is serving traffic.

If this linkage is unavailable, mark source verification blocked. Do not claim
the sign-in/upload protections are live or add production diagnostics without
approval.

## 6. Signed-in and upload smoke tests

Production writes require separate approval and designated test accounts/media.
Never deactivate real staff, forge production bearers, or upload adversarial
files to public storage merely to demonstrate protection.

On an isolated staging environment using the retained candidate:

- Confirm an ordinary fresh login can access its authorized resources.
- Confirm a controlled old expiry-free session is rejected and signing in again
  restores access. Test expiry boundaries through fixtures rather than waiting
  eight hours or changing a production clock.
- Confirm customer A cannot attach customer B's media.
- Try approved valid media and controlled invalid MIME/signature cases.
  Confirm invalid attachments are rejected, not silently accepted.
- Check original and derivative response headers and download behavior.
- Confirm deactivated/deleted test team identities lose customer-count access.
- Remove authorized test fixtures and verify no production customers changed.

For a browser check, verify rejection messages are visible and recovery is
usable, not just that the network request failed. Record native/device checks
separately; local API tests do not certify physical-phone usability.

## 7. Ongoing observability

For each implementation, monitor a small set of signals:

| Signal | Interpretation and action |
| --- | --- |
| Per-host health status and latency | Investigate sustained errors/timeouts; compare hosts before blaming application code |
| Snapshot contract, age and agreement | Block client advancement on failure; inspect cache/calculation logs |
| Auth rejection rates | Expect a temporary rise after legacy-session expiry; investigate sustained fresh-login failures |
| Upload/attachment rejection rates | Distinguish invalid media from valid-file failures; inspect sanitized reason codes |
| Request 5xx, background-job failures | Correlate to publishing/startup time and operation; do not silently replay payments or notifications |
| Runtime memory/CPU and startup failures | Compare to pre-release baseline and inspect worker/module errors |

These are monitoring recommendations, not a claim that new metrics, alerts,
health dependencies or dashboards have been installed. Establish baselines and
owner-approved thresholds before activating alerts.

Prefer structured logs with UTC timestamp, service, operation, request ID,
status, duration and a sanitized error category. Never log Authorization
headers, cookies, reset tokens, signed upload URLs, passwords, connection
strings, email/phone/address or full request bodies. Public errors must not
reveal internal paths, stack traces or database details.

## 8. Release decision and recovery

Mark each gate **passed**, **failed**, or **unverified**, with evidence:

- [ ] Exact source selection and separate API publication approval.
- [ ] Retained candidate tests and compilation.
- [ ] Successful candidate publishing and actual image-size evidence.
- [ ] Currently served API linked to candidate.
- [ ] Fresh, compatible, agreeing public snapshots after publication.
- [ ] Approved signed-in/upload smoke checks, or explicit untested scope.
- [ ] No unexpected error/resource regression in the observation window.
- [ ] Separate approval before any client advancement.
- [ ] Separate approval before production initialization/schema changes.

If a gate fails, stop advancement. Preserve the evidence and retained
predecessor; obtain owner approval for any rollback or operational changes.
Do not turn an unavailable check into an assumed pass.

### Reusable implementation record

```text
Implementation:
Approved scope and candidate hash:
Owner publication approval:
Build / deployment identifier and UTC time:
Local fixture commands and results:
Database isolation and cleanup:
Actual image size / reported limit:
Served API source evidence:
Host checks, UTC time, freshness and agreement:
Authorized browser / device checks:
Error / resource baseline and observation window:
Untested or blocked items:
Client / production-init approvals (separate):
Decision: passed / failed / unverified
Recovery owner and approved next action:
```

## 9. Full observability: testing locations and ordered procedure

This section implements the testing requirement in the approved
`docs/superpowers/specs/2026-10-08-full-observability-rollout-design.md`.
It is a procedure, **not a record of tests run** or permission to publish.

### 9.1 Choose the correct test location

| Location | How to access it | Allowed checks and limits |
| --- | --- | --- |
| Repository-root shell | Replit Shell at the project root | Integrity guards, metadata verification and source inspection. These do not prove the frozen application or live API. |
| Frozen candidate stage | `.consistency-build/<exact candidate SHA-256>/` | Dependency, application, typecheck and compilation checks against the exact archived source. No output copy or release selection. |
| Disposable API test DB | Existing `artifacts/api-server` test wrapper inside that stage | Schema, permission, diagnostics, storage failures and alert-provider fixtures. Confirm creation and cleanup; never connect it to production. |
| Development ProjectHub | ProjectHub preview → sign in as an authorized test staff user → Monitoring (`/monitoring`) | Synthetic events, display, permission and no-send checks. Start/fix the existing managed web/API workflows first if they have failed. |
| Development Companion browser | Companion preview; use the Expo web origin if the shared preview is slow | Browser JavaScript event ingestion and loaded build/environment identity. Not native OS coverage. |
| Expo Go on a physical phone | Open the development Expo QR code on iOS/Android | Native JavaScript hook, launch and usability checks. Not native SDK crash coverage. |
| Signed native test distribution | Separately approved iOS test distribution / Android internal distribution | Native crash/hang SDK and symbol tests after that phase is implemented and approved. Never claim this from an Expo web export. |
| Public production API | `https://api.ucfilters.com` and the current verified deployment URL | GET-only health, readiness and snapshot checks. The last deployment metadata lookup confirmed `https://team-horizon--jerryaroyce.replit.app`; verify the target again before testing. |
| Approved external uptime service | Its separate dashboard after provider selection | Outage/recovery tests in an isolated target first. Production outage drills need separate approval. |

Do not use `localhost` as a customer/browser testing URL. Use the artifact
preview or its managed Expo origin. A failed development workflow is not proof
of a production outage.

### 9.2 Before starting

1. Record UTC time, operator, intended source commit, archive SHA-256 and test
   environment. Use designated test identities; obtain credentials through
   the existing secure process, never in the guide or raw logs.
2. Read the current candidate metadata and approval record. The earlier review
   `57b70b22…` is a historical preparation package, not the post-merge final
   release. The approved builder in Section 3 still pins the auth/upload
   predecessor `88f896ab…`; it does **not** build the consolidated review.
3. Start/fix the existing development API, ProjectHub and Companion workflows
   before browser checks. Do not create duplicate servers. Confirm the test
   environment and database are development/isolated, not production.
4. Confirm the test wrapper can create/drop its own database through approved
   development infrastructure. Never print a connection string or run
   `drizzle push`, seeding, direct mutating SQL, or test fixtures against
   production.
5. Stop on unapproved source, schema, runtime-dependency or environment changes.
   An unavailable check is **unverified**, never passed.

### 9.3 Check archive guards in the root shell

```sh
node --test --test-concurrency=1 \
  infra/cloudflare/forest/release-integrity-negative.test.mjs \
  infra/cloudflare/forest/auth-upload-security.test.mjs \
  infra/cloudflare/forest/consistency-handoff.test.mjs \
  scripts/tests/deployment-image.test.mjs
```

Expected: exit 0, no failed tests, disposable archive fixtures cleaned up, and
retained approval/source files unchanged. These guard tests cannot replace
exact-candidate application tests. Include subsequently merged guard cases
when preparing the final release.

### 9.4 Select the prepared stage — do not activate it

After an exact consolidated candidate has been prepared and its metadata
reviewed, run from the root:

```sh
export CANDIDATE_SHA="$(node -p "require('./infra/cloudflare/forest/consolidated-review/candidate.json').candidateSha256")"
export STAGE="$(pwd)/.consistency-build/$CANDIDATE_SHA"
test -d "$STAGE/artifacts/api-server" || exit 1
```

Check that this hash is the intended candidate, not merely whichever record
currently exists. Stop if the stage is missing or incomplete; do not substitute
the working tree. Installation/preparation must use the reviewed frozen lock,
the existing dependency-age rules and the approved package-management process.
These commands do not confer source-selection or publication approval.

### 9.5 Run frozen-source automated checks

Run the following in order. Keep exit codes and summaries, not raw private
payloads. Stop and investigate a failure.

```sh
(
  cd "$STAGE" &&
  pnpm run typecheck:libs &&
  pnpm --filter @workspace/api-server run typecheck &&
  pnpm --filter @workspace/projecthub run typecheck &&
  pnpm --filter @workspace/uc-companion run typecheck &&
  node --test scripts/tests/dependency-security.test.mjs
)

(
  cd "$STAGE/artifacts/api-server" &&
  TEST_GLOB='src/tests/runtime-*.test.ts' pnpm test
)

(
  cd "$STAGE/artifacts/projecthub" &&
  PORT=20100 BASE_PATH=/ pnpm exec vitest run src/runtime-monitoring.test.tsx
)

(
  cd "$STAGE/artifacts/uc-companion" &&
  pnpm test &&
  pnpm exec expo install --check
)
```

Locations and expected outcomes:

- API runtime tests: `artifacts/api-server/src/tests/runtime-*.test.ts`.
  Require bounded/privacy-safe diagnostics, schema parity, environment
  validation, permissions, retention, unknown states and no-send/at-most-once
  provider behavior. The wrapper must report test database creation and drop.
- ProjectHub: `artifacts/projecthub/src/runtime-monitoring.test.tsx`.
  Require authorized rendering, stale/unavailable state and no-send feedback.
- Companion: its declared `pnpm test` script installs `test-setup.mjs` and uses
  `tsconfig.test.json`. Do not omit that setup in ad hoc Node commands.
  A pre-existing failure is still a failed gate; do not silently skip it.
- Dependency tests exercise retained backports, not a clean vulnerability
  audit. Repeat dependency/SAST/privacy scans for the exact final graph and
  adjudicate every high/critical finding before release.
- Include the sign-in/upload/impact and other changed-feature fixtures from
  Sections 3 and 6 against this exact stage. Test selection must match the
  final source scope, not only runtime monitoring.

For the currently reviewed dependency overlays, the root command
`node --test infra/cloudflare/forest/consolidated-dependency-runtime.test.mjs`
checks installed Sharp/librsvg, shell quoting and deep-copy bounds in the
metadata-selected stage. Revisit those expected versions if the final approved
dependency graph changes.

### 9.6 Compile only in the isolated stage

```sh
(
  cd "$STAGE" &&
  pnpm --filter @workspace/api-server run build &&
  PORT=20100 BASE_PATH=/ pnpm --filter @workspace/projecthub run build &&
  SOURCE_REVISION="review-$CANDIDATE_SHA" \
    EXPO_PUBLIC_DOMAIN=app.ucfilters.com \
    EXPO_PUBLIC_API_DOMAIN=api.ucfilters.com \
    BASE_PATH=/uc-companion/ METRO_PORT=0 NODE_ENV=production \
    pnpm --filter @workspace/uc-companion run build
)
```

Expected: successful API/Hub compilation and Companion web/iOS/Android
**JavaScript** export. No main output copy, client pointer change, native
binary, OTA or publication. Inspect emitted identity and origins; setting an
environment variable alone is not proof of the resulting metadata. In nested
staging folders, a Git lookup can identify the parent repository instead of the
frozen source: any identity mismatch blocks release.

Verify actual external/native runtime versions separately after approved main
dependency alignment. A fixed Sharp binary inside the stage does not replace
main's older externalized Sharp package.

### 9.7 Conduct the development browser test

1. Open ProjectHub in its preview, sign in with designated Monitoring access,
   and open **Monitoring**. Record loaded release/environment and collector
   freshness. Start from alerts **off**.
2. In browser developer tools, keep Network open and filter for `diagnostics`.
   On development/isolated staging only, dispatch a standard synthetic error:

   ```js
   window.dispatchEvent(new ErrorEvent('error', {
     message: 'Synthetic observability verification',
     error: new Error('Synthetic observability verification')
   }));
   ```

3. Expected: a bounded diagnostic request, HTTP 202, no identity/URL/query/body
   or arbitrary message/raw stack in the transmitted envelope, and the correct
   environment/build group visible in Monitoring. Inspect only the sanitized
   payload. Wait at least a minute before repeating the same event because of
   deliberate client deduplication. A development error overlay may appear.
4. Repeat on the Companion **browser** preview with its correct environment.
   No request, rejection, missing persisted group or wrong release is failed or
   unverified coverage—not a successful crash test. Investigate rather than
   manufacturing an approved release identity.
5. On development only, locate the Monitoring snapshot request in Network and
   use browser request blocking to simulate its failure. Refresh Monitoring.
   Expected: unavailable/unknown state, not healthy zeroes. This checks browser
   behavior; database failure semantics are tested through the isolated API
   fixtures, not by disabling a live database.
6. Choose **Test without sending**. Expected: dry-run/no-delivery feedback and
   no provider call or incident-state mutation. Do not switch to live delivery.
7. Verify a test user without Monitoring access is denied. Test account role
   mutations only in isolated fixtures; never deactivate real staff.
8. Capture sanitized results and remove any authorized test fixtures. These
   checks do not prove production, recipient delivery or native OS coverage.

### 9.8 Conduct GET-only production checks after API publication

Before doing this, verify deployment target, explicit publication/schema
approval and build-to-runtime provenance. Reuse Section 5 for health and the
validated snapshot comparison. For readiness:

```sh
for origin in https://api.ucfilters.com https://team-horizon--jerryaroyce.replit.app; do
  curl --silent --show-error --max-time 15 --include \
    -H 'Cache-Control: no-cache' "$origin/api/readyz"
  printf '\n'
done
```

Check status, JSON content type and the current documented readiness contract;
a 200 HTML fallback is not a pass. A missing readiness endpoint on an older
release is unverified, not proof that the new implementation is live.

Then run the Section 5 `verifyLiveApi()` comparison. Both hosts must agree and
be fresh at the time of the check. Retain UTC time and sanitized source/build
evidence. Repeat immediately before any client advancement. Do not send
synthetic diagnostics, mutate accounts, exercise uploads, force failures,
activate alerts or modify production data under this read-only procedure.

### 9.9 Independent uptime and native-device tests

These tests begin only after their separate sub-designs are implemented and
approved:

1. **Uptime:** use an isolated health target; confirm normal readiness, an
   agreed unavailable response, threshold crossing, staff alert and recovery.
   Prove the external alert can operate while the target API/database cannot.
   Repeat a production outage drill only with explicit approval.
2. **Native:** install the approved signed test build on physical iOS and
   Android devices. Record platform/version/build, induce only the approved
   synthetic native crash/hang class, relaunch, verify ingestion and symbol
   mapping, and check sensitive test strings are scrubbed.
3. Test each claimed class independently. Expo Go JavaScript events cannot
   establish Objective-C/Java crashes, ANRs or memory-kill coverage.
4. Record unsupported classes explicitly and verify rollback/collection-off
   controls before store distribution.

### 9.10 Record the result and stop conditions

Use the Section 8 implementation record and add:

```text
Test location: root / exact stage / disposable DB / preview / physical device / production GET
Source commit, archive SHA and loaded build:
Commands or manual steps:
UTC start/end:
Expected result:
Observed result and sanitized evidence:
Database/test-fixture cleanup:
Privacy and permission checks:
Result: passed / failed / unverified
Unsupported or untested coverage:
```

Stop on unapproved source/schema/dependency changes, a failed test, missing
cleanup, PII in telemetry, false healthy states, source mismatch, stale/disagreeing
hosts, duplicate/ambiguous delivery replay, or missing rollback. Never turn a
merged task, build success or unreachable check into evidence of a live fix.

## 10. Independent public-impact snapshot monitor

The owner approved the independent GitHub Actions/issue design and thresholds
on 2026-10-10. This is a separate **opt-in source implementation**, not a
published app, active schedule, delivered alert or API-source attestation.
Design: `docs/superpowers/specs/2026-10-10-public-impact-monitor-design.md`.
Workflow: `.github/workflows/public-impact-monitor.yml`.

### Contract, timing and interpretation

- Probe the two fixed `API_ORIGINS` from `consistency-handoff.mjs`, with
  unauthenticated GETs to `/api/healthz` and `/api/uc/impact`. No database, cookies,
  application credentials, write endpoints or release tools are used.
- Reuse `validateSnapshot()` and `verifyLiveApi()` comparison fields.
  The age limit remains sixty seconds with sixty seconds of future-clock
  tolerance. Calculation times may differ; comparison fields must agree.
- Five-minute schedule; fifteen-second timeouts covering headers and bodies;
  bounded JSON and no redirects. GitHub schedules can be delayed or skipped.
  Three consecutive matching failures create a warning. Two healthy observations
  resolve active incidents. There is no notification for the initial healthy
  baseline or a recurring reminder for an already warned category.
- Keep per-host health/impact incidents separate. Changing categories starts a
  new streak and retains unresolved incidents until health is established.
  Agreement is **unverified** when either snapshot cannot validate; that cannot
  resolve a mismatch. Gaps over fifteen minutes reset pending streaks, not active
  incidents. Checks less than four minutes apart and older/duplicate observations
  do not advance state; this also prevents rapid manual runs crossing thresholds.
- `probe_unavailable` means the monitor could not obtain evidence, **not confirmed
  downtime**. HTTP errors are observed HTTP failures, not proof of their cause.
  `stale`, `future_clock`, `incompatible`, `invalid_response` and `disagree` are
  separate categories. The health endpoint establishes liveness, not DB readiness.
  Matching totals never attest API source identity or authorize client advancement.

### No-send verification

From the repository root, without installing dependencies:

```sh
node --test infra/cloudflare/forest/public-impact-monitor.test.mjs
node infra/cloudflare/forest/run-public-impact-monitor.mjs --dry-run
```

The dry-run makes only four public GET probes. It never reads or changes GitHub
state and never sends a warning, even when a token or live configuration exists.
Its fresh baseline does not accumulate consecutive checks across invocations.
Failure/recovery thresholds and uncertain-delivery behavior are tested with
injected fixtures, not a production outage drill.

The JSON report is `generated-artifacts/public-impact-monitor/evidence.json`.
It contains UTC timestamps, sanitized reason codes, HTTP status, duration and
allowlisted validated public totals. Invalid bodies and provider exception text
are discarded. No attribution, headers, cookies, tokens, customer identifiers
or raw logs are saved. GitHub CI retains the report for fourteen days; local
output is excluded from Git and publication inputs.

### Owner activation — separate from application publication

1. Review the approved workflow in the intended repository's default branch.
   It must have Actions enabled and permit the workflow's built-in token to
   update issues. Do not add application secrets or weaken protected branches.
2. Generate the initial dedicated issue body:

   ```sh
   node infra/cloudflare/forest/run-public-impact-monitor.mjs --issue-template
   ```

   The owner creates an **open issue**, not a pull request, titled exactly
   `Public impact monitor — state and warnings`, with that generated body.
   This initializes monitor state in GitHub only; it never initializes any
   production application row. Do not reuse an unrelated issue.
3. Subscribe the intended staff recipients to that issue. In repository
   Settings → Secrets and variables → Actions → Variables, set the non-secret
   `PUBLIC_IMPACT_MONITOR_ISSUE` to its number. Leave
   `PUBLIC_IMPACT_MONITOR_ENABLED` absent or `false`.
4. In Actions → Public impact snapshot monitor → Run workflow, keep `dry_run`
   checked. Review the sanitized evidence artifact. Initial compatibility,
   freshness and agreement must be established; correct runner-clock problems
   before interpreting age failures.
5. Only after the owner approves activation, set the repository variable
   `PUBLIC_IMPACT_MONITOR_ENABLED` to exactly `true`. Neither approval of this
   design nor merging it enables that variable. The first scheduled run establishes
   state; inspect the issue timestamp and workflow artifact to verify execution.
   Manual live runs require both that opt-in and explicitly unchecked `dry_run`.
6. Record actual UTC scheduler evidence and permission failures separately.
   A green local suite does not verify GitHub execution or recipient delivery.
   No real warning/recovery drill or deliberate production failure is authorized
   by these instructions. Use an independently approved isolated target to
   verify actual notification receipt; do not redirect the production checker.

### Delivery, recovery and disabling

The dedicated issue body holds bounded, strictly validated state. Serialized
workflow runs save the transition and **claim** before sending one combined
warning/recovery comment. Comments, not body edits, provide the notification
event. After sending, state records `accepted` or `uncertain`. Acceptance means
GitHub accepted the comment, not that anyone read or received it.

Live CLI execution is restricted to the named GitHub workflow, which serializes
scheduled and manual runs in one concurrency group. Do not duplicate this
workflow, assign the same issue to another monitor or edit its machine state;
GitHub issues do not provide a database-style atomic compare-and-swap.

No provider-write retry is automatic. An ambiguous save prevents sending; a
crash after claiming may lose a notification rather than duplicate it. A later
run reads the stored transition and never blindly replays its comment. Inspect
`claimed`, `uncertain` and `delivery_state_unavailable` outcomes manually.
Preserve existing incident state; do not clear it to force another notification.
If GitHub or state is unavailable/corrupt, the run fails closed without creating
a replacement baseline or claiming that a warning was sent.

To disable, set `PUBLIC_IMPACT_MONITOR_ENABLED` to `false`, and stop any already
running monitor job if immediate cessation is required. Keep the issue and its
state for investigation. Manual no-send checks remain available. Disabling does
not modify the API, clients, retained release assets, adjustment row or audit.

This monitor does not detect its own scheduler's indefinite failure while it is
not running. Check the last UTC evidence and GitHub Actions status; independent
dead-man monitoring requires separate approval. GitHub/API outages may prevent
incident persistence or notifications. GitHub issue notification subscriptions
and scheduler operation remain unverified until separately observed.
