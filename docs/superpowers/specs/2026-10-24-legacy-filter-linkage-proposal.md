# Legacy filter identity review — product approval proposal

**Status: exploration complete; NOT approved for implementation or reconciliation.**

This proposal does not authorize changing any customer record. No schema, API,
staff control, client grouping, backfill, feature flag or live data is changed.
Product approval must explicitly accept the evidence policy, roles, effects and
reversal policy below before implementation. Each later application also needs
its own authenticated staff review; product approval is not blanket data approval.

## Problem and boundaries

Two entries in My Filters may describe one physical filter, or two legitimate
filters that look alike. Missing identity must remain visible, not be resolved by
guessing. This is a same-physical-unit investigation, not account recovery,
purchase verification, primary-tracker switching or historical record merging.

Names, product IDs, dates, order numbers, addresses, email/phone matches,
customer assertions and a single matching candidate are insufficient proof,
individually or combined. They may help staff locate records, not authorize a
link. An authenticated account proves who is requesting help, not which unit it is.

## Current source evidence

| Source | Observed behavior | Consequence |
| --- | --- | --- |
| `artifacts/uc-companion/lib/myFiltersPresentation.ts` | Deduplicates using exact registration IDs and owned offline unit identities; assignments without an exact registration remain separate. Purchase history is retained. | Preserve this conservative default; never add fuzzy suppression. |
| `artifacts/uc-companion/lib/__tests__/myFiltersPresentation.test.mts` | Covers exact primary identity versus similar legacy assignments, offline identity and cross-read deduplication. | Existing tests are a baseline, not evidence that reconciliation exists. |
| `artifacts/api-server/src/lib/customer-assignments.ts` | Links assignments using account/source checks and writes assignment audit events. Its prior-registration lookup is source/order/product based and rejects multiple or cross-owner results. | This is not independent physical-unit proof. Do not reuse `staffConfirmed` or assignment linking as a reconciliation shortcut. |
| `artifacts/api-server/src/lib/offline-purchases.ts` | Hydrates missing line/unit IDs, preserves retired unit IDs and checks sale ownership before registration. Repeated registration returns the existing cycle. | A generated UUID identifies a ledger slot, not retrospective physical provenance. Even the existing listing operation can hydrate missing IDs; a future evidence preview must not call it and claim to be read-only. |
| `artifacts/api-server/src/lib/activation-purchases.ts` | Reads source unit IDs and legacy source/order/product reservations to constrain availability. | A display link must not release a unit for a second activation or weaken these reservations. |
| `lib/db/src/schema/uc-registered-filters.ts` | Stores owner, source identities, lifecycle/verification state and maintenance count; constrains offline/source units and canonical purchase linkage. | Do not bypass uniqueness or rewrite a populated identity to make two rows fit. |
| `artifacts/api-server/src/routes/admin-unsynced-registrations.ts` and `docs/projecthub-registration-record-cleanup.md` | Existing unsynced-registration handling concerns signup/recovery records. | Keep a distinct case type, permission, audit and staff destination. Never clear a recovery record to resolve a filter identity case. |

Additional baseline: `docs/my-filters-verification.md` describes the current
presentation and its device/browser evidence limits. No production records or
physical devices were examined for this proposal. The inspected paths do not
establish a trustworthy physical serial register; none is assumed.

## Approaches considered

1. **Manual support only, no durable link.** Safest immediate behavior and the
   current default. Staff can explain the duplicate-looking entries, but later
   devices and staff cannot reuse a proven identity decision.
2. **Audited, additive identity relation — recommended, subject to approval.**
   Retain every original row and record a narrowly scoped same-unit decision,
   with independently checked evidence and explicit exclusions. More review
   work, but reversible without rewriting ownership, cycles or financial facts.
3. **Fill missing keys or merge historical rows.** Superficially simpler display,
   but can misattribute quantity units and destroy distinct lifecycle evidence.
   Rejected for this scope, including automatic “only one candidate” backfills.

## Proposed staff workflow

1. **Open a separate Filter identity review case.** Staff select exact typed
   record references in an already-authorized account. Capture each record's
   current version and owner. Do not create accounts, registrations or purchases.
   A device-only legacy activation without a durable reference stays unresolved
   until an approved, authenticated capture protocol exists.
2. **Inspect independently.** Show both records, original source references,
   quantity/unit identifiers, registration and replacement cycles, ownership,
   maintenance evidence and financial classification side by side. Explicitly
   label missing, unavailable, retired or contradictory evidence. Search results
   are not a ranked match or a preselected recommended pair.
3. **Collect physical-unit evidence.** Apply the acceptance rules below. Keep
   private evidence in restricted durable storage with access-controlled
   references and integrity hashes, not inline in general logs, analytics,
   customer responses or Git. An inaccessible attachment cannot be approved.
4. **Prepare a non-mutating preview.** State exactly which references would be
   related and which display would change. List all unchanged fields. Store a
   digest of the selected records, evidence revisions, policy version and
   intended effects. Staff cannot supply a trusted owner or proof level.
5. **Independent review.** Recommended policy: an active administrator other
   than the submitting staff member approves or rejects the exact preview,
   recording a reason. UI page visibility is not authorization; the server must
   re-check active staff roles on evidence reads, decisions and application.
6. **Apply once.** Revalidate evidence, approval, roles, ownership and source
   versions in the transaction. Persist only an additive relation and audit
   event. Return a stable receipt for a repeated identical request; conflicting
   or stale requests require a new preview and approval.
7. **Explain the result.** Staff see a case timeline and linked original
   references. A future approved customer view may group proven identities,
   with both original records still inspectable. Pending, rejected, unavailable
   or disputed cases retain today's separate entries.

## Evidence acceptance policy proposed for approval

Accept only a verifiable chain binding **both selected records to the same
physical unit**, with independently established same-account ownership:

- A pre-existing, unique physical serial or tamper-resistant unit identifier,
  recorded against both exact records by a trusted issuance/installation/service
  system, with that system's provenance available for review; or
- A documented physical inspection by authorized staff, supported by original
  unit-specific issuance/service evidence that independently binds each exact
  record to the inspected identifier. Record inspector, time, evidence source
  and why the identifier cannot describe a different quantity unit.

A new sticker, a newly generated ledger UUID, an order-level receipt, a generic
product photograph, copied serial text or customer testimony alone does not
establish the missing historical chain. Inspection cannot invent that chain.
Unverifiable or contradictory evidence means **unresolved**, not a confidence
score. If older units lack suitable evidence, leaving both rows visible is the
correct outcome. No new serial rollout or inspection process is approved here.

Fail closed for different/deleted/unresolved owners, two possible quantity
units, conflicting serials, changed/removed source lines, already-linked
conflicts or uncertain replacement history. Physical housing identity alone
does not prove that two replacement cartridges are the same lifecycle cycle.
Cross-account ownership disputes must leave this flow; never transfer ownership.

## Proposed durable model and transaction rules

These are design requirements, not migrations or endpoint contracts:

- A case contains typed exact record references, same-owner scope, evidence
  revisions, immutable snapshots/digests, policy version and review state.
  Proposed states: draft, submitted, needs evidence, rejected, approved,
  applied, disputed and revoked. New evidence invalidates prior approval.
- A relation expresses physical-unit equivalence only. It is not a canonical
  purchase link, registration replacement, owner transfer or cycle equivalence.
  An existing non-null identity is never overwritten. No transitive graph
  expansion without an explicit preview and approval of every affected record.
  Already-participating records are conflicts for the initial implementation.
- Append-only events record actor ID and role, server time, case/revision,
  selected references, evidence hashes/references, decision reason, policy
  version, preview digest, idempotency key and before/after relation state.
  Audit persistence and relation application must commit together or not at all.
- Use database constraints for conflicting live relations and idempotency,
  deterministic locks over the selected records and applicable account/source
  identities, and version rechecks under lock. Preview locks are insufficient.
  Use the established identity lock order; do not introduce row/contact lock
  inversion or call providers while holding transaction connections.
- Reads must be owner-scoped. A restricted relation lookup may enrich owned
  reads, never authorize another account's records. Do not expose staff evidence
  or internal notes to Companion. No relation endpoint is anonymous.
- Dispute immediately disables use of the relation in presentation. Revocation
  appends a reasoned event; it does not erase the decision or either original.
  Applying a stale approval after dispute/revocation is forbidden. Reapplication
  requires a fresh case and independent approval.
- Evidence retention/access/erasure rules require explicit product and privacy
  approval. The integrity hash alone is not usable proof after evidence loss;
  lost or unreadable evidence suspends reliance pending re-review.

## Protected facts and deliberately limited effects

Applying or revoking a relation must not:

- Change account ownership, account/contact identity, assignment owner or source
  purchase ownership; create an account or bypass source/ownership checks.
- Merge/delete registrations, assignments, purchases, service events or recovery
  logs; populate source-unit/canonical purchase keys by inference.
- Change installation/replacement dates, active flags, lifespan/capacity,
  verification or lifecycle states, primary tracker, local activation storage,
  notification IDs/schedules or performance check-ins.
- Reset, sum or take a synthetic maximum of separate cleaning histories.
  Preserve every recorded count/event and provenance, even when inconsistent;
  a staff maintenance correction is a different explicit action.
- Change price, order/payment status, COD collection, receipts, refunds, stock,
  rewards, referrals, personal/global impact totals or financial eligibility.
- Register/activate another unit or make a consumed/retired unit available.

For the initial approved implementation, separate differing cycles must remain
visible even if staff prove the same physical housing. Relation-aware display
grouping can show the records together, not silently choose one history.
If historical duplicate impact/financial effects are suspected, flag them for a
separate authorized investigation; this relation neither certifies nor corrects
those totals. Customer notifications and device synchronization are not implied.

## Acceptance scenarios required before enabling writes

| Scenario | Required outcome |
| --- | --- |
| Same name/date/order/contact; no unit-specific historical evidence | Unresolved; no relation or display suppression. |
| Newly hydrated offline UUID or quantity two with no ordinal proof | Unresolved; no inferred physical match. |
| Valid independent evidence, same owner, exact immutable preview | One audited relation; originals and protected facts unchanged. |
| Different owners, deleted account, conflicting evidence or replacement cycles | Block or keep distinct cycles; no ownership/history transfer. |
| Source/evidence/role changes between preview, approval and apply | Reject stale application; fresh review required. |
| Simultaneous applications, retry after lost response, conflicting key reuse | One decision receipt; no duplicate or conflicting live relations. |
| Audit persistence fails, evidence inaccessible, source unavailable | No partial application; truthful retry/review state. |
| Customer/non-admin requests staff evidence or decision route | Denied server-side; no private evidence disclosure. |
| Relation disputed/revoked, then a stale client refreshes | Separate originals again; no reapplication from stale approval. |
| Approved relation across app/store/offline references | Source namespaces and availability reservations preserved. |
| Cleaning history, reminders, payments or impact present on both originals | Byte/field-level protected-state checks show no mutation. |
| Lost-registration recovery or selected-record cleanup runs | No relation approval, deletion, or ownership inference from that flow. |

Verification should combine isolated API transaction/concurrency tests,
presentation regression tests and, only after implementation, one signed-in
staff-to-customer browser pass. No production fixtures or real payments needed.
Physical-inspection evidence policy needs an operational trial approved by the
product owner; a browser test cannot establish physical identity.

## Product decisions required before implementation

Approval must name the accountable product approver and explicitly accept:

1. Which trusted historical identifiers and inspection evidence may be used;
   whether any actual legacy records can satisfy that standard.
2. Separate staff submission and independent administrator approval, with
   no override for unsupported evidence or ownership conflicts.
3. Additive relations only, protected facts above, no automatic reconciliation,
   and the exact proposed customer grouping wording and original-history access.
4. Evidence storage/access/retention, privacy handling and dispute/revocation
   behavior, including the effect of unavailable evidence.
5. A separate implementation task and controlled rollout with writes disabled
   until acceptance tests pass; no retrospective bulk run or publication.

Until these decisions are explicitly approved, staff should explain the
uncertainty and retain all existing entries. This document is the exploration
deliverable, not approval or a claim that any linkage has been proven.
