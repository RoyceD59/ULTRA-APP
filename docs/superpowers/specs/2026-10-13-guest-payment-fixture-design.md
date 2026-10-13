# Isolated guest-payment verification fixture

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
