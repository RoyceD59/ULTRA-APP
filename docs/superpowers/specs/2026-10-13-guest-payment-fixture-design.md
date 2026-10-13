# Isolated guest-payment verification fixture

## Owner-approved credential-source update

After approving the local fixture, the owner requested reuse of the existing
M-Pesa secrets and confirmed they are test credentials. An isolated OAuth-only
probe authenticated successfully against Daraja sandbox without financial
transactions or secret output. This overrides the request for duplicate
M-Pesa test credentials, not the exclusions for unrelated live credentials.
The original local preparation mode remains credential-free.

## Proposed HTTPS development-test phase — approval required

- Expose a bounded temporary test namespace through the existing development
  API, forwarding only to the isolated fixture worker, not normal checkout
  handlers. Production must reject the namespace; no publication, production
  domain changes or DNS work.
- Use an active HTTPS development URL only for these temporary sandbox tests.
  Verify external reachability before provider initialization. Do not describe
  development URLs as permanent or production webhook infrastructure.
- Keep the worker's separate test database and synthetic buyer/order. Selectively
  allow only the five owner-approved saved M-Pesa secrets; pin all M-Pesa egress
  to Daraja sandbox. Stripe, Paystack, unrelated AI and notifications stay
  unavailable unless independently approved/configured.
- Serve only the private test payment document, narrow payment proxy and
  authenticated callback paths. Keep minimal payer summary, private/no-store,
  no-referrer and noindex headers, same-origin checks and token-safe logs.
  Verify these through actual HTTPS ingress before an STK request.
- Callback routing must never fall back to a normal development or production
  order when the fixture is unavailable. Stop disables the temporary route.
- Continue the original-buyer/order recovery, delayed/duplicate callback and
  permanent-void checks only after routing is verified. Do not claim receipt
  delivery without approved test recipients, or physical-phone evidence
  without an actual signed-out phone check.

This phase is proposed, not activated. The owner's approval must precede
implementation of public fixture access.

## Approved scope

Prepare a development fixture for the saved-order guest-payment verification.
The owner approved an isolated fixture after clarifying that no separate test
host had been supplied. Do not publish, change DNS, replace existing secrets,
write production orders, spend real funds or activate analytics collectors.

## Design

1. **Supervisor and database isolation.** Reuse the existing API test-runner
   pattern: create a uniquely named temporary PostgreSQL database through the
   development database connection, build its schema, and pass its connection
   only to the fixture child. Never migrate or seed the parent database.
   The child must check its database identity before importing application
   handlers. Cleanup may drop only the exact database created by that run.
   Do not use the existing suite's stale-database prefix for a long-running
   fixture, or let unrelated test cleanup delete its live database.
2. **Restricted process configuration.** Construct a child environment from an
   allowlist, not a copy of workspace secrets. Generate a fixture session secret.
   Do not inherit live payment, WooCommerce, Clerk, email, SMS, storage or AI
   credentials. Keep Stripe disabled and collector flags off. Guard both startup
   and outbound calls against accidental live-provider/notification requests.
3. **Real application contracts.** Exercise the real guest-payment API and
   private document/proxy handler. Use synthetic buyer/order/catalogue fixtures,
   not customer records or remote merchant orders. Any saved-order fixture must
   retain its original buyer, immutable amount/currency and attempt identity.
   Initial preparation may show provider-unavailable states; absent credentials
   must never become simulated payment success.
4. **Local lifecycle and privacy.** Bind the initial fixture to loopback and
   retain it in a tracked background process only while needed. Use a health
   check that exposes safety state, not credentials or connection strings.
   Keep bearer links and fixture credentials out of stdout, request logs,
   evidence files and Git. Private temporary files must use restrictive
   permissions. Store only sanitized operational evidence.
5. **Separate later provider phase.** Dedicated Paystack test credentials and
   approved Daraja sandbox credentials/callbacks are prerequisites for actual
   provider transactions. Existing credential presence and `MPESA_ENV=sandbox`
   are not enough. No provider-mode switch is allowed to fall back to live
   workspace credentials. Stripe remains outside execution while disabled.
   Real test-recipient receipt delivery also needs its own approved target.
6. **External evidence remains distinct.** Local headers/proxy behavior do not
   establish actual ingress log redaction, caching or crawler policy. Do not
   expose the fixture or a bearer until temporary routing and ingress privacy
   are approved. Signed-out physical-phone execution remains a separate check
   the owner can provide. Google collector ingestion belongs to its separate
   assigned task and is not activated here.

## Verification

Check safety guards without payment credentials, then start the fixture,
confirm its new database identity, health, anonymous private-document headers
and provider-unavailable behavior. Confirm cleanup deletes only that fixture's
database. Use existing focused tests through the isolated wrapper when changes
require them; never run API tests directly against the development database.

For later real provider execution, label lost-response recovery, delayed and
duplicate callbacks, permanent voiding, original-order identity, minimal payer
confirmation, buyer notifications, operational failure records, physical phone
and external ingress checks separately. Do not label preparation or mocked
responses as actual sandbox completion.

## Completion boundary

Preparing this fixture is one part of payment verification, not completion of
the assigned end-to-end verification. Missing credentials, callbacks, test
recipients or physical/ingress evidence must remain explicitly blocked.

## Approved temporary HTTPS phase and observed limit

The owner approved the temporary HTTPS development test phase. The existing API
now hosts only an attested, narrow fixture namespace; production/deployment mode,
normal checkout routes and public control paths fail closed. Saved M-Pesa secrets
are selectively copied to sandbox-only execution, without enabling Stripe,
Paystack, collectors or notifications.

Actual HTTPS privacy/route/origin checks passed. One sandbox initialization did
not produce a checkout reference; its API result remains pending and explicitly
non-retryable, with the original buyer/order retained. This is not payment,
callback or recovery success evidence. Preserve unresolved database and encrypted
capability/signing context across automatic or explicit shutdown; block creation
of a replacement fixture/charge until the original outcome is resolved.

Application ingress logs were observed token-safe; internal gateway logs remain
unobservable. No physical-phone result or successful actual receipt delivery is
established, and no publication or production routing changes are approved.
