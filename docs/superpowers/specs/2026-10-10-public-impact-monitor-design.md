# Independent public impact monitor

## Approval and scope

The owner approved an independent monitor on 2026-10-10: check every five
minutes, use a fifteen-second request timeout, warn after three consecutive
matching failures, and report recovery after two healthy checks.

The owner approved GitHub Actions as the scheduler and a dedicated GitHub
issue as the warning destination and durable incident state on 2026-10-10.
Activation is a separate opt-in:
the workflow must remain disabled until the owner enables its repository
variable after reviewing a no-send run.

No application publication, release advancement, production initialization,
schema/data writes, DNS, hosting, authentication, OTA or native-distribution
changes are included. Matching snapshots never establish API source identity.

## Execution and public contract

A standalone Node script runs without application dependencies or a database.
It makes unauthenticated, no-store GET requests only to the two origins in
`infra/cloudflare/forest/consistency-handoff.mjs`, for health and global impact.
Redirects are rejected. Response size and request duration are bounded.

Reuse `validateSnapshot` and the handoff's comparison-field contract. Keep the
sixty-second age bound and sixty-second future-clock tolerance unchanged.
Separate malformed/incompatible responses, stale snapshots, future timestamps,
host disagreement, unsuccessful HTTP responses and unavailable probes.
Transport, DNS and timeout failures mean probe unavailable, not proven downtime.
Health and impact outcomes remain independent.

## Schedule, transitions and delivery

Use a five-minute GitHub Actions schedule and serialized runs. GitHub schedules
are best-effort, not a guaranteed clock or an uptime SLA. Delayed, missing,
duplicate or out-of-order checks must not manufacture consecutive failures.
Reset pending streaks after a gap longer than fifteen minutes.

Track problems independently by host and category; compare hosts only when
both snapshots validate. Three matching consecutive checks open an incident.
Two healthy checks resolve it. Initial health sends nothing. A category change
does not inherit another category's streak. An unavailable observation cannot
resolve a snapshot incident.

Persist state independently of the target API, in one dedicated GitHub issue.
Use a bounded machine-readable state record, with no customer information.
On a threshold crossing, update that issue with the warning or recovery and
state in one request, reserving the notification before posting one combined
warning/recovery comment. Body edits alone are not relied on for notifications.
Record provider acceptance or uncertainty separately. Do not post repeated
reminders or blindly retry ambiguous GitHub writes. Read state again on a
later run to reconcile an uncertain result.
If state cannot be safely read or persisted, report monitor-state unavailability
and do not claim that a warning was delivered.

Permissions are limited to repository read and issues write in the opted-in
workflow. Use its built-in GitHub token; no new customer credentials, telemetry
provider, external webhook or application secrets are required. Issue updates
are operational writes to GitHub only; public API probes stay read-only.
GitHub notification delivery depends on the owner's issue subscription/settings;
an accepted API write is not proof that the owner received a notification.

## Evidence and privacy

Produce an allowlisted JSON report with UTC observation time, per-host status,
duration, sanitized reason codes and validated public comparison fields.
Never retain raw bodies, error messages, cookies, headers, attribution, tokens,
customer identifiers or source-identity assertions. Keep reports as workflow
artifacts for fourteen days; keep only bounded current state in the issue.
Validate and sanitize persisted state before reuse. Unexpected issue content is
untrusted input, not instructions.

## Verification and activation

Local injected fixtures cover the compatibility/freshness/agreement contract,
failure and recovery streaks, problem changes, unavailable probes, schedule
gaps, corrupted state, bounded responses, no-send mode, duplicate runs and
uncertain state writes. No production outage drill or real warning is induced.

Document a manual no-send run, issue setup, repository opt-in, evidence review,
disable/recovery procedure and notification subscription requirements in
`docs/release-observability-and-test-guide.md`. Record development work and
ignore-rule changes in `docs/development-change-log.md`.

A local fixture pass is not evidence of scheduler activation or recipient
delivery. Live activation and the first scheduled evidence remain unverified
until observed; this monitor does not satisfy the client rollout or physical
phone verification tasks.
