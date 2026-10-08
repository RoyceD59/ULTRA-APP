# Full Observability — Implementation and Release Plan

## Approval and execution boundary

The user approved the staged design and written specification, requesting test
locations and procedures. This plan implements that request. It is not approval
to select an exact future archive, apply production DDL, connect a provider,
send a live alert, publish clients or submit native builds.

Specification:
`docs/superpowers/specs/2026-10-08-full-observability-rollout-design.md`.

Test instructions:
`docs/release-observability-and-test-guide.md`, especially Section 9.

Use a **passed / failed / unverified** evidence register per milestone. Do not
assign calendar completion promises before release dependencies and external
provider/native-device access are resolved.

## Current starting point

- First-party JavaScript/API diagnostics and staff Monitoring exist in source.
- The retained consolidated review predates subsequently merged integrity
  guards. Rebuild/freeze current main; do not relabel the old archive.
- The merged security handoff still records live API source as unverified.
  Its earlier agreeing snapshot check is historical, not a current freshness
  pass. Its merge is not a publication.
- Production metadata currently identifies a successful public Autoscale
  deployment; that alone does not identify its served source.
- The previously inspected schema diff and security findings must be refreshed
  against the exact final source and runtime graph.

## Milestone 1 — Release inventory and integrity

**Work**

1. Record current main commit and clean/dirty state. Inspect all merged guard
   changes, including unsafe-link preflight and extended-header regressions.
2. Run root integrity checks from test guide 9.3. Review any open guard cases
   affecting the archive type; do not accept a malicious-path case as fixed
   merely because an unrelated case passes.
3. Confirm original approval hashes, retained predecessor assets and artifact
   production settings. Preserve current client selection.
4. Obtain current deployment metadata and full production schema diff read-only.
   Classify every statement as in-scope additive, destructive, or unrelated.
5. Freeze a new source commit and reproducible archive/scope record. Keep the
   earlier review and rollback references instead of overwriting their identity.

**Evidence:** source/scope hashes, guard results, settings comparison, full
read-only schema diff, retained actual rollback asset inventory.

**Exit:** exact reproducible scope, no unresolved integrity defect, and no
unapproved destructive/unrelated schema change.

## Milestone 2 — Dependency, identity and security alignment

**Work**

1. Inspect archive dependencies and the real deployment runtime graph, including
   externalized native modules. Carry forward only approved compatible changes.
2. Resolve all high/critical advisories and review moderate/SAST findings.
   Preserve backport regression tests; do not suppress a version advisory merely
   to obtain a green report.
3. Check embedded build identity at compilation and in emitted artifacts.
   Prevent nested-stage Git lookup or an environment string from falsely
   identifying the executable.
4. Ensure artifact routing, hosting, analytics, provider availability and
   native-distribution controls are unchanged unless separately approved.
5. Record the exact runtime dependency and build-identity delta for owner review.

**Evidence:** verified dependency versions/licenses and installed native
libraries, scan reports, sanitized mitigation decisions, emitted identity.

**Exit:** no unresolved high/critical security issue; actual runtime matches
the approved graph; identity accurately represents frozen code.

## Milestone 3 — Frozen application verification

**Work**

1. Prepare the checksum-specific stage with the reviewed lock and existing
   dependency policies, without copying main deployment outputs.
2. Use test guide 9.4–9.6 for all consumer/library typechecks, runtime API tests
   through the disposable database wrapper, Monitoring UI tests, Companion
   suite/alignment and isolated builds.
3. Run changed-feature regression sets: sign-in expiry/admin provenance,
   upload ownership/signatures, consistency/impact, receipts, catalog/variants,
   AI access/feedback and guest payment as present in the final package.
4. Use guide 9.7 for development browser checks. Preserve permission/privacy
   limits, synthetic-only content and alerts off/dry-run.
5. Inspect failing cases and rerun only affected checks after fixes. Keep valid
   evidence until the measured input changes.

**Evidence:** exact-stage commands/results, disposable DB cleanup, compilation
metadata, sanitized browser checks and explicit physical/native exclusions.

**Exit:** checks pass against the actual frozen source, not only working tree.

## Milestone 4 — Explicit API release gate

**Work**

1. Present exact candidate, runtime manifests/lock, complete schema diff,
   checks, source attestation approach and rollback to the owner.
2. Obtain separate source-selection, production-schema and API-publication
   approvals. Keep client and native approvals separate.
3. Apply only approved runtime alignment/schema changes through controlled
   processes. Preserve aggregate revision and historical audit evidence.
4. Verify deployment build settings choose that exact candidate and retain
   runtime worker/static paths through post-build cleanup.
5. Measure actual publishing image/layer acceptance, not just local folder
   size. Offer the Replit Publish action only when release gates pass.

**Exit:** explicit owner release decision and an API-only publish path; client
pointers still unchanged. Any failure remains no-go.

## Milestone 5 — Live API proof and operational monitoring

**Work**

1. Establish a trustworthy build-to-served-executable link; standby metadata,
   `/version.json` fallback HTML and matching totals are insufficient.
2. Use guide 9.8 for GET-only readiness and fresh two-host agreement. Preserve
   production state and audit; do not reinitialize.
3. Under separately authorized non-customer verification, validate safe
   diagnostic persistence, exact environment/build, current staff permissions,
   stale/unknown behavior and correlation with sanitized logs.
4. Validate no-send controls. Obtain recipient/activation approval before
   enabling live operational transitions; distinguish acceptance from delivery.
5. Keep an owner-agreed observation window and inspect errors, dropped batches,
   startup failures and resource trends. Do not invent an observation threshold.

**Exit:** exact API source and live behavior proven; operational ownership and
delivery uncertainty documented. Client advancement remains separately gated
on this result and a fresh two-host recheck.

## Milestone 6 — Independent uptime sub-design and delivery

**Work**

1. Obtain provider, regions/cadence, endpoint/contract, threshold, recipient,
   escalation, data-region and cost decisions.
2. Review privacy/security and approved integration support before connection.
3. Implement secret-free independent liveness/readiness checks and alerting
   that does not depend on the monitored API database.
4. Use guide 9.9 in an isolated target for outage/recovery, duplicate suppression
   and alert-route verification. Obtain a separate production drill approval.

**Exit:** agreed failures/recoveries reach approved operators when the internal
alert path itself is unavailable.

## Milestone 7 — Native crash/hang sub-design and delivery

**Work**

1. Approve SDK/platform scope, privacy/consent, data processing/retention,
   signed build channel, symbol handling and expected store update.
2. Add only vetted dependencies and safe platform adapters. Retain existing
   JavaScript collection without double-reporting.
3. Build signed artifacts and test scrubbers and symbol mapping.
4. Follow guide 9.9 on physical iOS/Android devices for each claimed failure
   class. Treat absent platform signals and resource kills honestly.
5. Obtain separate distribution approval and preserve collection-off/rollback.

**Exit:** supported native classes have physical signed-build evidence; all
limitations are explicit. No claim of universal OS crash coverage.

## Milestone 8 — Finished-product acceptance

1. Complete the specification acceptance matrix and test guide 9.10 records.
2. Assign owners for escalation, retention, diagnostic privacy, symbol access,
   source verification, periodic synthetic tests and rollback.
3. Test a complete safe investigation: alert/event → correct release →
   correlation → authorized logs → reproducible isolated failure → verified
   fix. Do not equate a diagnostic disappearance with recovery.
4. Review unsupported/untested coverage and approve the final operational scope.

**Exit:** all claimed layers have evidence and an operating runbook; unresolved
gaps remain visible rather than being marked complete.

## Release stop rules

Stop for a failed or unavailable gate, source/identity mismatch, stale or
disagreeing public hosts, unapproved/destructive/unrelated schema change,
unresolved high/critical security finding, sensitive telemetry, false healthy
zeroes, unsafe archive extraction, missing cleanup/rollback, or unsafe alert
replay. Preserve evidence; seek approval for recovery instead of bypassing the
gate or silently changing production.
