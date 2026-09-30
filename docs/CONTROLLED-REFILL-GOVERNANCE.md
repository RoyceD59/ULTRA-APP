# Controlled refill governance preview

This is the first operational slice of the recurring business model in the implementation handoff. It records pilot station decisions, team-member station assignments, and versioned promotional campaign terms. It does **not** grant refill volume, charge a customer, change a reward balance, create a subscription, or authorize a dispenser. The existing `uc_users.id`, rewards ledger, orders, payments, impact and QR flows remain their authorities.

## Rollout boundary

Both flags are off by default:

| Flag | Surface | Effect |
| --- | --- | --- |
| `UC_REFILL_GOVERNANCE_PREVIEW=true` | API | Team-session-only governance endpoints appear. All mutations are audit/definition records only. |
| `VITE_UC_REFILL_GOVERNANCE_PREVIEW=true` | Project Hub build | Admins see a link from Care and Refill Readiness to station and campaign review. |

The public `/api/uc/refill/capabilities` response continues to return `promoRefill: false`, `paidRefill: false`, `moneyWallet: false`, `paidCare: false` and `automaticCollection: false`, even with the governance flag on. Leave the API flag off until migration and rollout checks are complete. A Hub build flag alone cannot enable API operations.

## Installation and recovery

1. Back up the intended database and verify that `team_users` and `uc_locations` match the deployed application schema.
2. Apply `lib/db/migrations/0054_uc_refill_governance.sql` to that database before switching on the API preview flag. This adds four tables and append-only triggers; it does not backfill or mutate existing customer records.
3. Verify table/trigger creation and that all endpoints return 404 while the API flag remains off. Then enable the API flag for a restricted team pilot, followed by the Hub build flag.
4. To stop the pilot, turn off the API flag. Preserve the audit tables. Do not delete them or revert approved version rows; a new version or a suspension event is the correction path.

The team administrator is checked against the **live** `team_users` row within every transaction; a token's role claim is insufficient. Only a different administrator can review a campaign version or re-enable a suspended station. Station assignments are linked to a specific enable event: suspension immediately removes scope, and re-enabling requires new grants. Location `active` and `verified` status and the operator's current team status are checked again on reads. All responses are `no-store`. The operator endpoint returns `mayDispense: false` and has no dispense or redemption route.

An approved campaign record means independent **review of a proposed rule**, not activation. Its scenario must have all five cost inputs and nonnegative per-grant sponsor-funded contribution; the rule can still be suspended. A new version is required to change terms. The preview stores no sponsor cash receipt, budget reserve, grant, wallet balance or customer quote, so review cannot prove funding availability.

## Verification

The `Refill governance checks` GitHub Action uses a dedicated PostgreSQL 16 service. Its integration test refuses any database URL except a local database named `refill_governance_test` with `REFILL_TEST_DB=1`. It applies the migration twice to exercise repeatability, then checks live role enforcement, station verification, maker-checker review, version immutability, assignment revocation, and the stale-grant/re-enable case. Typechecks cover the API, shared packages, and Hub.

Before any customer-facing refill pilot, the remaining gates in `CONTROLLED-REFILL-DISCOVERY.md` must be implemented and independently verified: eligibility event identity, sponsor cash reconciliation, atomic credit lots and budget holds, customer-approved quote and short-lived authorization, one-time fulfillment and reversals, quality clearance evidence, outbox/inbox recovery, device rehearsal and reconciliation. Promo credits must never count as MRR. Paid refill, wallet and care must remain disabled until their separate payment, accounting and consent gates pass.
