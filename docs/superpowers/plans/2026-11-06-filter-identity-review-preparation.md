# Task #1118 — Filter identity review preparation

**Status: preparation only.** This document is not approval to link records,
collect private evidence, change schemas, enable writes, or publish a release.
No customer record was accessed or changed for this preparation.

## Source and approval provenance

- Current project branch: `App`
- Current project revision when rechecked: `eae1df30a61a7a7cd644d8475496c65920816b8a`
- Proposal: `docs/superpowers/specs/2026-10-24-legacy-filter-linkage-proposal.md`
- Proposal content SHA-256:
  `9d85c258dbc1f8caac13f9c03cc303b084a079a6a232ce54bd2c8c216a216ca7`
- Proposal introduction commit:
  `2351fe7aab8ea90c51a0c38cb8e091a7642a564f`
- Supplied preparation guide:
  `attached_assets/Task-1118-Preparation-and-Approval-Guide_1793983785551.md`
- A separate staff preparation guide was not found among the project files.
  The attached guide is the preparation document available for this review.
- The attached guide reports an earlier owner approval, but does not include an
  approval message, timestamp, or exact approved revision. Project files and the
  task description do not verify that approval. Do not treat the proposal as
  approved until the owner supplies or confirms that exact approval.
- The repository search found no approval reference tied to this file hash or
  introduction commit. Revision-specific approval remains unverified.

The attached guide reports that the proposal path was unavailable on a GitHub
main revision. It is present in this Replit project at the path above. This
project copy is the revision reviewed here; the GitHub report does not identify
or establish an equivalent proposal revision.

## Existing private storage capability

- The project uses Replit App Storage, backed by Google Cloud Storage and accessed
  by the API through Replit's sidecar credentials. Private object paths are
  rooted at the configured private object directory; no storage values or
  credentials are recorded here.
- There is a private water-assessment upload/serving path under a separate
  `water-tests/<assessment>/...` namespace. Its server route checks the attached
  customer owner or a live ProjectHub user with `water_tests:view`, verifies the
  assessment-bound, clean-upload database record, and serves with
  `Cache-Control: private, no-store`. The generic `/storage/objects/uploads/...`
  route is public and explicitly refuses assessment-bound uploads. That generic
  media route is not suitable for identity-review evidence.
- This is an assessment-specific capability, not an existing filter-review
  evidence service. It has no filter-review case binding, assigned reviewer /
  independent approver workflow, or evidence-specific deletion schedule.
- The application can delete individual GCS objects and does so for some
  unrelated Team Library and account-media paths. The code search found no
  scheduled purge or dedicated deletion path for the private water-assessment
  evidence namespace. The upload metadata expiry is not an object-retention
  policy and does not prove the stored bytes are deleted.
- Replit's official
  [App Storage documentation](https://docs.replit.com/features/data-and-storage/object-storage)
  states that App Storage does not provide object versioning, lifecycle rules,
  or automatic retention policies; timed cleanup requires a scheduled
  deployment. Neither the app repository nor the available project settings
  establish an object-backup expiry period. Provider backup expiry is therefore
  unknown and must not be promised. Object deletion cannot be presented as
  verified deletion from backups.

**Readiness conclusion:** the project has useful private-storage primitives, but
no confirmed end-to-end evidence channel or deletion/backup lifecycle suitable
for Task #1118. Do not collect evidence in the existing water-assessment or
public media flows. A dedicated case-bound private path, role checks, scheduled
deletion, and an explicit answer on provider backup expiry are prerequisites.

## Blank restricted-case worksheet

Use this worksheet only in an authorized, access-controlled case system after
that system and the evidence policy are approved. Do not fill it in inside this
repository, ordinary chat, tickets, analytics, or public uploads. If no approved
private channel exists, collect no evidence and leave the case unstarted.

| Review field | Record A | Record B |
| --- | --- | --- |
| Typed record kind and exact internal reference | | |
| Owning account internal reference | | |
| Existing registration or assignment references | | |
| Purchase source, order and line references, if present | | |
| Exact quantity-unit reference or ordinal, if present | | |
| Installation and replacement-cycle references | | |
| Current state and record version/update time | | |
| Existing identity relations or conflicts | | |

Additional case fields, to be completed only in the approved restricted system:

- Case reference and submitter's authorized role:
- Proposed same-physical-unit relation and concise reason:
- Unit-specific evidence references and revisions (never paste evidence here):
- How the evidence binds each exact record to the same unit:
- Same-account ownership check and result:
- Missing, unavailable, retired, or contradictory evidence:
- Preview version/digest and unchanged fields:
- Independent administrator approver, decision, reason, and timestamp:
- Application receipt or reason not applied:
- Dispute/revocation state and reason, if applicable:

Names, dates, orders, contact details, product/SKU similarity, customer
assertions, and a single matching candidate are not unit-specific proof. If the
chain does not distinguish a particular physical unit, including one unit from a
multi-quantity order, leave the records separate and mark the case insufficient.
Different owners require escalation; this workflow must not transfer ownership.

## Policy decisions for owner review

These are proposals, not recorded approvals. The product owner must decide each
item against the exact proposal before implementation or evidence collection.

| Decision | Draft for review | Current status |
| --- | --- | --- |
| Reviewer and approver | Assigned authorized staff submit; a different active administrator independently approves or rejects. Both roles are checked by the server at each action. | Not confirmed |
| Acceptable evidence | Only the exact historical unit-specific evidence chains in the proposal; unsupported or conflicting evidence remains unresolved with no override. | Not confirmed |
| Relation effects | Additive, revocable physical-unit relation only. Preserve both original rows, ownership, registration, source identity, replacement cycles, maintenance, reminders, payments, and impact. | Not confirmed |
| Private evidence service | Replit App Storage is the existing GCS-backed object service. The water-assessment private route is not a filter-review channel; a case-bound path and separate reviewer/approver checks must be built and verified. | Existing service identified; use for this purpose not approved |
| Evidence deletion | Proposed: delete evidence bytes from active storage 90 days after final case closure. Unresolved cases receive a review at day 90 and are not silently deleted. Add a scheduled, auditable purge and report whether provider backup copies can expire. | Draft only; current app has no matching purge or verified backup expiry |
| Audit retention and deletion | Draft recommendation: retain minimal decision/audit metadata for 24 months after the later of final case closure and relation end/revocation, once there is no active relation or open dispute/appeal. Keep the operational relation ledger while it is needed to represent an active relation and preserve essential history for the source records' lifetime. | Draft only; owner/privacy review required |
| Customer wording | Draft below names the verified storage service and proposed periods while making clear the dedicated channel is not yet available. Replace the support placeholder and do not display until service, access, deletion, backup and policy gates are approved and implemented. | Draft only |
| Dispute and revocation | Dispute disables relation use; revocation appends an audited event without erasing the original decision or records. Reapplication requires a new case and independent approval. | Not confirmed |

### Customer wording draft — not for display

> We may ask for specific unit or installation evidence to review whether two
> filter records refer to the same physical unit. When a dedicated review
> channel is available, please submit requested evidence only through that
> channel; it will be held in a private, access-controlled area of Replit App
> Storage, which uses Google Cloud Storage.
> We propose to delete evidence files 90 days after a case is closed. If a case
> is still unresolved after 90 days, we will review it rather than delete the
> evidence automatically. We will keep only essential relation history while
> that relation remains active. Once both the case is finally closed and the
> relation has ended, we propose to retain detailed decision records for 24
> months, subject to documented legal holds. This review will not change
> ownership, registrations, installation or maintenance history, replacement
> cycles, payments, reminders, or impact totals; your original records remain
> available. Contact [existing support channel] with questions.

This copy is not ready to show customers: the dedicated review channel is not
implemented, backup expiry is not known, and all listed periods remain proposals.
Do not direct customers to ordinary chat, public media upload, or water-test
upload for this evidence.

## Audit clock and essential relation history

Proposed semantics for owner review:

- **Evidence files:** set the 90-day deletion clock from the timestamp when a
  case becomes finally closed. A case is not finally closed while disputed,
  appealed, under legal hold, or otherwise awaiting review. An unresolved case
  reaching day 90 gets a review task; it is not automatically treated as closed
  or deleted. A final resolution then establishes the applicable closure time.
- **Detailed decision/audit metadata:** the 24-month clock begins only after
  both the case is finally closed and its relation is no longer active (including
  revocation), with no open dispute or appeal. Use the later of those event
  times; opening a dispute or applying a legal hold suspends purge until resolved.
- **Essential relation history:** do not apply that 24-month purge to a relation
  that is still active. Keep a separate minimal relation ledger for as long as
  the relation affects customer-visible grouping, with exact references to the
  original records, relation status, event timestamps, and policy revision.
  Preserve the originals unchanged. After the relation ends, retain a minimal
  relation tombstone with those references while the source records remain;
  remove evidence pointers, detailed reasons, and reviewer/approver attribution
  after the 24-month audit period, subject to approved legal holds. This
  distinction is a recommendation; the privacy owner must approve the retention
  of record references and tombstones before implementation.

## Dedicated-channel implementation plan — no collection or relation writes

1. **Approve the policy gates first.** Confirm the exact proposal revision,
   reviewer/approver roles, evidence standard, storage provider and backup
   expiry, retention periods, audit/tombstone rules, customer copy, and support
   contact. No upload or case-submission route may be enabled before this gate.
2. **Build an isolated ProjectHub case workflow.** A reviewer selects two
   exact typed record references; the server snapshots owners, versions, source
   identifiers, replacement cycles, and relevant protected facts. Search is
   not a ranked match. The reviewer attaches only evidence references through
   this dedicated case. A distinct active administrator approves or rejects an
   immutable preview; self-approval is denied server-side.
3. **Add additive case, evidence-metadata, relation, and audit records.** Bind
   the preview to current record versions, evidence revisions, policy revision,
   and intended display-only effect. Approval and application recheck roles,
   ownership, evidence and versions under deterministic locks in one transaction.
   Keep all source rows/history and existing purchase/registration identities.
   Relation writes remain behind an explicit default-off server gate.
4. **Use a separate private storage namespace and route.** Plan for
   `filter-identity-reviews/<case-id>/<opaque-object-id>` in the private App
   Storage directory; do not use public `uploads/` or the water-test route.
   Issue short-lived upload URLs only after live case/role checks, bind each
   object to a case and uploader, and independently verify bytes, detected MIME,
   size, and object generation before accepting it. Reads are non-cacheable and
   recheck the assigned reviewer or independent approver on every request.
5. **Add visible lifecycle state and a scheduled deletion worker.** Keep
   evidence object status separate from the relation ledger. The worker queries
   only finally closed, due cases with no dispute, hold, active relation, or
   pending decision; it records claims, attempts, next retry, and deletion
   outcome without putting evidence content or signed URLs in logs. App Storage
   has no native expiry, so this requires an explicitly configured Scheduled
   Deployment or equivalent managed worker. Never report backup erasure unless
   the provider confirms it.
6. **Stage with collection and relation writes disabled.** Exercise the
   complete staff review, authorization, transaction and deletion paths on
   isolated fixtures. Enable neither evidence collection nor Companion grouping
   until the acceptance suite and storage/backup gates pass and the owner
   approves the exact release separately.

### Deletion-job failure and retry tests

- Due final case is claimed once; not-yet-due evidence, open cases, unresolved
  cases, active relations, disputes, appeals, and legal holds are not deleted.
- Day-90 unresolved review is generated once and remains pending until a human
  resolution; resolution sets the real closure timestamp rather than backdating
  an inferred one.
- Missing object is treated as idempotent deletion success; a second run does
  not recreate or re-report it.
- Transient storage timeout, throttling, or server error leaves the case and
  evidence metadata in a retryable failure state with bounded backoff and a
  visible operator alert. It never marks deletion successful on an exception.
- Crash after object deletion but before database acknowledgement retries safely:
  absent-object confirmation completes metadata cleanup without duplicating
  audit events or removing the relation ledger.
- Database failure before deletion prevents the object request; failure after
  deletion retains a recoverable tombstone/claim and is repaired by a later run.
- Concurrent workers use an atomic claim/lease; expired leases recover after a
  worker crash. A stale worker cannot mark a newer claim complete.
- A case reopened, disputed, or placed on hold between selection and deletion
  fails a fresh state check and is not deleted. A changed policy version requires
  a new eligibility calculation.
- A batch with one failing object continues safely for unrelated due cases;
  per-object errors are private, contain no evidence content or signed URL, and
  remain actionable.
- Deleting evidence never removes the essential relation ledger, original
  registration, purchase, maintenance, or replacement-cycle records. Tests
  assert exact protected-state equality before and after purge.
- Retry exhaustion stays visible and recoverable; it cannot be silently
  discarded or converted to a claim that provider backups have expired.

## Owner decision: unknown backup expiry

**Recommended decision: NO-GO for evidence collection until backup expiry is
documented.** Ask the App Storage provider for the maximum persistence period of
deleted objects in any backup or recovery copy, and whether that period can be
configured or verified. If it cannot be confirmed, select a storage service with
a documented deletion/backup schedule before collection. Do not promise that
evidence is fully erased after 90 days. Any alternative that knowingly accepts
unknown backup persistence would require a separate explicit privacy/legal
approval and customer disclosure; it is not authorized by this preparation.

## Next gate

The owner must confirm the exact proposal revision and explicitly decide the
items above, including the private evidence service, access controls, deletion
job, audit-retention clock and relation-history exception, and provider
backup-expiry behavior. Until then, do not collect evidence, inspect/link
particular records, implement the workflow, change schema, enable writes, or
publish. This note is a review plan, not approval to perform a retrospective
reconciliation.
