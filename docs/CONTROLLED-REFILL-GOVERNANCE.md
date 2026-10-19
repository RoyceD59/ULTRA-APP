# Controlled refill governance preview

This is the first operational slice of the recurring business model in the implementation handoff. It records pilot station decisions, team-member station assignments, and versioned promotional campaign terms. It does **not** grant refill volume, charge a customer, change a reward balance, create a subscription, or authorize a dispenser. The existing `uc_users.id`, rewards ledger, orders, payments, impact and QR flows remain their authorities.

## Rollout boundary

The governance preview is off by default and is controlled by a persisted admin setting:

| Setting | Surface | Effect |
| --- | --- | --- |
| `refillGovernance` | ProjectHub → Admin → Care & Refill Activation | Saves the API gate in the database. The station/campaign review link appears after a successful activation. All mutations are audit/definition records only. |

The public `/api/uc/refill/capabilities` response continues to return `promoRefill: false`, `paidRefill: false`, `moneyWallet: false`, `paidCare: false` and `automaticCollection: false`, even with the governance switch on. Leave the switch off until migration and rollout checks are complete. The former `UC_REFILL_GOVERNANCE_PREVIEW` and `VITE_UC_REFILL_GOVERNANCE_PREVIEW` environment flags do not activate this gate; no rebuild is needed to change it.

## Installation and recovery

1. Back up the intended database and verify that `team_users` and `uc_locations` match the deployed application schema.
2. Verify `lib/db/migrations/0054_uc_refill_governance.sql` and `0055_refill_preview_flags.sql` have been applied. The API startup path includes equivalent idempotent guards. These add governance tables, append-only triggers and off-by-default settings; they do not backfill or mutate existing customer records.
3. Verify table/trigger creation and that governance endpoints return 404 while the switch remains off. Then activate governance in ProjectHub for a restricted team pilot.
4. To stop the pilot, deactivate governance in ProjectHub. The next API operation checks the persisted gate and returns 404. Preserve the audit tables. Do not delete them or revert approved version rows; a new version or a suspension event is the correction path.

The team administrator is checked against the **live** `team_users` row within every transaction; a token's role claim is insufficient. Only a different administrator can review a campaign version or re-enable a suspended station. Station assignments are linked to a specific enable event: suspension immediately removes scope, and re-enabling requires new grants. Location `active` and `verified` status and the operator's current team status are checked again on reads. All responses are `no-store`. The operator endpoint returns `mayDispense: false` and has no dispense or redemption route.

An approved campaign record means independent **review of a proposed rule**, not activation. Its scenario must have all five cost inputs and nonnegative per-grant sponsor-funded contribution; the rule can still be suspended. A new version is required to change terms. The preview stores no sponsor cash receipt, budget reserve, grant, wallet balance or customer quote, so review cannot prove funding availability.

## Verification

The `Refill governance checks` workflow uses a dedicated PostgreSQL 16 service and the API's isolated test harness. The harness creates and drops a fresh `test_api_*` database, pushes the full schema and applies additive migrations before running the feature/governance integration suites. The suites refuse database names outside that harness pattern; they must not be run directly against an application database. The governance test applies migration 0054 twice to exercise repeatability, then checks live role enforcement, station verification, maker-checker review, version immutability, assignment revocation, and the stale-grant/re-enable case. The feature test checks persisted activation, independent partial updates and hard-off payment capabilities. Typechecks cover the API, shared packages, and Hub. Prior external GitHub results apply to the imported revision, not subsequent Replit adaptations; a new GitHub run is required before promoting these changes.

Before any customer-facing refill pilot, the remaining gates in `CONTROLLED-REFILL-DISCOVERY.md` must be implemented and independently verified: eligibility event identity, sponsor cash reconciliation, atomic credit lots and budget holds, customer-approved quote and short-lived authorization, one-time fulfillment and reversals, quality clearance evidence, outbox/inbox recovery, device rehearsal and reconciliation. Promo credits must never count as MRR. Paid refill, wallet and care must remain disabled until their separate payment, accounting and consent gates pass.