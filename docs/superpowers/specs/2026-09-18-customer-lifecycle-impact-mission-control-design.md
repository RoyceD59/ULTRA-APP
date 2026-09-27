# Ultra Clear Customer Lifecycle, Impact, and Mission Control Design

**Date:** 2026-09-18  
**Status:** Approved design awaiting written-spec review

## 1. Purpose

Ensure every valid signed-in Ultra Clear Companion customer, including legacy customers, can register filters and see complete, consistent filter, maintenance, impact, receipt, order, and referral history.

The same canonical records must power:

- Ultra Clear Companion customer views
- ProjectHub administration and mission control
- Personal and global impact totals
- Receipts and order history
- Referral and “Share My Impact” experiences
- Operational monitoring and reconciliation

The design also limits location discovery to the nearest safe distance tier without storing precise customer coordinates.

## 2. Scope

### Included

1. Authenticated customer identity reconciliation
2. Verified and staff-reviewed legacy filter registration
3. Canonical purchase, registration, lifecycle, and impact records
4. Receipt and order-history reconciliation
5. Companion and ProjectHub history views
6. “Share My Impact” visual and referral updates
7. Privacy-safe nearby-location distance tiers
8. ProjectHub mission control, observability, alerts, and audit trails
9. Backfill, shadow comparison, progressive rollout, and rollback controls

### Excluded

1. Replacing current payment providers
2. Replacing WooCommerce as an order source
3. Automatically approving unmatched legacy purchases
4. Letting community ratings change water-health guidance
5. Persisting exact customer coordinates
6. Recalculating or reducing legitimate historical maintenance counts

## 3. Approved product decisions

1. The server is authoritative for registrations, lifecycle history, impact, purchases, referrals, and review status.
2. Existing working flows are migrated incrementally rather than replaced in one release.
3. A matched eligible purchase can create an immediately verified registration.
4. An unmatched legacy purchase is allowed only through staff review.
5. Pending or rejected legacy registrations do not affect public global impact.
6. Customer lifecycle changes cannot reduce maintenance history. Only an explicit, authenticated, audited administrator correction may reduce a count.
7. Companion, ProjectHub, receipts, and order history must read the same canonical purchase and lifecycle records.
8. Exact device location remains on the device. Analytics and durable storage may contain only coarse country/city or distance-tier information.
9. Nearby locations are selected progressively: 0–2 km, then 2–5 km, then 5–10 km.

## 4. Architecture

### 4.1 Canonical customer identity

Every authenticated principal must resolve to one active database-backed Companion customer before customer-owned actions are allowed.

Identity sources include:

- Existing Companion password accounts
- Existing WooCommerce-provisioned accounts
- Verified social-login identity links
- Approved offline or legacy customer records

Resolution must:

- Normalize email and international phone numbers at public write boundaries
- Use transaction-scoped identity locks
- Reuse an existing account only after that account’s required credential or verified link check
- Never claim a password or social account through email matching alone
- Fail closed when email and phone resolve to different active customers
- Route ambiguous legacy identities to staff review
- Reject deleted accounts

Historical duplicate placeholders remain untouched. The system must not introduce a database-wide unique phone constraint.

### 4.2 Canonical purchase identity

A canonical purchase record links all known representations of one purchase:

- Companion order ID
- WooCommerce order ID
- Payment-provider reference
- Receipt number
- Customer ID
- Normalized identity snapshot
- Currency, totals, tax, delivery, and discount values
- Product lines, quantities, and product identifiers
- Payment method and payment status
- Fulfilment status
- Source timestamps

One purchase line may support only one verified filter registration for the same physical product unit.

Matching precedence:

1. Existing canonical link
2. Unique payment-provider reference
3. Unique trusted receipt or order reference
4. App/WooCommerce cross-reference
5. Customer identity plus product line, amount, and time window
6. Staff reconciliation

Weak matching alone must never transfer purchase ownership between customers.

### 4.3 Filter registration

Registration has two paths.

#### Verified-purchase registration

The customer supplies or selects purchase evidence. The API matches an eligible paid or fulfilment-state order and product line. If ownership and uniqueness checks pass, the registration becomes verified and active.

#### Legacy-review registration

When no digital purchase is matched, the customer may submit:

- Product or filter model
- Approximate purchase date
- Installation or activation date
- Receipt/order reference when available
- Serial or QR details when available
- Seller or purchase channel
- Optional receipt image

The record enters `pending_review`.

ProjectHub staff may:

- Approve and activate
- Reject with a customer-visible reason
- Request corrected evidence
- Link the submission to a discovered purchase
- Merge a duplicate submission without duplicating impact

Approval must be idempotent and auditable.

### 4.4 Lifecycle and impact ledger

The server-owned lifecycle ledger records:

- Registration approval or rejection
- Activation and deactivation
- Cleaning and maintenance
- Replacement
- Staff correction
- Verified litres impacted
- Referral conversion and benefit events

Each event contains:

- Event ID
- Customer ID
- Registered-filter ID when applicable
- Canonical purchase and purchase-line references when applicable
- Event type
- Quantitative value and unit
- Source
- Idempotency key
- Actor
- Timestamp
- Correction relationship when applicable

Impact is append-only. Corrections use compensating entries rather than rewriting prior ledger history.

Personal impact is the sum of eligible customer ledger entries. Global impact is the sum of the same eligible entries across customers plus separately labelled approved organizational impact sources. Pending or rejected registrations are excluded.

### 4.5 Legacy client migration

After sign-in, Companion inspects user-scoped and legacy local activation records.

Migration rules:

- Never silently attach guest data to a customer
- Ask the customer to confirm a plausible legacy activation
- Submit confirmed data to the server reconciliation endpoint
- Preserve the maximum known maintenance count
- Mark local data as migrated only after durable server confirmation
- Keep retryable migration state when the API is unavailable
- Never count migrated data twice

## 5. Customer and administrator experiences

### 5.1 Companion registration

The registration experience must:

1. Confirm the signed-in customer
2. Search canonical purchases
3. Present eligible product lines
4. Allow activation-date confirmation
5. Complete verified registration when matched
6. Offer legacy-review submission when unmatched
7. Display pending, approved, rejected, or correction-requested status
8. Refresh lifecycle, rewards, impact, and history after durable completion

### 5.2 Companion history

Each customer can see:

- Active and previous registered filters
- Verification status
- Product and quantity
- Purchase date and activation date
- Order and receipt references
- Payment method and status
- Maintenance count and history
- Personal litres impacted
- Replacement history
- Staff-review messages

The customer must see only records owned by their canonical customer ID.

### 5.3 ProjectHub customer lifecycle

ProjectHub provides:

- Customer identity summary
- Canonical purchase and order links
- Receipt and payment references
- Registered filters and lifecycle timeline
- Maintenance and impact totals
- Legacy-review evidence and decisions
- Reconciliation conflicts
- Administrator corrections
- Audit history

Sensitive evidence is accessible only to authorized roles and is never exposed through public endpoints.

### 5.4 Share My Impact

The share experience uses the same visual language as **The Ultra Clear Impact**:

- Ultra Clear Impact heading
- Ultra Clear branding and impact badge
- Verified personal impact
- Global/community impact
- Invite code
- **Join us** directly below the invite code
- Copy-link and native-share actions

The Join us link carries a validated referral code into registration. Raw invite codes are not recorded in analytics.

Pending registrations are clearly excluded from verified personal and global totals.

## 6. Receipt and order reconciliation

Reconciliation runs:

1. At payment completion
2. When an order webhook or synchronization event arrives
3. During filter registration
4. When customer history is hydrated
5. In a scheduled background job
6. On an authorized administrator retry

Conflict reason codes include:

- Customer identity mismatch
- Duplicate provider reference
- Duplicate receipt reference
- Product-line mismatch
- Quantity mismatch
- Amount or currency mismatch
- Paid order missing receipt
- Receipt attached to multiple customers
- App/WooCommerce duplicate representation
- Registration already owned

Conflicts enter an explicit queue and never silently overwrite ownership.

Receipts are generated from the canonical purchase record. Companion order history and ProjectHub must display values from that same record.

## 7. Nearby-location selection

### 7.1 Location use

The app requests device-location permission when the customer uses nearby discovery.

Exact coordinates:

- Are used in memory for distance calculation
- Are not stored in the database
- Are not placed in logs
- Are not sent to analytics

If server-side spatial search is later required, it needs a separate privacy review and explicit approval.

### 7.2 Distance tiers

The shared distance utility uses the Haversine formula.

Tier boundaries:

- Tier 1: `0 <= distance <= 2 km`
- Tier 2: `2 < distance <= 5 km`
- Tier 3: `5 < distance <= 10 km`

Selection:

1. Return active, verified locations in Tier 1.
2. If Tier 1 is empty, return Tier 2.
3. If Tier 2 is empty, return Tier 3.
4. If Tier 3 is empty, show a no-nearby-results state.
5. Wider or manual search requires explicit customer action.

Results sort by distance, then stable location identity. Existing location-type filters remain available.

Denied or unavailable permission shows a manual city/country search and does not imply that no locations exist.

## 8. Mission control

ProjectHub adds a unified Customer Lifecycle Mission Control area.

### 8.1 Queues

1. **Registration reviews** — pending legacy evidence and review age
2. **Identity conflicts** — principals or records that cannot be safely linked
3. **Order reconciliation** — receipt, payment, order, product, or ownership mismatches
4. **Impact integrity** — ledger or projection mismatches
5. **Location availability** — coarse country/city areas with no verified location within the supported tiers

### 8.2 Indicators

- Signed-in customers eligible to register
- Registration attempts and success rate
- Verified versus pending legacy registrations
- Pending-review count and oldest age
- Rejected and corrected submissions
- Orders linked to customer history
- Unmatched receipts and provider references
- Personal-to-global impact reconciliation status
- Share-to-signup conversion
- Nearby results by distance tier
- Users reaching the no-nearby-results state, aggregated coarsely
- Stale or closed locations present in active client caches

### 8.3 Actions

Authorized staff may:

- Review legacy registration evidence
- Link or unlink a purchase with an explicit reason
- Resolve identity conflicts
- Retry reconciliation
- Apply compensating impact corrections
- Review a customer/order/filter timeline

Every mutation records actor, timestamp, reason, previous value, and new value.

## 9. Observability

### 9.1 Privacy-safe events

Allowed events:

- Registration lookup started/completed
- Registration submitted/approved/rejected
- Legacy migration offered/completed
- Order reconciliation succeeded/failed
- Impact entry accepted/rejected
- Share modal opened
- Invite copied/shared
- Referral signup attributed
- Location permission granted/denied
- Distance tier selected
- No location within 10 km

Event payloads may include:

- Internal correlation ID
- Coarse country/city when approved
- Registration status
- Reconciliation reason category
- Distance tier
- Product category

Event payloads must not include:

- Phone numbers or email addresses
- Receipt images or evidence text
- Raw invite codes
- Payment credentials
- Exact coordinates
- Free-text staff or customer notes

### 9.2 Metrics and alerts

Alerts are required for:

- Registration failure-rate threshold breaches
- Pending-review age target breaches
- One purchase linked to multiple customers
- Paid orders missing customer-history records
- Receipt/order total disagreements
- Impact projection mismatch
- Referral attribution failures
- Reconciliation job failures or expired leases
- Location API error-rate increases
- Closed/unverified locations remaining in open-map caches

### 9.3 Correlation and timelines

A non-sensitive correlation ID follows:

1. Checkout
2. Payment initiation and completion
3. Order creation and synchronization
4. Receipt generation
5. Filter registration
6. Lifecycle and impact posting

ProjectHub can reconstruct this timeline without displaying secrets or personal data in logs.

## 10. Data migration and rollout

### Stage 0: Restore a stable baseline

Reconcile merged work and restore API, ProjectHub, library, Companion, and focused test workflows before implementing lifecycle changes.

### Stage 1: Contracts and shadow tables

Add backward-compatible canonical records, statuses, reason codes, and audit structures. Existing customer flows continue using current reads.

### Stage 2: Backfill and shadow reconciliation

Build proposed canonical links without changing customer-visible ownership or impact. Compare:

- Existing orders versus canonical purchases
- Existing registrations versus canonical registrations
- Existing impact totals versus ledger projections
- Existing customer history versus canonical history

Ambiguous records enter staff review.

### Stage 3: Dual write

Current writes continue while new canonical records are written idempotently. Monitoring compares both systems.

### Stage 4: Staff preview

ProjectHub mission control and review queues become available to authorized staff. Customer reads remain unchanged.

### Stage 5: Selected customer rollout

Enable canonical reads and legacy review for selected internal and legacy accounts.

### Stage 6: All authenticated customers

Enable registration, history, impact, sharing, and nearby-location behavior for all signed-in customers.

### Stage 7: Global totals

Switch global impact to canonical eligible ledger entries only after shadow totals reconcile within the approved tolerance and all exceptions are reviewed.

### Rollback

Feature flags must independently disable:

- Canonical reads
- Dual writes
- Legacy-review submission
- New global-impact projection
- Nearby distance-tier filtering

Rollback disables new behavior without deleting migrated records or reducing historical counts.

## 11. Security and authorization

- All customer-owned endpoints derive customer identity from a verified session, not request-body IDs.
- Sensitive ProjectHub endpoints re-check live team authority.
- Review evidence uses approved object storage paths and authoritative metadata checks.
- Receipt and evidence uploads enforce type, size, path, and ownership restrictions.
- Idempotency keys protect registration, approval, reconciliation, and impact writes.
- Staff corrections require explicit reasons.
- Public responses exclude personal identity and evidence.
- Rate limits apply to registration lookup, legacy submission, evidence upload, referral attribution, and location queries.

## 12. Testing strategy

### Unit tests

- Identity normalization and conflict detection
- Purchase matching precedence
- Duplicate purchase-line prevention
- Registration state transitions
- Maintenance-count preservation
- Impact eligibility and compensating entries
- Haversine distance and 2/5/10 km boundaries
- Analytics allowlist and privacy exclusions

### API tests

- Old and new authenticated account registration
- WooCommerce and Companion purchase matching
- Pending legacy review, approval, rejection, and correction
- Duplicate receipt/order/serial handling
- Customer ownership isolation
- Receipt/history consistency
- Personal/global impact reconciliation
- Live administrator re-checks
- Idempotent retries and concurrent writes

### UI tests

- Companion matched registration
- Companion unmatched legacy submission
- Legacy local-data migration
- Complete filter and order history
- ProjectHub review and reconciliation queues
- Share My Impact hierarchy and Join us placement
- Referral code preservation
- Location permission states and tier expansion
- Open-map removal of closed/unverified locations

### Migration tests

- Existing records backfill without loss
- Maintenance counts never decrease
- App/WooCommerce duplicates collapse without duplicate impact
- Ambiguous ownership remains unresolved
- Rollback flags preserve prior reads

## 13. Release gates

The global rollout cannot proceed until:

1. Every valid signed-in customer type can reach registration.
2. No existing customer loses a registration or maintenance count.
3. One purchase line cannot create duplicate verified impact.
4. Companion, ProjectHub, receipts, and order history agree.
5. Pending legacy registrations are excluded from public impact.
6. Exact customer coordinates are absent from storage, logs, and analytics.
7. Backfill exceptions are visible in mission control.
8. Required alerts are active.
9. Focused tests and typechecks pass.
10. Rollback controls are verified.

## 14. Execution decomposition

The detailed implementation plan should use ordered, independently verifiable workstreams:

1. Baseline reconciliation and invariants
2. Canonical schema and migrations
3. Identity and purchase reconciliation
4. Registration and lifecycle ledger
5. Companion migration, registration, and history
6. ProjectHub review and mission control
7. Impact projection and Share My Impact
8. Nearby-location distance tiers
9. Observability, alerts, and audit timelines
10. Backfill, shadow validation, and progressive rollout

Shared schema and API-contract changes must land before dependent client work. Independent UI work may proceed in parallel only after contracts are stable.