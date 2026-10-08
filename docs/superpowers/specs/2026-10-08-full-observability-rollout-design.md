# Full Observability Rollout — Design

**Status:** Approved for detailed implementation planning, with the requested
testing locations and step-by-step procedures added below.
**Production status:** No schema changes, release selection, provider activation,
or publication is authorized by this document.

## Goal

Deliver a privacy-preserving operational observability system in stages:

1. Release and verify the already-implemented first-party JavaScript/API
   diagnostics through an API-first rollout.
2. Add independent service-availability monitoring.
3. Add separately approved native crash and hang coverage.

“Finished” means the applicable acceptance criteria in all three stages have
passed. A working dashboard, a merged package, provider acceptance, or the
presence of diagnostic events alone is not proof of completion.

## Existing system and boundaries

The current application implementation includes browser JavaScript error events,
React render boundaries, selected API read failures, Companion native JavaScript
error hooks, bounded API route/method/status and latency aggregates, readiness
and health endpoints, durable samples, staff Monitoring permissions, and
off/dry-run-first operational alert settings.

The existing public surface distinguishes shallow `GET /api/healthz` liveness
from timeout-bounded database `GET /api/readyz` readiness. Neither is a full
business-journey test. The server probes only established fixed response
contracts. A stale or missing sample is unknown, not a healthy zero.

The existing implementation does **not** provide an independent uptime monitor,
Objective-C/Java/C++ crash capture, ANR or memory-kill proof, guarantee delivery
of a fatal JavaScript event before process termination, or physical-device
verification. Manual `fetch` calls outside the declared wrappers are not
automatically observed. Runtime diagnostics remain distinct from the separate
approved Companion Umami collection and business analytics.

Reference behavior is documented in `docs/runtime-observability-runbook.md`.
The runbook remains authoritative for current privacy, rate, retention,
permission, delivery and rollback constraints; implementation must reconcile
against the live source before changing it.

## Goals and non-goals

### Goals

- Establish exact source provenance for the released API and its diagnostic
  records.
- Observe browser/Companion JavaScript errors and bounded API aggregates without
  treating an event as customer identity, successful operation, or proof of a
  fix.
- Add an independent availability signal that does not rely on the API
  reporting its own outage.
- Add approved native crash/hang reporting where platform support allows it.
- Keep ownership checks, rate limits, privacy exclusions, bounded storage,
  retention, and explicit alert delivery outcomes enforceable.
- Provide staged acceptance tests, activation controls, operational runbooks,
  and reversible rollback steps.

### Non-goals

- Session replay, customer analytics, profiling, payment/provider health checks
  that make a real payment, customer-level identifiers, request or response
  bodies, credentials, raw URLs, arbitrary stacks, or entered content.
- Claiming complete native OS failure, ANR, memory-kill, or physical-device
  coverage where the selected platform mechanism cannot prove it.
- Replacing Companion Umami, ProjectHub analytics, deployment hosting, DNS,
  payment services, or the existing API-first client-release order.
- Automatically retrying ambiguous alert sends, storing an offline diagnostic
  queue, or routing alerts to customers.

## Architecture and data flow

### Current first-party diagnostics

1. An approved client hook observes only the documented error categories.
   Existing grouping, local limits, abort deadline and failed-send suppression
   remain in force.
2. The client sends a bounded diagnostic event to the first-party diagnostics
   endpoint. It must not attach cookies, identity, request payloads, query
   strings, user-entered content, arbitrary messages, raw stacks, or raw source
   locations.
3. The API validates app, environment, source, platform, route class, release
   metadata, frame allowlist, and payload size before storage.
4. The API uses its own correlation identifier and bounded route-family
   aggregates. It does not trust client-supplied correlation values as audit
   identity.
5. Shared PostgreSQL samples back the Monitoring view. Active team membership
   and current database-backed Monitoring permissions are checked on every
   protected read or edit.
6. Staff first inspect freshness, environment and exact loaded release identity,
   then use the correlation identifier in authorized deployment logs. A
   diagnostic group never proves identity, successful behavior, or physical
   coverage.

### Independent availability monitoring

An external monitor will query explicitly approved, non-secret health
endpoints. The checks must distinguish service liveness from database
readiness; they must not invoke real payment, email, WhatsApp or customer
workflows. Its alert path must remain independent of the app's API and database.
Provider, check interval, regions, thresholds, recipients, and escalation are
deliberate owner decisions in a later sub-design; no vendor or credential is
assumed here.

### Native crash and hang monitoring

Native support will use an owner-approved platform mechanism for release iOS and
Android builds. It must fit the existing consent/privacy position, release
signing and symbol-management workflow, and API event contract without sending
unredacted customer data. JavaScript-level Hermes or ErrorUtils evidence will
not be labelled native OS crash coverage. Native crashes, hangs/ANRs, and
resource terminations must each have explicit platform-specific capabilities
and limits. Vendor selection and any new data sharing require a later review.

## Data classification, privacy and retention

Operational events are untrusted diagnostics, not business or identity records.
Preserve the existing prohibitions: no names, email, phone, address, account
identity, IP address, credentials, cookies, tokens, body content, arbitrary
message text, raw URL/query/resource IDs, arbitrary stacks, or persistent
client/session identity in diagnostic envelopes or logs.

Error frames may carry only the currently allowlisted asset class and numeric
line/column. Route labels and platform/source values remain fixed enums or
bounded classes. Transport pseudonyms remain short-lived HMAC-derived values,
not stored IP addresses. Enforce payload, source, global, per-source,
in-flight, release-cardinality, timeout, and frame limits at both client and
server boundaries.

Retain the documented 14-day default for diagnostics and health/API samples.
Retention must run while the service is operating, handle bounded batches, and
report storage or pruning failures honestly. No missing or inaccessible data is
converted to a healthy zero. A future external crash provider must receive only
the minimum reviewed fields; data-subject deletion/export, cross-region
processing, consent/notice, and retention implications must be reviewed before
enabling collection.

## Alert behavior

Keep alerts opt-in and scoped to the API environment. Start off, run the
no-send dry-run, approve recipients, then explicitly activate live delivery.
Destinations remain limited to the configured staff channels described by the
runbook; no customer destination is introduced.

Preserve two-consecutive-check transitions, atomic deduplication claims, the
healthy initial baseline, and visible accepted/failed/claimed/uncertain results.
Provider acceptance is not recipient delivery. If a send result is ambiguous,
do not automatically retry; operators investigate the durable incident state
before taking manual action. An independent uptime alert is separately
configured and must not depend on this database-backed delivery path.

## Rollout stages and gates

Detailed execution order:
`docs/superpowers/plans/2026-10-08-full-observability-implementation-release-plan.md`.

Testing locations, commands, manual steps, expected results and evidence:
`docs/release-observability-and-test-guide.md`, Section 9. Its earlier
auth/upload-candidate commands remain specific to that retained predecessor;
they must not be mistaken for commands selecting a new consolidated package.

### Stage 0 — Re-establish the exact review candidate

- Inspect all merged release-integrity tests and unsafe-link guards before
  selecting a final package. The previously sealed consolidated package
  predates these merges and is not the final current-main package.
- Resolve or explicitly disposition any remaining release-extraction guard
  work that can affect the selected archive. Run the complete integrity test
  suite against both the candidate and any predecessor archive used for
  rollback.
- Freeze a new source commit; regenerate and independently verify the exact
  source/scope hashes, package contents, executable modes, dependency delta and
  immutable rollback references.
- Re-run dependency, SAST, privacy, typecheck, API/client regression and build
  checks against that exact candidate. A mitigated backport is not described as
  a clean scanner result. No unresolved high or critical advisory is acceptable
  under the release gate. Review any incompatible major upgrade instead of
  silently forcing it.
- Recalculate the complete production schema diff read-only, including
  observability tables. Stop on any destructive or unrelated change. Obtain
  explicit approval before applying any production DDL.

**Exit:** Candidate source and checks are reproducible; remaining security,
integrity and schema issues have a verified resolution and the exact candidate
is separately approved for selection. Main configuration and production remain
unchanged until the release approval gate.

### Stage 1 — Prepare API dependencies and API-only release

- Align separately approved root manifests, lockfile, installed runtime graph
  and externalized API dependencies with the frozen candidate. Inspect actual
  runtime versions, particularly native modules; compiling an isolated tree is
  not proof that production will load its versions.
- Confirm the required schema exists or apply only explicitly approved additive
  DDL through the controlled migration path. Preserve existing aggregate
  revision/audit state; never reinitialize it to make a check pass.
- Run API schema/typechecks, runtime-observability regression tests, route
  authorization and privacy tests, dependency/security checks, API compilation,
  readiness tests, and a known synthetic event in a non-customer environment.
- Review the final deployment build, rollback and exact-source metadata.

**Exit:** The approved API is compatible with the unchanged clients; runtime
dependencies and required schema are verified; privacy/security release gates
pass; rollback is available. No client artifact is selected.

### Stage 2 — API publication and live verification

- Publish through the approved Replit publishing action only after the required
  release and schema approvals. Do not publish directly from this design.
- Verify the actual loaded API source from deployment evidence, not a standby
  build record, current selector, or local package.
- Confirm readiness, collector freshness and one sanitized non-customer
  diagnostic in the authorized production verification procedure.
- Fetch fresh public API snapshots from both approved hosts and require exact
  agreement. Recheck immediately before any client advancement; snapshots
  expire and do not prove the loaded source by themselves.
- Confirm existing production state and audit history remain intact.

**Stop/rollback:** Any source mismatch, host disagreement, stale sample,
unapproved migration, privacy leak, dependency mismatch, loss of previous
production state, or failed readiness check blocks clients. Disable live alerts
first if rolling back alert behavior, then restore the previous approved source
and package. Retain telemetry schema on code rollback; only perform bounded,
authorized retention cleanup separately.

### Stage 3 — Activate current operational monitoring

- Verify staff-only access with current server-side permissions, `no-store`
  behavior, environment separation, stale/unknown display, correlation-ID
  privacy, bounded aggregation, retention, and behavior through database
  unavailability.
- Verify dry-run invokes no provider and changes no incident state. Obtain
  explicit recipient/owner approval before live alerts, then confirm provider
  acceptance, failure and ambiguous outcomes without claiming delivery.
- Exercise one known synthetic client error in a non-customer context and
  reconcile it with the correct API/Monitoring record and exact build identity.

**Exit:** Monitoring and incident response work in the live API release with
privacy boundaries and delivery uncertainty visible; no user/client update is
needed to operate the current first-party dashboards.

### Stage 4 — Independent uptime design and delivery

- Obtain owner choices on monitor provider, check locations/cadence, public
  health target, failure/recovery threshold, staff recipients, data region,
  notification policy and cost.
- Connect only approved integrations. Keep health endpoints secret-free and
  scoped; add no authenticated customer workflow to the check.
- Test API and database outage/recovery separately, including an outage where
  the API cannot alert through its own database.

**Exit:** An independent monitor detects agreed outages/recoveries, routes alerts
to approved staff, and cannot report false health from a stale internal sample.

### Stage 5 — Native crash/hang sub-design and rollout

- Obtain platform/provider approval, data-processing and retention review,
  consent/notice direction, symbol/source-map handling, release-build workflow,
  and store-update expectations before code changes.
- Integrate only approved native mechanisms; preserve the existing JavaScript
  diagnostic system and avoid duplicate submission.
- Build signed test/release artifacts, validate symbol mapping, prove the
  configured scrubber against sensitive test strings, and test representative
  supported failures on physical iOS and Android devices.
- Publish store/native releases only through a separately approved channel.
  Existing web/Expo Go JavaScript exports are not proof of native builds or OS
  crash coverage.

**Exit:** Document tested platform/error classes and explicit non-coverage.
Never claim all crashes, ANRs, memory kills, or devices are observed unless the
selected platform and test evidence establish that claim.

### Stage 6 — Operational acceptance

- Require named operational owners, alert acknowledgement/escalation,
  troubleshooting/rollback runbooks, retention/deletion ownership, release
  provenance checks, and evidence of a periodic synthetic test.
- Review false positive/negative behavior, dropped samples, dashboard freshness,
  outage alerts and provider failures.
- Close scope only against the acceptance matrix below; unresolved platform
  exclusions remain visible.

## Acceptance matrix

| Area | Required evidence |
| --- | --- |
| Source provenance | Exact live API build matches the approved candidate; a local archive or standby build alone is insufficient. |
| API availability | Both public hosts answer fresh, agreeing snapshots; readiness is database-aware and liveness remains shallow. |
| Event privacy | Synthetic payload contains no identity, IP, entered content, URL/query, cookies, credentials, request body or raw stack. |
| Persistence | Valid bounded samples survive restarts; missing/stale/storage-failed data is unknown, not zero. Time-based retention pruning is bounded and verified. |
| Access | Current database-backed permissions gate Monitoring reads, settings and incident actions; responses are not cacheable. |
| Correlation | An authorized support operator can connect a generated correlation ID to the correct sanitized server log entry. |
| Delivery | Off/dry-run guarantees no send/state mutation; live outcomes distinguish provider acceptance, failure and ambiguity. No automatic resend after an ambiguous claim. |
| Independent uptime | Outages and recovery are observed when the API/database delivery path itself is unavailable. |
| Native reporting | Supported signed platform builds, symbol mapping, privacy filtering and physical-device tests pass for each claimed class. |
| Rollback | Previous actual served assets and approved source are available; client advancement follows verified API compatibility and both-host snapshot agreement. |

## Decisions deliberately deferred

No external uptime or crash vendor is selected. No credentials, external
connections, new native SDK dependencies, payment/provider checks, or production
destinations are added by this design. These require separate owner approval.

The exact current production schema, live source provenance, approval status,
dependency findings, rollback assets and merged integrity-test results must be rechecked
before implementation planning; values in the previous review report are
historical evidence, not a fresh release attestation.
