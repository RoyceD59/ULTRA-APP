# Saved-order guest payment — development and release readiness

## Delivered source scope

“Ask someone to pay” adds the selected variant to the existing cart and opens
buyer checkout in payment-sharing mode. Normal contact/address, fulfillment,
delivery charges, promotions and referral reservation rules still apply.
The authenticated buyer saves a server-priced pending order before receiving
a link. It is not a paid order, fulfillment approval or transfer of ownership.
Account-scoped checkout recovery persists the original intent before issuance;
retry-safe issuance returns the same unstarted order and link after reload.

The capability is a 256-bit domain-separated cryptographic PRF of a random
256-bit generation, bound to the original checkout claim. Only its SHA-256 hash
is stored as a usable verifier, never the raw bearer. Links expire in 72 hours.
Cancellation/retirement keeps the existing verification barrier: ambiguous
attempts cannot be cancelled/released or changed into a second charge.

Signed-out summaries are explicit allowlists: items, saved SKU/size/variant,
quantity and totals, fulfillment, town/area and first name. No full address,
surname, email, phone, account id, checkout input or benefit claim is returned.
The payer cannot edit the order. Only required Paystack email/M-Pesa phone is
collected locally; Stripe and card data stay on the hosted provider.
Bearer links are deliberately shared; WhatsApp encodes the complete saved-order
message once and copy remains plain text.

The isolated `/pay/{token}` document has generic metadata, noindex/noarchive,
private/no-store caching, no-referrer and restrictive CSP. It does not load the
authenticated Expo shell, public metadata renderer or normal analytics.
The URL is scrubbed to `/pay` before requests/resources; the capability remains
only in that tab's session storage for provider returns and reload. Guest calls
are POST bodies with omitted credentials; the proxy forwards no cookies,
authorization, referrer, checkout edits or caller-supplied amount.
No pay route is added to the public sitemap.

Guest rate limits are keyed only by the server-resolved immutable order, never
caller-supplied IP headers: 60 status checks/minute and a separate 6
initialization attempts/minute per order. Unknown links have a separate
120/minute peer/IP budget that cannot block valid capabilities. No forwarding
of untrusted client-identity headers was introduced, and normal buyer/payment
limits remain unchanged.

Buyer and guest initialization share the original order's durable attempt CAS,
provider reference and benefit reservations. Live exact variation stock and
authoritative pricing are checked before any provider request. Reserved
promotion expiry is not mistaken for reservation release. Stale evidence
requires buyer cancellation/refresh and explicit acceptance of a new quote.
Payers cannot approve changed totals or substitute variants.

Unknown outcomes are reconciliation-only. Paystack's reference is persisted
before initialization; M-Pesa retains a hashed per-attempt callback binding
before sending an STK push; Stripe uses order/attempt metadata plus a fixed
provider idempotency key and can recover a lost session response. Reconciliation
never creates a new charge. Known hosted sessions can be resumed rather than
reinitialized. Signed Paystack and Stripe confirmations and independently
verified M-Pesa callbacks converge on the original order and the existing
fulfillment/promotion/referral/canonical-purchase pipeline. Amount, currency,
reference and attempt binding must match before the verified transition.

Once a guest-linked attempt has started, even a “failed”/“abandoned” provider
response does not automatically authorize cancellation, benefit release or a
new charge: a previously shared hosted session may remain usable. These attempts
show a payment-review state and remain held for reconciliation/confirmed
permanent voiding. Unstarted stale orders can still be retired normally.
Link expiry removes summary access as well as initialization, including for
previously paid orders; expiry never resets the durable attempt.

Payers receive only a verified confirmation page. Existing buyer push, email and configured SMS
receipts are queued once for guest-paid orders; no new payer account or
unnecessary stored payer contacts are introduced. Guest receipts preserve the existing
channels with redacted transport diagnostics, not an additional channel or silent
legacy-email fallback. The existing notification
log/monitor records email failures; queue failures also have fixed diagnostics
and an order snapshot marker, surfaced in the existing staff read-only checkout
diagnostics download as receipt dispatch/review flags. “Queued” is not proof of
delivery. They never cause another payment or invented
confirmation.

## Configuration — not activated by this work

- API: `UC_GUEST_PAY_PUBLIC_ORIGIN` must be the explicitly approved HTTPS public
  origin, with no path/query/credentials. Existing
  `PUBLIC_WEB_CANONICAL_ORIGIN` is a compatible explicit fallback. It is not
  guessed from a request host or development domain.
- Companion server: `UC_GUEST_PAY_API_ORIGIN` or existing
  `PUBLIC_WEB_API_ORIGIN` supplies the fixed API origin for the same-origin
  guest proxy. `BASE_PATH` is supported for the artifact preview; production
  public browser routes remain `/pay/...`.
- Provider availability follows the existing credentials and Stripe enabled
  flag. COD is not a guest online method. Missing/unavailable providers fail
  closed. Simulation requires explicit development/test; production and unknown
  environments do not simulate.
- Stripe signed confirmation additionally requires its provider-issued
  `STRIPE_WEBHOOK_SECRET` to be provisioned through workspace Secrets and a
  provider sandbox endpoint configured. Missing configuration rejects unsigned
  confirmation; server-side session verification remains available.
- Product-event collection follows the existing explicit
  `EXPO_PUBLIC_PRODUCT_GA_ENABLED` and measurement id. The private page does not
  infer collector readiness from an unrelated global or load any tracker by
  default. A separate explicit `UC_GUEST_PAY_ANALYTICS_BOOTSTRAP_APPROVED=true`
  is needed to bootstrap the already approved Google product collector on this
  otherwise isolated document. This work sets none of these flags. It does not
  replace or activate the separate Companion Umami collector.
- Privacy-filtered share/open/begin-checkout and verified paid/purchase events
  contain no bearer, tokenized URL, contact data or benefit identifiers. Paid
  events are offered once through durable link bookkeeping only after verified
  confirmation, not a client success screen. Collection loss never retries a
  payment; collector ingestion still requires external evidence.

## Automated evidence

2026-10-07, local development code:

- `pnpm run typecheck:libs` — passed.
- API and Companion `pnpm exec tsc --noEmit` — passed.
- Isolated `guest-pay.test.ts` — 13 scenarios: actual proxy-to-API multi-payer
  polling/initialization and bounded invalid-link abuse with no synthetic
  forwarded IPs; auth/ownership, one hashed link,
  privacy/variant identity, expiry/cancellation, stale price/stock, buyer/guest
  concurrency, Paystack unknown outcomes, exact amount/currency binding,
  confirmation queue failure, signed duplicate callbacks, reserved benefits,
  lost M-Pesa callback responses, Stripe metadata reconciliation/signed
  confirmations and unchanged COD preparation.
- Existing `reliable-checkout-benefits.test.ts` — 16 scenarios passed, including
  unchanged ordinary checkout, promotion reservation and Woo reconciliation.
- `guest-pay-document.test.mjs` — private headers/markup, script syntax and
  credential-free allowlisted proxy assertions passed.
- Managed API startup and Metro preview are running. Metro emitted existing
  native DevTools shared-library and create-launch state-file warnings; these
  are not provider/device evidence.

## Responsive browser evidence

The original browser check was blocked by unavailable live merchant variation
mapping. The approved read-only local catalogue fixture then established valid
parent/child SKU operation responses; a foreground-process lifetime failure
initially blocked its use from the browser. After starting that same fixture as
a persistent test process, the existing tester resumed only the blocked flow:

- Actual development API save from signed-in buyer checkout, Pink Truva Go
  variation/SKU, KES 3,199 plus existing KES 500 delivery: pending order,
  unstarted payment, no provider/Woo/confirmation reference. The plain-text copy
  contained saved identity/total and the deliberate bearer warning.
- Reload and re-save returned the same order and capability. A scoped DB check
  confirmed one order and one active hashed link, no payment attempt.
- Actual signed-out summary and document omitted surname/address/phone/email;
  no account, COD or editing controls. Guest POSTs had no cookie, authorization
  or referrer, URL was scrubbed and no external resource hosts were observed.
- Ready-form screenshots at 390×844, 768×1024 and 1440×900: readable, no
  horizontal overflow; mobile scroll and larger two-column layouts worked.
- Browser-mocked initialize/reconcile produced one initialization under repeated
  tap/submit, pending/do-not-pay-again, verified confirmation and interrupted/
  unknown-outcome states. The actual DB order remained pending with zero
  attempts: the mocked confirmation was **not an actual payment**.
- Actual invalid dummy token and mocked expired state had no payment form.
  Browser cancellation/revocation and launching WhatsApp were not exercised;
  API tests cover ownership/expiry/cancellation and the implementation encodes
  the complete WhatsApp message once.
- Disposable users/order/items/links were removed, workflow overrides restored
  and browser contexts closed. The fixture process was stopped by the requester.
  Minor owner-panel crowding was observed without blocking its usable controls.

All provider responses in automated tests are mocked; no real transaction,
provider sandbox completion, physical-phone test or delivered email is claimed.

## Release gates and rollback

No deployment, DNS, provider activation, collection activation, financial
transaction or approved/frozen release replacement is authorized by this task.
Source compilation is not evidence that a frozen published package includes it.

Before requesting a separate controlled release:

1. Prepare a matched API/Companion candidate that includes the private document
   handler and its same-origin proxy. Retain and identify the actual predecessor
   and database backup. Do not silently edit approved archives or host routing.
2. Provision/verify the explicit HTTPS origins, callback URLs and sandbox
   signing configuration. Test Paystack, M-Pesa and enabled Stripe with the
   provider's sandbox, including interrupted responses and delayed callbacks.
3. Verify external edge access/error logs redact the `/pay/<token>` segment and
   do not persist bearer URLs or POST bodies. Origin diagnostics already use
   fixed route families. Confirm the deployed CSP/cache/referrer headers and
   noindex/sitemap exclusions through the actual ingress, not just localhost.
4. Obtain signed-out physical-phone evidence separately from emulated viewports.
   Record provider receipts, verified original-order status and buyer email/push
   delivery/notification-monitor failures without storing tokens or contacts.
5. If product-event collection is approved, verify the actual configured
   collector receives privacy-filtered events with tokenless page location and
   one verified transaction binding. Loading a script is not ingestion evidence.
6. Rollback must stop new link issuance/initialization while preserving pending
   references, capability hashes, attempt bindings and reconciliation. Do not
   delete pending orders/reservations or reset unknown attempts as “not started”.
   Use a compatible previous client only with an API capable of reconciling
   already-issued guest attempts. Database additions are additive, not dropped.

## Controlled sandbox verification prerequisites — 2026-10-13

The owner authorized test-only transactions and receipt notifications in an
isolated non-production setup, with no real funds or production data, and
confirmed availability for a signed-out physical-phone check. The supplied
browser and API origin was `https://www.app.ucfilters.com`.

Read-only checks found that this hostname does not resolve. The container
resolver returned no address, HTTPS probes for `/`, `/version.json`,
`/api/healthz` and `/pay` failed before reaching a server, and a separate public
DNS lookup returned status 3 (NXDOMAIN). This is not an application/provider
failure response, nor evidence that the guest-payment handler ran.

The configured M-Pesa environment is `sandbox`; Paystack and M-Pesa credential
existence was checked without reading or displaying their values. Their
approved isolated merchant/database/callback binding is not yet established.
Stripe is disabled and remains disabled; no Stripe webhook secret is configured.
The existing production hostname must not be substituted for the supplied test
origin without establishing a separate, approved non-production fixture.

| Evidence category | Status |
| --- | --- |
| Source and isolated mocked tests | Prior evidence only; not rerun or relabeled as provider evidence |
| Actual Paystack/M-Pesa sandbox recovery and callbacks | Not run; reachable isolated test setup and credential provenance required |
| Stripe sandbox | Disabled; not enabled or tested |
| Signed-out physical phone | Owner available; no device execution evidence yet |
| Buyer receipt email/push and delivery-failure record | Not run; approved test recipients and fixture required |
| Actual ingress cache/referrer/noindex/log redaction | Not verified; supplied hostname has no DNS address |
| Google collector ingestion | Outside this verification; no collector activated |

No transaction, notification, production database write, DNS change,
publication, credential replacement or collector activation was performed.
Obtain reachable approved non-production browser/API origins before continuing.

The owner subsequently clarified that the submitted addresses were copied
from real application/API configuration, rather than a separate test host.
The selected publication builder explicitly injects `app.ucfilters.com` for
the Companion origin and `api.ucfilters.com` for its API origin; it does not use
`www.app.ucfilters.com` for both. The real store therefore exists, but the
supplied test hostname is incorrect and the two actual published origins must
not be treated as an isolated merchant/database fixture. A separate test setup
has not yet been identified. Existing provider secrets, publication settings
and DNS remain untouched.

## Local fixture preparation verified — 2026-10-13

The owner approved the written isolated-fixture design and implementation.
The preparation tool is documented in `docs/guest-payment-fixture-runbook.md`.
It creates a separate temporary database, checks that database's identity before
loading payment code, and seeds one synthetic buyer and original saved order.
Only the real payment router and private document/proxy are exercised; unrelated
AI integration calls fail explicitly in a fixture-scoped dependency substitute.
No live payment, notification or AI credentials are inherited.

The completed local verification established:

- Six configuration/transport/stop-control safety tests passed; API TypeScript check passed.
- Private document returned 200 with private/no-store, no-referrer and
  noindex/nofollow/noarchive headers and a self-only connection policy.
- Summary returned the minimal payer contract without the synthetic buyer's
  email, phone or full address.
- All payment methods were unavailable. Initialization returned 503 rather than
  demo success; the original pending order and buyer were retained.
- Ordinary payment routes and foreign browser origins were rejected.
- Fixture logs did not contain the bearer or submitted payer email; application
  logging was silent. Private temporary files had restrictive permissions.
- No actual provider requests occurred, and cleanup removed only the owned
  fixture database. Its removal was checked through a read-only catalogue query.
- Retained-process health and explicit graceful stop passed, including removal
  of its exact database, private files and listener. A background-tool force-stop
  did not run signal cleanup; that owned synthetic orphan was safely recovered.
  The runbook now uses a validated private control file and explicit stop
  command rather than relying on a force-stop's lifecycle behavior.
- Sanitized evidence is in the ignored
  `generated-artifacts/guest-payment-fixture/local-verification.json`.

The listener is loopback-only and is not registered with the public preview
proxy. The verification run stopped and discarded its database afterward; the
fixture remains reproducible through the runbook command, not publicly hosted.
This is **local preparation evidence only**. Actual provider recovery,
signed/delayed/duplicate callbacks, permanently voided sessions, buyer receipt
email/push, notification failure records, physical phone and external ingress
privacy remain unverified. Stripe remains disabled; no collector was activated.

Dedicated `GUEST_PAY_TEST_…` credentials are not configured. The owner subsequently
approved reuse of the saved M-Pesa credentials and confirmed they are test
credentials. This is a M-Pesa-only exception, not permission to reuse other
provider credentials or enable production transactions. Paystack test-key
approval/configuration, approved reachable callback routing and notification
test targets remain outstanding. The assigned verification is not complete.

## Saved M-Pesa sandbox authentication — 2026-10-13

The owner instructed: “for mpesa use what is already saved” and confirmed:
“those are test”. Secret-existence checks confirmed all five saved M-Pesa
credentials are present; the configured environment is `sandbox`.

A separate isolated authentication process received only the approved M-Pesa
secret names and minimal runtime configuration. It sent a single GET to the
fixed Daraja sandbox OAuth endpoint, without redirect following, using a bounded
timeout. Authentication returned **HTTP 200 with an access token**. Neither the
credentials, response body nor token were logged or persisted. The shortcode
syntax was valid; passkey and callback-secret presence was confirmed, not their
transaction behavior.

Sanitized evidence is in the ignored
`generated-artifacts/guest-payment-fixture/mpesa-authentication.json`. This is
**actual sandbox authentication evidence only**, separate from the earlier
local preparation run, which sent no provider requests. No STK push, payment,
callback, receipt email or push notification was initiated. Existing secrets,
settings and order data were unchanged. The local preparation fixture remains
credential-free; introducing the approved M-Pesa credentials to a payment
worker requires the separately approved HTTPS test-routing phase.
