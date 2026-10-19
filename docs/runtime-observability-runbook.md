# Runtime observability runbook

## Scope and evidence baseline

This is first-party **operational JavaScript diagnostics**, not business analytics,
session replay, functional testing, or OS crash reporting. Companion’s approved
Umami collection is unchanged. No telemetry vendor, hosting, DNS, payment
availability, programme formula, or client-update channel is introduced.

The source baseline was inspected against the working tree and recent merged
changes, not an invented customer incident/date range:

| Confirmed source evidence | Gap addressed |
| --- | --- |
| API pino request logs; `/api/healthz` returned `status: ok` without a dependency query | Correlation, bounded route-family aggregates, separate readiness |
| Monitoring accepted any status below 500; retained history only in a process map | Expected response contracts, durable shared samples, stale/unknown states |
| Problem-query exception returned zero counts | Null counts and unavailable snapshots |
| Provider credential presence appeared as live/healthy | Configuration and operation/delivery verification are distinct |
| Companion render boundary did not report centrally; ProjectHub had no root reporting boundary | Safe render/global JS error channels and selected read failures |
| Companion Umami field vitals are separate, browser-only business/performance collection | Preserved, not reused for operational errors |

The locally retained Companion package `1790705576693-2655` has build metadata
dated `2026-09-29T18:15:00.267Z`, source revision
`fc468cf75c71335a8075a80a0f9fca8aea5a3cb1`, and six declared tabs.
**Retained files do not prove active or published release selection.** No
production runtime symptom, published improvement, physical-device result, or
missing user date range is inferred from these files. Recent merges include the
Companion droplet loader, customer-name normalization and WhatsApp reconnect
verification; this work does not replace them.

The common evidence format is: UTC observation time, app, server-separated
environment, route class, JS source category, platform/browser family, **loaded**
release, occurrence count, optional numeric bundle location and server-issued
support correlation ID. Source metadata is untrusted operational evidence, not
proof of an authenticated customer crash.

## Collection and coverage

| Source | Supported coverage |
| --- | --- |
| Companion / ProjectHub React boundary | JS render errors inside that boundary |
| Both browser apps | `error` and `unhandledrejection` events exposed by the browser |
| Companion native | `ErrorUtils` errors, preserving the preceding global handler |
| Production native Hermes, when exposed | Promise rejection tracker; installed once, does not replace React Native's development tracker |
| Companion `useApi` GET | Network/JSON failures, existing read deadlines, HTTP 5xx; user cancellation and expected auth/validation excluded |
| Both generated clients, ProjectHub `apiFetch` | GET/HEAD network/JSON failures and HTTP 5xx; normal auth recovery is unchanged |
| API | Request volume, status classes, expected auth/validation/not-found/conflict/rate-limit responses, unexpected responses, mean/max and bounded latency histogram |

Other manual `fetch` calls are not automatically wrapped. Existing read deadlines
are observed, not imposed on customer writes. No operation is retried by
diagnostics. Native runtime APIs that are absent, the RN development Promise
tracker, module-load errors before hooks install, immediate process termination,
native Objective-C/Java/C++ crashes, ANRs, memory kills, and physical-device
behavior are **not** verified by these hooks. Fatal JS reporting is best effort
and may not finish before termination. A missing diagnostic is not proof of
successful operation.

There is no session identifier, persistent client identifier, customer identity,
IP field, entered content, request/response body, arbitrary message, function
name, filename, source line, URL or raw stack in the diagnostic envelope. Error
message lines are discarded; frames contain only an allowlisted asset class
and numeric line/column. Route classes discard queries and resource IDs.
Browser family is reduced to a fixed enum. API logs use safe route families and
server-generated UUID correlations, not incoming paths or correlation headers.

Companion's injected build identity reuses the static build ID that already
owns manifests, HTML selection and `build-info.json`; it never fetches "latest"
as the loaded identity. ProjectHub embeds its build-time source revision. Builds
without trustworthy metadata report `unknown`. Preparing a new frozen-release
delta, publishing it, OTA activation or store submission needs separate approval.
No frozen package or existing retained bundle has been changed by this task.

## Bounds, persistence and environment separation

`POST /api/diagnostics` is unauthenticated, deliberately contains no credentials,
and is not a trusted activity/audit event. It rejects unknown fields, malformed
JSON, unsafe release/route/frame/correlation data and mismatched environments.
Browser origins must be in the existing explicit CORS allowlist; a missing
Origin is supported for native apps and is not proof of app provenance.

* 3 KB maximum JSON; five frames; fixed categories, app/platform/browser/route enums.
* Server: 600 valid attempts per minute per environment, 30 per transient source,
  32 distinct claimed releases per app/day, enforced in PostgreSQL across instances.
* Additional local limits: four in-flight ingestion operations, 1,000 valid
  attempts/minute. The dedicated two-connection diagnostics pool has bounded
  connection and statement/query timeouts; customer connection capacity is separate.
* Transport sources are keyed by an hourly HMAC pseudonym, not a stored IP.
  Rate pseudonyms expire after two minutes. `SESSION_SECRET` supplies the HMAC
  salt; without one, an instance-random salt still preserves the shared global
  and release limits, but per-source limits cannot span instances.
* Client: first occurrence per category/context/frame group each minute,
  maximum ten sends/minute, one in-flight request, a two-second abort deadline.
  Failed delivery suppresses further attempts for a minute. No persistent queue,
  offline replay, retry, authenticated mutator or cookie-based delivery.
  Browser referrers are suppressed so a same-origin page's secret query or
  resource path is not carried to the collector in an automatic HTTP header.
* Diagnostic groups, health samples and API aggregate batches have a documented
  **14-day retention default**, pruned every minute while the API is running.
  Release-cardinality records also expire after 14 days. Diagnostic cardinality
  is additionally bounded by global attempts and five-frame payload limits;
  arbitrary route/resource labels are never metric dimensions.
* API request observations are aggregated in bounded route-family/method maps,
  flushed once per minute—not written to the DB per request. Shutdown attempts
  a final flush. Up to one interval can be lost on a hard crash; failed flushes
  are dropped and locally counted, not silently represented as zero traffic.
  On storage recovery, dropped-interval evidence is persisted and remains visible
  across restarts/multiple instances in the 15-minute summary window. An abrupt
  crash during a database outage can still lose unpersisted gap evidence.
* PostgreSQL history is shared across instances and survives restarts. Each
  API instance has its own aggregate batch identity. Health sampling uses a
  database minute claim to avoid duplicate external probes across instances.

Environment values are derived from server preview/production/development
configuration and must match the client's built configuration. Preview Hub
sets `VITE_PREVIEW_SAFE_MODE=1`; Companion already uses its preview marker.
Development does not probe the fixed live external targets. Listener-only
isolated previews run no background sampler or flush timer; their missing
aggregate/heartbeat samples remain explicitly unknown.
No development exception weakens production CORS.

## Health and freshness

`GET /api/healthz` remains shallow liveness for deployment startup.
`GET /api/readyz` reports only `ready` or `degraded` publicly: an essential,
timeout-bounded database/table query. It does not check provider credentials
or send payment/email/WhatsApp requests. Detail is shown only to authorized
Monitoring staff. This is database readiness, not proof that every business
journey works.

Production probes only the existing fixed targets:

* Store: HTTP 200 HTML with an expected Ultra Clear/ucfilters title.
* Existing app API target: HTTP 200 JSON with `status: ok`.

Redirects are not followed; 3xx/4xx responses are failures. Response bodies have
a 32 KB read budget and five-second abort deadline, and are never stored.
These are response-contract checks only, not proof of checkout, sign-in, native
app launch, customer-page rendering or published release consistency.

Monitoring reads persisted samples; dashboard refresh does not trigger live
external requests. Samples older than two minutes, missing samples, inaccessible
storage and failed problem queries are stale/unknown, never green zeroes.
API summaries cover a 15-minute window; up to 1,000 batches and 100 recent client
groups are returned. Truncation is explicitly marked. Current collector heartbeat
is not complete client coverage; observed collection gaps and dropped batches
are shown. No samples means unknown traffic, not zero requests.

## Staff access and investigation

All snapshots, filters, incident states and readiness detail require an active
team user with live Monitoring view/edit permission or a live admin role.
Role/permissions are queried on every request, including stale admin tokens.
Responses are `no-store`. Config changes and dry-run preview require edit access.

1. Check collector freshness and environment before interpreting counts.
2. Select Companion/ProjectHub, environment, and exact loaded build ID/revision.
3. Note source category, route class and platform/browser. Bundle numeric
   coordinates are useful only with matching release artifacts.
4. For an API read failure, copy the UUID correlation shown in Monitoring or
   `X-Correlation-ID` response header. Browser CORS exposes this header.
5. Locate the same request ID in structured API deployment logs using existing
   authorized support procedures. Do not ask a customer for tokens, cookies,
   entered content or unrestricted raw stacks.
6. Reproduce with functional tests separately. Do not infer a successful fix,
   production activation or physical-phone result from a diagnostic group.

## Operational alerts: explicit opt-in, dry-run first

Default mode is **off**. Monitoring editors may select `dry-run` or explicitly
save `live`, scoped to this API environment. Destinations are only the existing
Slack connector's team self-DM or existing `UC_ADMIN_EMAILS` recipients through
the existing Resend integration. No customer destination can be entered.

The separate **Test without sending** action always returns a dry-run message,
even if live is selected. It never changes incident state or invokes a provider.
Automated dispatch verification uses injected isolated providers, not live sends.

Two matching consecutive persisted checks create one failure/recovery transition.
The initial healthy baseline sends nothing. A database atomic transition claim
prevents duplicate sends on dashboard refreshes, restarts or parallel instances.
There are no repeating reminders or automatic resend attempts. Provider accepted,
failed and claimed outcomes are visible; accepted means provider acceptance, not
recipient delivery. A crash after claiming can lose a notification rather than
duplicate it. A hanging provider can leave a claimed outcome; investigate before
any manual action. Database/storage outages cannot safely persist or deduplicate
their own incident delivery: the Monitoring failure/unknown state remains the
evidence, and this does not replace an independent uptime monitor.

## Activation, schema and rollback

The shared Drizzle schema and SQL migration `0065_runtime_observability.sql`
describe fresh databases. The API's idempotent startup guard creates the same
tables for an existing database. Checks exercise repeated startup, isolated
test databases, independent pools/new processes, TTL, limits, privacy and live
permissions. No production migration/publication was performed here.

After separately approved rollout, verify API readiness, a known induced JS
error in a non-customer environment, exact loaded release identity and collector
freshness. Keep live alerts disabled until operational recipients approve
activation. Do not publish the entire working tree into a frozen production
package.

For rollback: first save alert mode `off`, then restore the previous approved
code/release selection using the existing release process. Do not drop telemetry
tables as part of an emergency code rollback. There is no client update policy
to undo and no offline queue to drain; normal retention removes old metadata
while the new API runs. If retention is stopped with the old code, perform an
authorized bounded purge of these operational tables rather than retain raw
customer-associated events indefinitely.

## Verification commands

* `cd artifacts/api-server && TEST_GLOB='src/tests/runtime-*.test.ts' pnpm test`
* `pnpm --filter @workspace/projecthub exec vitest run src/runtime-monitoring.test.tsx`
* `pnpm run typecheck:libs` followed by the API, ProjectHub and Companion typechecks

These are isolated JavaScript/API/UI fixtures. They do not establish native
OS-crash, live-provider, production publishing or physical-device coverage.

The development verification included 25 focused API/client/auth/preview-safety
assertions, seven Monitoring/session UI assertions and a signed-in Monitoring
browser pass (desktop and 390px). The browser pass induced a sanitized ProjectHub
error and confirmed HTTP 202, a persisted group, unknown-state behavior on 503,
and `delivered:false` on the no-send test. Companion initially appeared blank
through the shared path proxy; a narrow follow-up on its own Expo origin waited
for fonts and confirmed the visible public home, no runtime import errors, and
HTTP 202 for a synthetic Companion error with fixed home/development context
and no private payload content. Local development overlays display deliberately
induced synthetic messages; the collector does not include them. No physical
phone or production result is claimed.