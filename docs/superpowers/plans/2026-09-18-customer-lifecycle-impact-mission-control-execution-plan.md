# Ultra Clear Customer Lifecycle, Impact, and Mission Control Execution Plan

**Design:** `docs/superpowers/specs/2026-09-18-customer-lifecycle-impact-mission-control-design.md`  
**Status:** Implementation plan for the approved design  
**Scope:** Canonical customer identity, purchase and filter lifecycle, impact ledger,
Companion history, ProjectHub mission control, referral sharing, privacy-safe nearby
locations, migration, and progressive rollout.

This is an execution plan, not a replacement for the approved design. A workstream
must not reinterpret the decisions in that design (in particular, unmatched legacy
purchases require staff review, pending/rejected registrations are excluded from
public impact, and exact customer coordinates are never persisted).

## 1. Delivery rules

1. The API server and database are authoritative. Clients never infer ownership,
   approval, maintenance totals, or impact from local state.
2. OpenAPI and shared database schema changes land before generated clients or
   dependent UI changes. Generated files are regenerated, not hand-edited.
3. Every write has a stable idempotency key and is safe to retry. Lifecycle and
   impact history is append-only; corrections are compensating entries.
4. Customer endpoints derive `customerId` from the verified session. Request-body
   customer IDs are ignored or rejected.
5. ProjectHub performs a live administrator/team-authority check for every
   sensitive read and mutation.
6. Do not add a database-wide unique phone constraint. Historical duplicate
   placeholders remain available for review.
7. Exact coordinates may exist only in the in-memory location calculation. They
   must not enter database columns, logs, analytics payloads, URLs, or error text.
8. Each workstream publishes its migration notes, feature flags, tests, and
   rollback behavior before it is marked complete.

## 2. Wave 0 — restore and freeze a trustworthy baseline

**Owner:** API/platform lead  
**Depends on:** None  
**Blocks:** All schema and feature work

The current API Server, ProjectHub `web`, and `api-tests` workflows have recent
failures after parallel merges. Treat those failures as release blockers, not as
pre-existing noise.

### Tasks

1. Create a clean baseline branch/worktree and capture:
   - `git status --short`
   - merge-base and recent merge commits;
   - schema export/import differences;
   - generated-client status;
   - route registration and duplicate handler inspection.
2. Reproduce failures in isolation, then classify each as merge corruption,
   stale generated output, environment/data leakage, or a real product defect.
3. Restore the existing build/typecheck/test contracts without adding lifecycle
   behavior:
   - root `pnpm typecheck:libs`;
   - `pnpm --filter @workspace/api-server run typecheck`;
   - `pnpm --filter @workspace/projecthub run typecheck`;
   - `pnpm --filter @workspace/projecthub run test`;
   - the repository's `api-tests` workflow/command.
4. Inspect and reconcile exports in `lib/db/src/index.ts` and the schema files;
   inspect `lib/api-spec/openapi.yaml` against generated output.
5. Verify the API route mount in `artifacts/api-server/src/index.ts`, especially
   `uc.ts`, `uc-impact.ts`, and `uc-offline-clients.ts`, for spliced or duplicate
   handlers.
6. Freeze the baseline commit and record exact commands, expected exit codes, and
   known quarantined tests. No lifecycle implementation may conceal a baseline
   failure.

### Deliverables and gate

* A baseline report in the change/PR description, not a production code path.
* Green focused typechecks and the isolated `api-tests` workflow, or a documented
  blocker with an owner and reproduction.
* A merge policy for this project: schema exports, OpenAPI output, migrations,
  route files, and generated clients are merged serially; unrelated UI work may
  be parallelized only after contracts are stable.

## 3. Wave 1 — canonical schema, contracts, and flags

**Owner:** API/database lead  
**Depends on:** Wave 0  
**Can run in parallel with:** Test-fixture design and UI wireframe work only

### Database files

Extend the shared schema and its exports:

* `lib/db/src/schema/uc-users.ts`: identity-link/status fields needed for safe
  reconciliation, without claiming accounts from email alone.
* `lib/db/src/schema/uc-orders.ts`: canonical purchase and purchase-line links.
* `lib/db/src/schema/uc-registered-filters.ts`: verification/review status,
  purchase-line ownership, activation/deactivation state, and preserved
  maintenance totals.
* `lib/db/src/schema/uc-water-impact.ts`: append-only lifecycle/impact ledger,
  event type/source/unit, idempotency key, actor, correction relation, and
  eligibility.
* `lib/db/src/schema/uc-offline-clients.ts`: source/customer links where needed
  for canonical offline provisioning.
* `lib/db/src/schema/uc-referrals.ts`: referral attribution/conversion links
  without exposing raw invite codes to analytics.
* Add focused schema modules for canonical purchases, identity conflicts,
  reconciliation conflicts, legacy-review submissions, audit events, and
  mission-control aggregates if existing tables cannot safely represent them.
* Update `lib/db/src/schema/index.ts` and all package exports.

Use database constraints and indexes for stable IDs, event idempotency, canonical
purchase-source references, one verified registration per physical purchase
line, queue status/age, and customer-scoped history reads. Do not make weak
identity matches unique. Preserve historical rows rather than rewriting them.

### Migration files and startup compatibility

* Add ordered SQL migrations under `lib/db/migrations`.
* Add equivalent idempotent startup DDL in
  `artifacts/api-server/src/index.ts` for environments that rely on startup
  provisioning. Startup DDL must be additive and version/check its shape; it
  must not silently diverge from migrations.
* Include check constraints/enums for:
  `pending_review`, `approved`, `rejected`, `correction_requested`,
  `active`, `inactive`, conflict states, event types, and review decisions.
* Add indexes for canonical customer, order/provider/receipt references,
  registration status, event idempotency, reconciliation queue priority, and
  audit timeline lookup.
* Add retention/access controls for uploaded evidence metadata; store only
  approved object-storage paths and never expose evidence through public APIs.

### API contract

Extend `lib/api-spec/openapi.yaml` first. Define request/response schemas and
error reason codes for:

* authenticated customer identity resolution and registration lookup;
* eligible purchases and verified registration;
* legacy-review submission/status/evidence metadata;
* staff approve/reject/request-correction/link/merge actions;
* canonical customer history, purchases, receipts, maintenance, and impact;
* reconciliation and identity-conflict queues/actions;
* canonical personal/global impact and share payload;
* location-list freshness plus privacy-safe analytics events for coarse
  distance-tier outcomes;
* mission-control indicators, timelines, and audit records.

All customer response schemas must be customer-scoped. Staff schemas must
explicitly distinguish sensitive evidence and require authorization. Mark
feature-flagged routes and preserve existing routes until cutover.

Regenerate API clients/types using the existing `lib/api-spec/package.json`
script/tooling. Verify generated output is the only client contract change and
that no generated file has been manually patched.

### Flags and configuration

Create independently switchable server/client flags for:

* canonical reads;
* canonical dual writes;
* legacy-review submission;
* canonical global-impact projection;
* nearby distance-tier filtering;
* mission-control staff preview.

Flags must default to existing behavior and be auditable. A rollback must be able
to disable reads without deleting canonical records.

### Wave 1 gate

Apply migrations to an empty and representative database, roll them back only in
the disposable test database, regenerate contracts, and run DB package/API
typechecks. Confirm old routes and clients still compile before proceeding.

## 4. Wave 2 — identity and purchase reconciliation

**Owner:** API server lead  
**Depends on:** Wave 1 contracts/schema  
**Primary files:** `artifacts/api-server/src/routes/uc.ts`,
`artifacts/api-server/src/routes/uc-offline-clients.ts`,
`lib/db/src/schema/uc-users.ts`, `uc-orders.ts`, and new reconciliation service
modules.

### Identity service

Implement one transaction-scoped service used by Companion registration,
offline provisioning, history hydration, and staff tools:

1. Normalize email and international phone at the write boundary using existing
   `customer-identity` and `@workspace/api-zod/phone` conventions.
2. Lock candidate identities in a deterministic order.
3. Require password/verified-link proof before reusing an existing account.
4. Fail closed when email and phone resolve to different active customers.
5. Reject deleted accounts and route ambiguous/legacy cases to review.
6. Never log normalized email, phone, credentials, or evidence.

Add concurrency tests for two simultaneous signups, registration attempts, and
identity resolutions. Ensure transactions cannot create two active canonical
customers for one verified principal.

### Purchase service

Build canonical purchase projection/reconciliation around existing order sources:

* Companion `uc_orders`/`uc_order_items`;
* WooCommerce synchronization/webhooks;
* payment-provider reference;
* receipt number;
* ProjectHub/offline customer records.

Apply the approved matching precedence: existing canonical link, unique provider
reference, unique trusted order/receipt reference, app/WooCommerce
cross-reference, then customer + product + amount + time window. Weak matches
must create a conflict, never transfer ownership. Store normalized source
snapshots, product lines, quantity, amount/currency, tax/delivery/discount,
payment and fulfilment states, and non-sensitive correlation ID.

Make payment completion, webhook sync, registration lookup, history hydration,
scheduled reconciliation, and authorized retry call the same idempotent service.
Use explicit conflict reason codes from the design and queue all unresolved
conflicts.

### Wave 2 gate

Prove duplicate provider/receipt/order handling, cross-customer isolation,
amount/currency/product mismatch handling, and concurrent retries. Existing
customer/order reads remain unchanged while shadow links are generated.

## 5. Wave 3 — registration, lifecycle, and ledger

**Owner:** API/domain lead  
**Depends on:** Wave 2 identity and purchase services

### Registration state machine

Implement server transitions for:

* matched purchase → immediately `approved`/verified and active;
* unmatched legacy evidence → `pending_review`;
* staff decision → approved, rejected, or correction requested;
* approved duplicate → merge/link without a second physical unit or impact;
* deactivation/replacement → preserves maintenance history.

Require an idempotency key on every state-changing request. Approval must lock
the submission, canonical customer, purchase line, and registered filter in one
transaction; a repeated request returns the prior result. Staff actions require
live authority, actor, reason, previous value, and new value.

### Lifecycle ledger and projections

Add a single append-only posting service for registration, activation,
deactivation, maintenance, replacement, referral conversion, and corrections.
Every event carries event ID, customer/filter/purchase references, type,
quantitative value/unit, source, idempotency key, actor, timestamp, and optional
correction relation. Never update prior events to repair totals.

Create projections for:

* customer verified litres and maintenance total;
* global verified litres and separately labelled approved organizational impact;
* filter/order/customer timeline;
* reconciliation checks.

Eligibility must exclude pending/rejected registrations. Maintenance totals use
the maximum known valid history during migration; reductions require an explicit
audited administrator correction and compensating ledger entry.

Retire direct impact calculations from `artifacts/api-server/src/routes/uc-impact.ts`
only after dual-write/shadow comparison. During transition, expose comparison
metadata to mission control but keep the old response shape compatible.

### Wave 3 gate

Test all state transitions, duplicate purchase-line registration, retry and
concurrent approval, compensating corrections, maintenance monotonicity, and
pending/rejected exclusion. Assert one physical unit cannot produce duplicate
verified impact.

## 6. Wave 4 — Companion registration, migration, and history

**Owner:** Companion lead  
**Depends on:** Stable OpenAPI client and Wave 3 customer/history contracts  
**Primary files:** `artifacts/uc-companion/components/FilterTrackerSection.tsx`,
`lib/filterRegistrationCommit.ts`, `hooks/useApi.ts`, `hooks/useNotifications.ts`,
`app/orders.tsx`, `app/order/[id].tsx`, `ImpactBubble.tsx`,
`ImpactShareModal.tsx`, and `lib/impactBadge.ts`.

### Registration and local-data migration

* Replace client-owned registration writes with authenticated server requests.
* Show signed-in customer identity and canonical eligible purchase lines.
* Offer legacy-review submission only when no safe digital match exists.
* Show pending, approved, rejected, and correction-requested states/reasons.
* Inspect user-scoped and legacy local activation records after sign-in, never
  attach guest data silently, and require customer confirmation.
* Submit confirmed legacy data; mark local state migrated only after durable
  server confirmation. Keep retryable state on network failure and use an
  idempotency key.
* Preserve the maximum maintenance count and never double-count migration.

### History and impact

Hydrate orders, receipts, payment/fulfilment status, registered filters,
maintenance events, replacement events, review messages, and personal impact
from canonical endpoints. Remove competing local calculations. Ensure refresh
after durable registration/approval and handle partial/network states explicitly.

Update share UI to match the Ultra Clear Impact visual language: heading,
branding/badge, verified personal impact, global/community impact, invite code,
copy/native-share actions, and **“Join us” directly below the invite code**.
The referral link must carry a validated code into registration; analytics receive
only an internal attribution ID/status, never the raw code.

### Wave 4 gate

Run device/UI tests for matched registration, legacy submission, migration
retry, complete history, pending exclusion, share hierarchy, referral
preservation, and offline/error states. Verify no guest/customer data crossover.

## 7. Wave 5 — ProjectHub review and mission control

**Owner:** ProjectHub/API operations lead  
**Depends on:** Staff contracts and Wave 3 queues/ledger  
**Primary files:** `artifacts/projecthub/src/App.tsx`,
`src/pages/impact.tsx`, `src/pages/monitoring.tsx`, plus new lifecycle/queue
pages and API hooks.

Add a unified Customer Lifecycle Mission Control area with queues for:
registration reviews, identity conflicts, order reconciliation, impact
integrity, and coarse location availability.

Display indicators from canonical projections: eligible signed-in customers,
registration conversion, verified/pending/rejected/corrected counts, review age,
linked orders, unmatched references, personal/global reconciliation, share
conversion, tier results/no-result aggregate, and stale closed/unverified map
caches.

Implement staff actions for review decisions, purchase link/unlink with reason,
identity resolution, reconciliation retry, compensating impact correction, and
customer/order/filter timeline. Every mutation must re-check live authority and
write a complete audit event. Sensitive evidence is role-restricted and absent
from public endpoints.

Add integrity views that compare old and canonical totals, orphaned/multiple
links, failed leases/jobs, and unresolved backfill exceptions. Make queue
filters deterministic (status, age, reason, owner) and pagination stable.

### Wave 5 gate

Test role denial, live authority revocation, audit completeness, evidence access,
queue transitions, retries, pagination, and timeline reconstruction without
secrets or personal data in logs.

## 8. Wave 6 — impact projection, receipts, and referrals

**Owner:** API/domain lead with Companion and ProjectHub owners  
**Depends on:** Canonical ledger and history

Switch receipt generation and order/history serialization to canonical purchase
records. Reconcile at payment completion, webhook, registration, history
hydration, scheduled job, and authorized retry. Surface explicit conflicts; never
silently overwrite ownership.

Implement canonical personal/global impact reads. Global totals include eligible
customer ledger entries plus separately labelled approved organizational sources.
Do not include pending/rejected rows. Keep the legacy override available only as
an audited, explicitly labelled migration source until its entries are converted
to ledger events; do not allow an unbounded hidden offset to become the new
source of truth.

Validate referral attribution and benefit conversion idempotently. Add share
events using allowlisted event names/statuses and no raw invite code.

### Gate

For a fixed fixture set, Companion, receipt, order history, ProjectHub, personal
impact, and global impact must agree. Compare old/new totals within an approved
tolerance before enabling canonical global totals.

## 9. Wave 7 — nearby location tiers

**Owner:** Companion/location lead  
**Depends on:** Stable location API contract; may proceed alongside Waves 4–6
after Wave 1

Update `artifacts/uc-companion/lib/locationMap.ts` and both Companion map
surfaces to use client-side Haversine distance and progressive selection:

1. active verified locations at `0 <= d <= 2 km`;
2. if empty, `2 < d <= 5 km`;
3. if empty, `5 < d <= 10 km`;
4. otherwise a no-nearby-results state.

Sort by distance then stable location identity. Preserve existing location-type
filters. The existing location endpoint continues returning active, verified
location coordinates; the client must never send the customer's coordinates to
that endpoint. The selected tier may be emitted only as a coarse allowlisted
analytics value. Permission denied or unavailable provides manual city/country
search and must not imply zero locations. Wider/manual search requires explicit
customer action.

Remove closed/unverified locations from open-map caches and add coarse availability
metrics. Test exact 2/5/10 km boundaries, floating-point tolerance policy,
permission states, empty tiers, stable sorting, cache invalidation, and no
coordinate persistence/logging.

## 10. Wave 8 — observability, alerts, and audit timeline

**Owner:** Platform/operations lead  
**Depends on:** Each feature's event points; instrument incrementally

Use an internal non-sensitive correlation ID across checkout, payment,
order synchronization, receipt generation, registration, lifecycle posting, and
impact projection. Add allowlisted events only:

* registration lookup/submit/approve/reject;
* legacy migration offer/complete;
* reconciliation success/failure;
* impact entry accepted/rejected;
* share open/copy/share and referral attribution;
* location permission/tier/no-result.

Payloads may contain status, reason category, product category, coarse approved
country/city, tier, and correlation ID. They must not contain email, phone,
receipt/evidence text or images, payment credentials, raw invite code, exact
coordinates, or free-text notes.

Add metrics and alerts for every design requirement: registration failures,
review age, one purchase/multiple customers, paid orders absent from history,
receipt/order disagreement, impact mismatch, referral failures, reconciliation
lease/job failure, location API errors, and stale closed/unverified caches.
Audit timelines must record actor, timestamp, reason, previous/new value, and
correlation/event IDs without secrets.

## 11. Wave 9 — backfill and shadow validation

**Owner:** Data migration lead  
**Depends on:** Waves 1–3 and read-only mission control

Run backfill in resumable, leased batches:

1. create canonical identities for valid signed-in customers;
2. project purchases and source links;
3. propose registration/purchase links using approved precedence;
4. preserve maximum maintenance history;
5. create ledger events only for verified/approved eligible records;
6. place ambiguous identity/order/legacy records in queues;
7. record batch checkpoints, counts, source IDs, and errors.

Backfill must be idempotent and restartable. Never auto-approve unmatched legacy
purchases. Never delete source rows or reduce counts. Run shadow comparisons for
orders, registrations, impact, history, receipts, referral attribution, and
location cache validity. Exceptions must be visible in mission control with a
reason and next action.

### Validation queries/checks

* every canonical customer maps to an active verified principal;
* no purchase line has multiple verified physical-unit registrations;
* no pending/rejected event contributes to public impact;
* canonical and old totals reconcile within approved tolerance;
* maintenance count is never lower after backfill;
* receipts/history values equal canonical purchase values;
* all ambiguous ownership remains unresolved;
* no exact coordinate field, log payload, analytics event, or URL is emitted.

## 12. Progressive rollout and rollback

Roll out in this order:

0. stable baseline;
1. additive contracts/schema and shadow tables;
2. backfill/shadow comparisons;
3. dual writes with old reads;
4. staff mission-control preview;
5. selected internal/legacy accounts;
6. all authenticated customers;
7. canonical global impact after reconciliation.

At each stage record cohort, flag state, success/error rates, queue age, mismatch
counts, and rollback owner. Before global totals, require every release gate in
the design plus focused tests/typechecks and active alerts.

Rollback disables canonical reads, dual writes, legacy-review submission,
canonical global projection, and nearby tier filtering independently. Keep
migrated records and audit history. Do not delete data, rewrite ledger events, or
reduce historical maintenance counts. After rollback, reconcile any writes made
under the newer path before re-enabling.

## 13. Test matrix and commands

### Unit/domain

Identity normalization/conflicts; purchase precedence; duplicate physical unit;
state transitions; maintenance monotonicity; impact eligibility/corrections;
Haversine boundaries; analytics allowlist.

### API/integration

Old/new account registration; WooCommerce/Companion matching; review lifecycle;
duplicate references; ownership isolation; receipt/history consistency;
personal/global totals; live admin re-check; idempotent retries; concurrent
writes; migration restart/rollback.

### UI

Matched and unmatched registration; local migration; complete history;
ProjectHub queues; share hierarchy and “Join us” placement; referral link;
permission/tier expansion; map cache removal.

### Suggested verification sequence

```sh
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/projecthub run typecheck
pnpm --filter @workspace/projecthub run test
pnpm --filter @workspace/api-server run test
# Run the repository's api-tests workflow in its isolated test database.
```

Add migration-specific commands to the database package's existing scripts
rather than inventing a second migration runner. Run API tests with isolated
transactions/fixtures and reset state between cases; never rely on a shared
running workflow or production data. The main agent owns actual workflow runs
and release sign-off.

## 14. Safe parallelization and merge order

The safe dependency graph is:

* Wave 0 is serial and blocks all implementation.
* After Wave 1 schema/OpenAPI/codegen is merged, domain tests, Companion
  wireframes, ProjectHub layout, and location utility tests may proceed in
  parallel.
* Identity/purchase reconciliation must precede registration/ledger.
* Registration/ledger contracts must precede canonical history, impact, and
  mission-control reads.
* Companion and ProjectHub UI may develop in parallel once generated clients are
  stable, but each must rebase after contract changes.
* Observability hooks may be added with each workstream; alert thresholds are
  finalized after shadow traffic.
* Backfill and global-impact cutover are serial, guarded operations.

Merge schema exports, migrations, OpenAPI, generated clients, and route mounts
one at a time. Before each merge, inspect `git diff --check`, generated-file
diffs, migration ordering, route registration, and focused typechecks. Do not
combine stale/replayed patches from parallel branches.

## 15. Definition of done

The release is complete only when every valid signed-in customer type can reach
registration; no registration or maintenance count is lost; one purchase line
cannot create duplicate verified impact; Companion, ProjectHub, receipts, and
history agree; pending/rejected legacy rows are absent from public impact; exact
coordinates are absent from storage/logs/analytics; all backfill exceptions are
visible; required alerts are active; focused tests and typechecks pass; and
each rollback flag has been exercised in a disposable environment.