# Controlled refill: discovery and foundation

29 September 2026. Source candidate: GitHub `fd077af`, corresponding to the
Companion patch checked against Replit's `70d51fa` base. This is a source
inventory, not evidence that every deployment has the same settings/data.

The implementation follows `Ultra_Clear_Codex_Implementation_Handoff.md`.
The ZIP was studied for commercial intent only. Its subscription patch and
test prices were not imported. Replacement purchases, optional care,
usage-led refill and business service are different economic flows. A second
economic event is a useful lifecycle metric; it is not automatically MRR.

## Current dependency map and adaptation register

All paths below are relative to this repository.

| ID | Verified source and symbols | Ownership / current boundary |
| --- | --- | --- |
| AD01 | `artifacts/api-server/src/lib/account-records.ts`: `recordAccountRegistration`, `recoverUnsyncedRegistrations`; `lib/customer-identity-resolution.ts`: `resolveCustomerIdentity`, `resolveAndCreateCustomerIdentity` | `uc_users.id` is the existing registered customer identity. Folder backups support recovery, not a second balance authority. Email/phone matching is candidate resolution, not permission to link an account. |
| AD02 | `artifacts/api-server/src/routes/uc-rewards.ts`: `authenticatedCustomer`, `resolveCustomer`, customer/admin rewards routes | Points are stored in `uc_rewards_ledger`; balances are SUM(points). Multiple direct writers exist. Existing customer redemption uses a database transaction and customer advisory lock; it does not create a refill-credit lot. |
| AD03 | `artifacts/api-server/src/lib/reward-promotions.ts`: `quotePromotion`, `consumePromotionOnClient`; promotion CRUD in `routes/uc-rewards.ts` | Existing promotion rows can be edited in place. Uses are unique by customer/idempotency key, not by campaign/eligibility event. They cannot yet authorize the controlled refill pilot. |
| AD04 | `artifacts/uc-companion/lib/rewardsQr.ts`: `buildRewardsQrPayload` | Preserve the existing `uc-rewards:v1:` opaque token format. |
| AD05 | `artifacts/uc-companion/lib/rewardsQrResolution.ts`; `hooks/useRewardsQrToken.ts` | Existing token resolution/refresh flow; no transaction-specific customer approval contract found. |
| AD06 | `artifacts/uc-companion/lib/rewardsQrStorage.ts` | Existing customer-scoped token persistence. Reuse it; do not store economic values in QR. |
| AD07 | `artifacts/projecthub/src/lib/qr-scanner-controller.ts`: `QrScannerController` | Camera lifecycle and retry controller. Scanning is currently an admin rewards workflow, not station-scoped vendor authorization. |
| AD08 | `artifacts/projecthub/src/pages/admin/rewards.tsx` | Existing grants, redemption and admin scanner; keep existing behavior. Operators need a separate scoped permission under the existing team identity before using a refill workflow. |
| AD09 | `artifacts/api-server/src/routes/payments.ts`: `/payments/mpesa`, `/payments/mpesa/status/:checkoutRequestId`, `/payments/mpesa/callback`, provider webhook/verification routes | Reuse stored initiation references and existing provider verification. No new payment adapter or recurring collection has been added. Existing recovery orders sometimes use phone/string references; these are not a safe refill account linkage. Amount/payee/late-success and event dedup need dedicated evidence for the paid phase. |
| AD10 | `artifacts/api-server/src/routes/uc-impact.ts`; `routes/uc-rewards.ts`: `personalImpact`, `addWaterEntry` | Existing registered-filter usage lives in `uc_water_impact_ledger`, with whole-litre capacity checks. It is not prepaid refill credit or vendor inventory. Do not treat theoretical capacity or promotional grant as fulfilled impact. |
| AD11 | `artifacts/api-server/src/lib/jwt.ts`: `verifyToken`; `lib/adminAuth.ts`: `requireAdmin`, `isAdminRequest`; `lib/uc-deleted-guard.ts`: `rejectDeletedUcAccounts`; `routes/auth.ts`: `requireTeamAuth` | Existing team/customer sessions; live team role checks. Central UC guard rejects erased accounts and stale credential versions. Preserve temporary-password restrictions. |
| AD12 | `lib/db/src/index.ts`; `lib/db/src/schema/uc-rewards-ledger.ts`, `uc-promotions.ts`, `uc-users.ts`; `lib/db/migrations/0001…0053`; `artifacts/api-server/src/index.ts`: `applyStartupMigrations` | One PostgreSQL pool from DATABASE_URL. Several journals and startup DDL exist; no generic unit-aware posting service was found. This foundation adds no tables, migrations, backfill or opening balances. |
| AD13 | `artifacts/api-server/src/routes/uc.ts`: server-priced order creation and `serverPricedLines`; `lib/canonical-purchase-dual-write.ts`: `reconcileCanonicalPurchaseDualWrite`; `lib/canonical-purchase-reconciliation.ts` | Legacy orders are current canonical operational inputs. Lifecycle purchase reconciliation is separately flag-controlled. Preserve catalogue prices and existing order IDs. |
| AD14 | Hub reads existing API; `artifacts/api-server/src/routes/referrals.ts`: `enqueueReferralSettlement`, `processPendingReferralSettlements`; `lib/lead-delivery.ts`; referral and lead outbox migrations 0035/0041 | Domain-specific outboxes exist. No general refill outbox/inbox with event and aggregate-version uniqueness was found. The dashboard is a projection, never a balance writer. |
| AD15 | `routes/uc-rewards.ts`: reward conversion and promotion configuration; `routes/admin-payment-settings.ts`; encrypted `team_settings` reads in `routes/payments.ts` through `lib/secret-crypto.ts` | Existing admin settings. Immutable approved refill rule/campaign versions and maker-checker activation are missing. Prices in the ZIP are unapproved scenario values. |
| AD16 | `routes/uc.ts`: `DELETE /uc/customer`; `lib/account-records.ts` recovery; `lib/uc-deleted-guard.ts`; identity-resolution conflict classifications | Erasure anonymizes existing operational history. Recovery is evidence-based. No automatic customer merge is added. Future lots must reference the same uc_users.id and preserve required audit history without embedded PII. |
| AD17 | `lib/db/src/schema/team-users.ts`: admin/member + page permissions; `uc-locations.ts`: location/vendor metadata | No verified actor-to-station assignment, operator grants, quality suspension or dispute decision authority exists. A public location's vendorName does not grant access. **Pilot posting is blocked.** |
| AD18 | `artifacts/api-server/src/lib/customer-lifecycle-flags.ts`; new `lib/refill-readiness.ts`; Companion `hooks/useCareOverview.ts` | Existing lifecycle switches preserved. New care overview needs both server and client opt-in. All economic operations are unavailable in this foundation, even if an environment sets an unsupported future phase switch. |

## Existing writer inventory

| Balance / state | Writers and consumers | Pilot consequence |
| --- | --- | --- |
| Points | Customer/admin redemption and grant routes in `routes/uc-rewards.ts`; `lib/reminder-dispatch.ts`: `creditReplacementPoints`, `creditQualifyingProductPoints`; `routes/referrals.ts`: referral settlement points inserts | Preserve the existing ledger. Before conversion, route all debits/reservations through one transaction-owned posting boundary with stable account/resource locks. Ordinary awards remain additive. |
| Promotion usage | `reward-promotions.ts` and staff transactions in `uc-rewards.ts` | Add business uniqueness for campaign/account/eligibility event. A fresh request key must not create another grant. |
| Filter impact | `addWaterEntry` in `uc-rewards.ts` and current impact routes/projections | Never debit volume credit or vendor water by writing impact. New fulfilled refill events need one qualified impact projection with correction references. |
| Orders / payments | `routes/uc.ts`, `routes/payments.ts`, `routes/order-status-webhook.ts`, canonical reconciliation and referral outbox | Preserve current adapters and reconciliation. Paid care/wallet activation must not be bolted onto a browser redirect or phone-keyed recovery order. |
| Refill credit / vendor funding / campaign budget / holds | No equivalent authority found | Distinct volume subjournals are needed under the shared posting design. No opening balance may be inferred from existing rewards or filter capacity. |

Account flow: existing login yields a UC session → central deletion/credential
guard → DB-anchored customer route → account-scoped rewards/impact/QR → Hub
admin QR resolution through existing API → rewards transaction. Orders use
the existing operational order/payment path and optional canonical dual-write.
Hub reads the same backend. Source inspection does not establish equality of
production/dev DATABASE_URL settings or instantaneous cross-device sync.

## Foundation delivered

- Public, no-store capability contract with no credentials/customer data.
- Optional free-member care overview links to current filter care, rewards,
  locations and support; it uses the existing account-scoped rewards query.
  The six-tab navigation and account lifecycle remain intact.
- Admin-only readiness endpoint and responsive Hub cost preview. No rule,
  balance, payment or campaign is saved from the simulator.
- Integer mL and KES minor-unit contracts, exact BigInt arithmetic, documented
  rounding and overflow rejection. Missing material costs block contribution
  calculation; negative contribution remains visible. Promotional MRR is zero.
- Unsupported transaction endpoints stay absent. An environment switch cannot
  bypass the missing posting, funding, confirmation or station-access controls.

## Phase flags and recovery

| Switch | Default | Effect |
| --- | --- | --- |
| `careOverview` in ProjectHub Admin → Care & Refill Activation | false | Persisted API permission advertises the existing free-member overview; Companion checks this permission on mount/focus. |
| `refillGovernance` in the same admin panel | false | Enables admin station/campaign review only; see CONTROLLED-REFILL-GOVERNANCE.md. |
| Promo refill / paid refill / money wallet / paid care / automatic collection | unavailable | No enabling switch or mutation routes in this foundation. Implement and prove the appropriate phase before exposing one. |

Keep both preview settings off until the intended rollout is approved. To remove
Care Overview, deactivate it in the admin panel; focused/refreshed clients hide
it, and the page fails closed on missing or invalid capabilities. The former
`UC_CARE_OVERVIEW_PREVIEW` and `EXPO_PUBLIC_UC_CARE_OVERVIEW_PREVIEW` environment
flags are no longer required and cannot override the persisted setting.
An immediate hard kill for a future economic flow must be checked on every
server operation. These previews have no financial operations to compensate.
Rollback should preserve the additive governance/setting schema and audit data;
it must not delete customer data or rewrite balances.
## Next mutation-heavy change and acceptance

Design review must establish the shared PostgreSQL posting boundary, stable
lock order, actor/station assignments, campaign eligibility events, trusted
customer confirmation/delivery evidence, unit subjournal ownership and an
outbox/inbox contract. Use expand/backfill/verify; inspect production migration
history and take an approved backup before applying a migration. Dry-run zero
opening lots for new accounts; reconcile existing points without rewriting them.

Promotional pilot acceptance requires business uniqueness across fresh keys,
payload-conflict rejection, grant/conversion/funding/budget concurrency,
nonnegative available balances, bounded partial fulfilment, one fulfilment
effect, hold release, referenced reversals, pending restart recovery, quality
suspension, operator station denial, customer quote approval and maker-checker
activation. Test against an isolated PostgreSQL database, never the customer
database. The current API test runner provisions a separate database but also
drops stale test databases; inspect/approve its environment before invoking it.

The paid phases additionally require verified provider amount/currency/payee,
durable provider-event uniqueness, short-lived intents tied to canonical
account/order/quote/station, monotonic transitions and late-success/refund
reconciliation. Keep existing callbacks/recovery operational when purchases
are disabled. Ratiba is not assumed to be supported.

UX states for the transactional phase: eligible station → server quote with
separately labelled points/refill credit/cash → customer confirmation → pending
reservation → authorized dispense → acknowledged partial/full receipt → dispute
or recovery. Never show a success balance until authoritative status is known.
Keep the operation key across taps/restarts. Use the existing scanner controller
for camera denial/manual retry and test screen readers, large text, slow network,
background/resume and revoked sessions. UI approval cannot enable money flows.

## Metric dictionary for subsequent phases

| Metric | Source / rule | Current status |
| --- | --- | --- |
| Second economic event rate | Distinct account, second verified paid/fulfilled qualifying event; defined cohort/window | Not calculated by this foundation. |
| Promo attempts / denied / fulfilled / disputed / reversed | Versioned authorization/fulfilment/dispute events, per station/campaign/rule | Events not yet implemented. |
| Available / reserved / consumed credit and vendor mL | Unit-specific immutable journals and reservation projection | Posting foundation required. |
| Budget committed / consumed | Funding lots and holds, not editable dashboard totals | Posting foundation required. |
| Wallet liability | Verified top-ups less approved consumption/refunds; top-ups are not refill revenue | Paid phase disabled. |
| Contracted MRR / paid care pause / reactivation | Verified collections + approved recognition policy; pause is not churn | Paid phase disabled; no sample revenue displayed. |
| Fulfilled impact | Qualified fulfilment volume with unique event and approved corrections/methodology | Existing impact preserved; no new health/carbon/plastic claims. |
| Sync freshness / failed close / invariant failure | Outbox age, aggregate-version mismatch and reconciliation cases | Future alerts need the durable posting/event boundary. |

Dashboard queries must carry source lineage, observation timestamp and
cohort/rule filters, and remain read-only. Unknown metrics stay unavailable.
