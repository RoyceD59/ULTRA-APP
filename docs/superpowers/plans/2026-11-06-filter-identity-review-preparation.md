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
| Relation effects and grouping | Only a currently active, independently approved relation may group records. Preserve both original rows, ownership, registration, source identity, replacement cycles, maintenance, reminders, payments, and impact. When a relation ends or is revoked, its restricted tombstone is historical provenance only; it never grants grouping, matching, redirection, or ownership effects. A later relation requires a new case and approval. | Not confirmed |
| Private evidence service | Replit App Storage is the existing GCS-backed object service. The water-assessment private route is not a filter-review channel; a case-bound path and separate reviewer/approver checks must be built and verified. | Existing service identified; use for this purpose not approved |
| Evidence deletion | Proposed: delete evidence bytes, object locators, and evidence-specific metadata from active storage 90 days after final case closure, unless a dispute, appeal, or legal hold is open. Unresolved cases receive a review at day 90 and are not silently closed or deleted. Evidence purge is separate from relation status and never deletes a relation or source record. | Draft only; current app has no matching purge or verified backup expiry |
| Detailed audit retention | Proposed: purge remaining detailed case metadata 24 months after the later of final case closure and relation end/revocation, if a relation was created, once no dispute, appeal, or legal hold remains. This may include free-text reasons and reviewer/approver account identities; evidence pointers and evidence-specific metadata are removed under the separate 90-day rule. | Draft only; owner/privacy review required |
| Post-expiry audit stub and tombstone | Proposed immutable stub allow-list: random event ID, event type, UTC timestamp, policy revision, actor role category, outcome/result code, sequence number, and a predecessor digest calculated only from retained stub fields. The stub has no customer, account, source-record, or evidence IDs. A restricted decision tombstone separately preserves exact source-record references and the final outcome while any referenced source record exists; an ended relation also records its start/end events. It may point to stub IDs but cannot grant grouping. Remove the tombstone and related stubs when no referenced source record remains, absent a legal hold. | Draft only; owner/privacy review required |
| Customer wording | Draft below explains the proposed periods, retained historical record, and that history does not group records. It also says no evidence is being collected while backup expiry is unknown. Replace the support placeholder and do not display until service, access, deletion, backup, and policy gates are approved and implemented. | Draft only |
| Dispute and revocation | Dispute disables relation use; revocation appends an audited event without erasing the original decision or records. Reapplication requires a new case and independent approval. | Not confirmed |

### Customer wording draft — not for display

> We are not collecting identity-review evidence yet. If a dedicated, private
> submission channel is approved and available, we will explain its storage and
> backup-retention period before asking you to submit anything. Our proposed
> policy is to remove evidence files and their active-storage references 90 days
> after a case is finally closed, unless a dispute, appeal, or legal hold pauses
> deletion. A case still unresolved at day 90 will be reviewed, not automatically
> closed or deleted.
>
> We propose to keep detailed decision notes for 24 months after final case
> closure and the end or revocation of any approved relation, once disputes,
> appeals, and legal holds are resolved. After those notes expire, a limited
> audit record of the event type, date, policy version, staff-role category, and
> outcome would remain while the original records exist. We may also retain a
> restricted historical record of the final decision, including whether an
> approved relation later ended or was revoked. This history does not group
> records; only a currently active, separately approved relation may do that.
> This process does not change ownership or remove your original records.
> Contact [existing support channel] with questions.

This copy is not ready to show customers: the dedicated review channel is not
implemented, backup expiry is unknown, and all listed periods remain proposals.
Do not direct customers to ordinary chat, public media upload, or water-test
upload for this evidence. Collection remains prohibited until backup persistence
is documented or a service with a documented schedule is selected and approved.

## Audit clock and essential relation history

Proposed semantics for owner review:

- **Evidence files:** start the 90-day clock at final case closure. A case is
  not finally closed while disputed, appealed, under legal hold, or otherwise
  awaiting review. An unresolved case reaching day 90 gets a review task; it is
  not automatically treated as closed or deleted. Purging evidence and its
  object locator never changes an active relation or source record. A hold or
  active dispute blocks deletion until resolved.
- **Detailed decision metadata:** start the 24-month clock after the later of
  final case closure and relation end/revocation, if a relation was created.
  Do not purge while a dispute, appeal, or legal hold is open. At 90 days,
  remove evidence bytes, object locators, and evidence-specific metadata after
  successful or confirmed-absent deletion, regardless of whether the relation
  is active. At 24 months, purge the remaining free-text reasons,
  reviewer/approver account identities, and other detailed case metadata.
  Evidence pointers must not remain in detailed audit records after the 90-day
  evidence purge.
- **Immutable audit stub after detail expiry:** retain only an append-only stub
  while any referenced source record exists, absent a legal hold. Its proposed
  fields are: random audit-event ID, event type, UTC timestamp, policy revision,
  actor role category (reviewer, independent approver, or worker), outcome or
  action-result code, sequence number, and predecessor digest computed solely
  from retained stub fields. The stub must not contain names, account IDs,
  customer or source-record IDs, free text, evidence pointers, object names,
  evidence hashes, IP addresses, or device data. Tombstones may reference stub
  IDs; the stub itself has no record or evidence references. The digest must
  not be computed from expiring detailed metadata.
- **Active ledger and historical decision tombstone:** while an approved
  relation is active, keep its exact source-record references in the restricted
  operational ledger. On ending or revoking it, replace its active state with a
  restricted tombstone containing the source references, prior relation status,
  start/end event times, final outcome, policy revision, and relevant audit-stub
  references. For a finalized case that did not create a relation, create a
  non-relation decision tombstone when detailed metadata is purged. Retain either
  tombstone only while at least one referenced source record exists, absent a
  legal hold. Preserve source records unchanged.
- **Historical does not mean active:** only a separately approved relation
  whose current state is active may group or display records together. A
  tombstone is read-only provenance, whether it records an ended relation or a
  decision that never created one. It must not be consulted by grouping,
  matching, redirection, ownership, or record-selection logic. Restoring a
  tombstone cannot reactivate a relation; any later relation needs a new case,
  current evidence review, independent approval, and a new active relation.

These periods, fields, and access rules are proposals. The owner/privacy reviewer
must approve the exact allow-list and retention boundaries before implementation.

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
3. **Add additive case, evidence-metadata, active-relation, tombstone, and
   append-only audit-stub records.** Bind the preview to current record versions,
   evidence revisions, policy revision, and intended display-only effect.
   Approval and application recheck roles, ownership, evidence, and versions
   under deterministic locks in one transaction. Only an active approved
   relation can drive grouping; tombstones are excluded from all grouping and
   matching paths. Keep all source rows/history and existing
   purchase/registration identities. Relation writes remain behind an explicit
   default-off server gate.
4. **Use a separate private storage namespace and route.** Plan for
   `filter-identity-reviews/<case-id>/<opaque-object-id>` in the private App
   Storage directory; do not use public `uploads/` or the water-test route.
   Issue short-lived upload URLs only after live case/role checks, bind each
   object to a case and uploader, and independently verify bytes, detected MIME,
   size, and object generation before accepting it. Reads are non-cacheable and
   recheck the assigned reviewer or independent approver on every request.
5. **Add separate, visible retention jobs.** The evidence job deletes due
   evidence objects, object locators, and evidence-specific metadata 90 days
   after final case closure, unless a dispute, appeal, or legal hold blocks it;
   relation state does not grant or revoke deletion authority. A separate
   metadata job purges remaining detailed case metadata only after the 24-month
   clock and relation-end/hold checks pass. It preserves the allow-listed
   immutable audit stubs and restricted tombstones while source records remain,
   without restoring grouping permission. Record claims, attempts, next retry,
   and outcomes without evidence content or signed URLs in logs. App Storage
   has no native expiry, so configure a Scheduled Deployment or equivalent
   managed worker. Never report backup erasure unless the provider confirms it.
6. **Stage with collection and relation writes disabled.** Exercise the
   complete staff review, authorization, transaction and deletion paths on
   isolated fixtures. Enable neither evidence collection nor Companion grouping
   until the acceptance suite and storage/backup gates pass and the owner
   approves the exact release separately.

### Deletion-job failure and retry tests

- Evidence due 90 days after final closure is claimed once; open or unresolved
  cases, disputes, appeals, and legal holds block deletion. An active relation
  does not block evidence-file purge and is never changed by it.
- Detailed metadata is not purged until 24 months after the later of final case
  closure and relation end/revocation, if applicable, and no dispute, appeal, or
  legal hold remains.
- Day-90 unresolved review is generated once and remains pending until a human
  resolution; resolution sets the real closure timestamp rather than backdating
  an inferred one.
- Missing object is treated as idempotent deletion success; a second run does
  not recreate or re-report it.
- Transient storage timeout, throttling, or server error leaves the case and
  evidence metadata in a retryable failure state with bounded backoff and a
  visible operator alert. It never marks deletion successful on an exception.
- Crash after object deletion but before database acknowledgement retries safely:
  absent-object confirmation completes object-locator cleanup without
  duplicating audit events or changing the active relation/tombstone.
- Successful 90-day purge removes evidence-specific metadata and every object
  pointer before the 24-month detailed-case purge. Neither deleted evidence
  locators nor content hashes appear in retained audit stubs.
- Database failure before deletion prevents the object request; failure after
  deletion retains a recoverable deletion receipt/claim and is repaired by a
  later run. It does not create or change a relation tombstone.
- Concurrent workers use an atomic claim/lease; expired leases recover after a
  worker crash. A stale worker cannot mark a newer claim complete.
- A case reopened, disputed, or placed on hold between selection and deletion
  fails a fresh state check and is not deleted. A changed policy version requires
  a new eligibility calculation.
- A batch with one failing object continues safely for unrelated due cases;
  per-object errors are private, contain no evidence content or signed URL, and
  remain actionable.
- Evidence purge removes bytes, object locators, and evidence-specific metadata
  at 90 days. Detailed-metadata purge later removes free-text reasons,
  reviewer/approver account identities, and other non-allow-listed fields while
  keeping exactly the immutable audit-stub allow-list. Attempts to update or
  delete a retained stub are rejected; new events append without rewriting old
  events.
- Stub sequence and predecessor digest remain verifiable using only retained
  stub fields; no digest is derived from content that the retention policy later
  deletes.
- An ended/revoked relation leaves a restricted tombstone; a finalized decision
  that never created a relation gets a non-relation tombstone when detailed
  metadata expires. Each remains only while any source record exists. Automated
  grouping, matching, redirection, and selection queries ignore all tombstones
  and use only currently active approved relations. Re-approval requires a new
  case; restoring a tombstone cannot enable grouping.
- When no referenced source record remains, the tombstone and linked stubs become
  eligible for deletion unless a legal hold applies. Evidence or metadata purge
  never removes original registrations, purchases, maintenance, or
  replacement-cycle records. Assert exact protected-state equality.
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
job, 24-month detailed-metadata clock, immutable audit-stub allow-list and
retention, tombstone fields/lifetime, prohibition on grouping from tombstones,
customer wording, and provider backup-expiry behavior. Until then, do not
collect evidence, inspect/link particular records, implement the workflow,
change schema, enable writes, or publish. This note is a review plan, not
approval to perform a retrospective reconciliation.
