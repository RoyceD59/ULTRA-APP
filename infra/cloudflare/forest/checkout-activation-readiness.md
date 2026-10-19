# Checkout and activation candidate — not published

## Scope and release boundary

The contact, checkout visibility, activation-unit and shared status changes are
in current workspace source. Prepare a separate candidate with:

```sh
node artifacts/uc-companion/scripts/prepare-checkout-activation.mjs
```

This writes `.checkout-activation-release/` (ignored): Companion browser and
iOS/Android Expo Go bundles/manifests, ProjectHub browser output, API bundle,
and `evidence.json` with source hashes and the candidate build ID.

It does **not** replace the approved frozen archive, alter the original
Companion active-build pointer, publish, change hosting, or enable lifecycle
rollout flags. The candidate uses development preview endpoints. It is a
current-workspace candidate, not an approved patch transplanted onto the frozen
release. Approval/integration into that release is a separate operation.

The existing frozen archive was checksum-checked against its release manifest.
Its Home source still includes the earlier static water status icon; current
source alone cannot establish what a production visitor sees.

Apply the declarative database changes through the managed schema rollout when
this candidate is eventually adopted. Development received the scoped additive
contact/unit migration. No production database mutation was performed for this
task. An additive retirement table is declared for schema rollout and ensured
idempotently at API startup; it records no financial order or contact data.

## Diagnosed order boundary

ProjectHub reads durable local orders. Its date/status/recovery filters can
hide rows; the refreshed page reports hidden rows and separately labels payment
evidence and synchronization. Pending payment, unsynchronized accepted orders
and ambiguous remote attempts are not represented as verified payment.

The concrete Companion history defect was the Woo-enabled projection: it
included assigned local-only purchases but omitted ordinary local-only
checkout records. It now includes every owned local-only record, while keeping
Woo mirrors singular and preserving transaction contact/fulfillment details.
This is not evidence of a missing Woo webhook.

A read-only, last-30-days development diagnostic found two confirmed COD
checkouts with store IDs and missing contact fields. There was no evidence for
an address to insert. Those rows were not changed. No reported production order
references were provided, so this does not diagnose a specific live customer's
missing order.

Staff can download a read-only diagnostic report for the first 100 visible
local order IDs in ProjectHub, or use:

```text
GET /api/uc/admin/orders/reconciliation-report?ids=<explicit-local-ids>
```

This requires a live administrator and does not call providers, repair orders,
infer ownership/payment, or disclose guessed contact details.

Existing retry healing is deliberately narrow: an uncertain Woo creation is
not replayed. Reconciliation requires one exact checkout claim, matching
account metadata, payment reference, total/currency, method and product
quantities, and no failed/cancelled/refunded remote state. Missing, duplicate or
contradictory evidence remains discoverable for staff review.

## Customer and lifecycle behavior

- Required phone/address completion edits the existing account; login,
  informational reads and anonymous instant assessments remain available.
- Anonymous checkout remains supported with a separate device-local recovery
  namespace. Signing in does not transfer its intent or purchase to an account.
- Collection uses an editable **contact address**, not a delivery destination.
  Checkout, service and physical-test APIs enforce contact requirements too.
- Server-owned eligibility distinguishes payment from acceptance/fulfillment.
  Accepted COD may be installed without being represented as cash collected.
  Store refunds remove mirrored activation offers and are rechecked on commit.
- Linked offline contracts are reused, not replaced. App/store units use
  authoritative line identities. Installation is explicit and date-confirmed;
  owning a product does not start its lifespan.
- Registering another unit does not replace the current device cycle. Older
  ambiguous registrations require staff review rather than guessed remaining
  quantities or ownership transfer.
- Home and Account share account-scoped cycle/usage calculation. Recorded
  litres are not sensor measurements; unavailable usage stays unknown/time-only.
  No reminder timing, opt-ins, cleaning history or hydration policy was changed.

## Verification evidence and limits

- Full-suite compatibility: account/order/service/physical-test fixtures now supply
  required contact details while negative tests retain rejection coverage. Modern
  M-Pesa initialization uses an isolated server-priced cart, rejects mismatched
  callback money, then confirms the same reserved order on matching evidence.
  Payment rate limiting runs before modern preparation exactly once; scenario
  fixtures use isolated test-only proxy/IP allowances rather than bypassing limits.
- Invalid supplied credentials cannot silently become anonymous initialization,
  confirmation or cancellation. The new signed-session regression asserts no
  financial order is created by those rejected requests.
- Latest recovery component verification: **10 tests passed**, including rendered
  reload/resolution/correction transitions and contact length errors.

- Recovery completion fixes: **36 targeted API tests passed** across consistency,
  cancellation/benefits and receipt email fixtures. Server-owned recovery status
  retains ambiguous outcomes; explicit safe cancellation prevents delayed retired
  requests from starting. Confirmed receipts can be retired locally without
  replaying order/payment writes.
- Rendered component tests drive saved review → reload → unresolved refusal →
  server completion → new checkout, and definitive rejection → reload → authorized
  retirement → editable correction → successful new intent. Oversized addresses
  are rejected before freezing. These are component tests with controlled API
  responses, not physical-device or live-provider evidence.

- Completion-check fixes: **36 targeted API tests passed**, including anonymous
  confirmation/same-key retry and repeated order-detail fetches for reconciliation
  and uncollected processing COD. Detail responses use the same payment/sync
  evidence as history/admin responses and retain customer-stage fulfillment.
  Contact/checkout fixtures now satisfy required preconditions before testing
  provider outages or persistence failures; the validation rules were not weakened.
- Guest readiness/recovery and account separation passed the **7-test recovery
  suite**. These helper/API tests are not rendered guest-browser observations.

- Broad isolated API pass: **87 tests**, including checkout retry/concurrency,
  ambiguous synchronization, contact validation, unit registration,
  COD/order-state and linked assignment regressions.
- Final directly affected contact/COD pass: **37 tests** after tightening the
  legacy checkout profile gate.
- Client candidate/tracker/life regressions: **34 passed**.
- Build metadata/Metro-port/static delivery regressions: **19 passed**.
- Shared libraries and all three app TypeScript checks passed.
- Preparation verifies complete candidate web/native entries and preserves the
  original active selection; native compilation is not physical-phone evidence.
- The prepared browser pass uses an isolated test database and provider stubs;
  its observations must be kept distinct from real payment/provider behavior.
  It verified required-contact registration/completion, normalized phone storage,
  collection contact details, singular local/admin order visibility on retry,
  two separately date-confirmed units, retained cycle/history and account switching.
  Water-test contact prefill was observed, not submission; payment providers and
  refund transitions were covered by isolated API tests, not browser payments.
  A missing immediate browser reconciliation notice was subsequently corrected
  with rendered feedback and a saved-order link. Account-scoped checkout recovery
  now saves the original identity/input before any payment or order request.
  Additional checkout recovery regressions cover reload, account separation,
  retained review receipts and corrupt/unavailable storage.
  The final recovery/identity pass has **7 passing tests**, including clearing
  private payment/promotion drafts and retiring old-account quote responses.
  A confirmed checkout clears its frozen identity/quote before a new purchase.
  A direct isolated API probe observed a saved-review 202, a same-key 202 retry,
  one customer-history representation with the explicit remote-total-mismatch
  state, and one mocked Woo creation. History uses a Woo ID alias; the review
  receipt uses the local ID. These are not two financial orders.
  Final browser review-notice/reload observation was blocked by fixture setup,
  not established as passing. Its behavior is covered by recovery regressions
  and the API evidence above; the earlier ordinary checkout/admin browser
  observations remain separate. No further full browser pass was run.

A separately attempted analytics wiring check failed its existing Alison
reply-source pattern assertion, unrelated to checkout. That assertion/source
was not changed as part of this task.

No physical phone, production sign-in/payment or production publication was
performed. A production defect cannot be declared fixed solely from these
source, fixture and prepared-package checks.