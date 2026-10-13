# Development-only guest-payment verification fixture

This is an isolated verification tool, not a release candidate. Its writes
are confined to its own synthetic database. It does not publish anything,
change DNS, replace saved secrets or write production orders.

## Commands

Run from the repository root:

```sh
pnpm --filter @workspace/api-server run test:guest-pay-fixture
pnpm --filter @workspace/api-server run fixture:guest-pay --verify
```

The first command checks configuration and outbound-access guards without a
database. The second creates a temporary database, builds its schema, starts
the real API and private-document handlers against synthetic data, verifies
their local behavior, and drops that database. It writes a sanitized result to
`generated-artifacts/guest-payment-fixture/local-verification.json`, excluded
from Git and publication.

For a retained local fixture:

```sh
pnpm --filter @workspace/api-server run fixture:guest-pay --serve
```

Use a tracked background process. The listener binds only to
`127.0.0.1:39761`; it is deliberately not registered with the public preview
proxy. It expires after four hours. Stop the supervisor with SIGTERM or SIGINT
to terminate the worker, drop only its database, and remove its private files.
For a tracked background process, use the explicit graceful-stop command with
its private temporary directory:

```sh
pnpm --filter @workspace/api-server run fixture:guest-pay --stop /tmp/guestpay-fixture-REPLACE_WITH_OWN_DIRECTORY
```

Directory names can be listed locally; do not display `state.json` contents.
The stop command reads only private control metadata, checks that a running PID
still belongs to this fixture, sends SIGTERM and verifies database removal.
It can also reclaim that exact owned database after the supervisor has died.
Do not rely on a background-tool force-stop to run signal cleanup; SIGKILL
cannot execute handlers. If graceful stop times out, report the failure rather
than deleting a database belonging to an active fixture.
Do not start a second retained instance on the same port.

## Safety and access

- The isolated database has a distinct `guestpay_fixture_…` name. Other API test
  runs do not use or sweep this prefix. The worker verifies the database
  identity before importing application handlers or writing fixture rows.
- The worker receives an allowlisted environment, not workspace secrets.
  Its special `NODE_ENV=guestpay-fixture` deliberately fails the real payment
  mock gate: development/test demo success must not be reported as unavailable
  provider behavior.
- Stripe, analytics and real notifications remain off. Network access is
  restricted to the exact fixture HTTP port and its database transport.
  Normal checkout/payment routes and all provider callbacks are blocked.
- Only the real payment router is mounted. Its transitive review-classification
  dependency eagerly imports an AI client, so a fixture-only module hook
  replaces that unrelated integration with functions that explicitly throw.
  No AI response is simulated and no live AI credential is inherited. This
  substitution is not applied in the normal API or a published bundle.
- A temporary directory under `/tmp/guestpay-fixture-…` uses mode `0700`; its
  `state.json` uses `0600`. Only that private file holds the local bearer link.
  Never paste its contents into chat, logs, screenshots, task evidence or Git.
- The reserved `https://guest-pay.test` origin is an internal synthetic
  capability-generation origin, not a real external host or callback target.
  Local document requests use the loopback URL in the private state file.
- Request events expose only a generated request ID, bounded route family and
  status. Application logging is silent in this fixture. This verifies fixture
  log privacy, **not production or external ingress logging**.
- Missing provider credentials produce an unavailable result, not a payment.
  Health shows database isolation, synthetic-data counts and safety flags,
  without buyer contacts, bearer links or connection strings.

## Checks still required

The following remain separate and unverified: actual Paystack/Daraja sandbox
transactions; lost responses and delayed/duplicate signed callbacks;
permanently voided hosted-session semantics; buyer email/push success and an
operational delivery failure; signed-out physical phone; actual HTTPS ingress
cache/referrer/noindex/token-log policy.

Before adding an actual provider mode, obtain dedicated approved test
credentials through Secrets, an approved non-production callback/application
origin, privacy-reviewed routing and approved notification test recipients.
Do not inherit existing live credentials or expose this local fixture by
changing its bind address or registering a route. Keep provider test cases
bound to their original fixture order and amount/currency. Google collector
ingestion stays with its separate verification task.

## Owner-approved temporary HTTPS and M-Pesa sandbox phase

The owner approved temporary HTTPS development tests and reuse of the saved
M-Pesa test credentials. These approvals do not cover live payments, publication,
Paystack credential reuse, notification recipients or production URL changes.

```sh
# No provider credentials, to check development HTTPS delivery:
node artifacts/api-server/scripts/guest-pay-fixture.cjs --serve-https
# Selectively copies only the five approved saved M-Pesa secrets:
node artifacts/api-server/scripts/guest-pay-fixture.cjs --serve-mpesa
# Use the private directory reported by that exact supervisor:
node artifacts/api-server/scripts/guest-pay-fixture-https-check.cjs /tmp/guestpay-fixture-REPLACE_WITH_OWN_DIRECTORY
```

The normal development API exposes only `/api/guest-pay-fixture`. The namespace
rejects deployed/production mode and never falls through to normal customer
routes. It attests the exact live fixture instance before forwarding to its
fixed loopback listener. It allows only the private document/proxy, a bounded
readiness response and M-Pesa callback POSTs. Local activation/control paths are
not public. Foreign browser origins are rejected, including on error responses.

Payment initiation starts locked. The HTTPS checker verifies actual private
headers, disabled collectors, minimal payer summary, callback rejection without
authentication, blocked normal checkout/control paths and original buyer/order
counts. Add `--activate` only after all checks pass, to unlock this exact instance.
The checker is an initial preflight, not a way to reinitialize an existing attempt.

Only `sandbox.safaricom.co.ke:443` OAuth, STK initialization and STK query paths
are allowed. Redirects, production M-Pesa, Paystack, Stripe, email, push and
unrelated destinations stay blocked. Daraja callbacks use per-push authentication
tokens, not provider HMAC signatures; independent provider confirmation is still
required before treating them as payment.

M-Pesa mode encrypts private capability/signing context using a domain-separated
key derived from the approved saved test webhook secret, in addition to private
file permissions. Neither provider credentials nor bearer values are evidence.
The four-hour supervisor shutdown removes an unused or resolved fixture, but
**preserves an unresolved original database and its encrypted private context**.
Explicit stop also refuses to discard unresolved payment records. Do not create
a new fixture/charge to replace an unknown attempt; automatic startup rejects
retained unresolved contexts. Recovery/resumption must use the original context.

### Current evidence and blocker

Fourteen guard/proxy/encryption checks and API TypeScript passed. Actual
development HTTPS document/proxy headers, disabled collectors, route/origin
isolation and unauthenticated callback rejection passed. Observed application
ingress and fixture logs contained no capability. Internal gateway/edge logs
are not independently observable, and the phone-sized no-link screenshot is
not a physical-phone or valid-link interaction check.

One real M-Pesa sandbox initialization was attempted on 13 October 2026 at
11:20 Africa/Nairobi, using the documented sandbox sample phone. The API returned
HTTP 500 without a checkout reference, with `state: pending` and `retryable: false`.
The original order and buyer remained unchanged; the pre-request callback binding
exists but no reference or confirmed payment is stored. Read-only reconciliation
also returns pending. No automatic retry or simulated success was performed.
This is **unresolved sandbox evidence**, not successful payment/recovery proof.
Confirm the Daraja request outcome before any new payment attempt.

### Diagnostic preparation after the inconclusive attempt

The fixture suppressed normal application logging, so the original provider
status/error was not retained. That response cannot be reconstructed from the
generic client error. Do not ask the owner to find a phone notification for a
request sent to the documented sample phone, or assume the portal exposes a
per-request history.

Fixture-only transport diagnostics now capture bounded HTTP status, a fixed
public error-code allowlist, a fixed issue category and reference-presence boolean.
They never emit response messages, credentials, contacts, URLs or references.
Response inspection is limited to 8 KiB and one second, preserves the original
body, and cannot initiate a retry. Nineteen focused checks and TypeScript passed.
This code is prepared for future safe execution, not retroactively active in
the original worker and not actual new-provider evidence.

Non-charging saved-configuration checks found all approved fields present and
no surrounding passkey whitespace, but the saved shortcode differs from the
usual `174379` sandbox PayBill example. This is only a setup hypothesis, not
proof of an invalid merchant or the cause of rejection. Verify M-Pesa Express
Sandbox subscription and the simulator's actual paired Test Data. Never silently
replace saved secrets with sample values. Keep the webhook encryption key
unchanged while unresolved encrypted recovery context depends on it.

The original supervisor was gracefully paused after these checks. Its unresolved
database and encrypted context were verified retained; the public test namespace
now returns 503 rather than exposing a replacement fixture or normal checkout.
The prepared diagnostic change was not used to replay the original request.

Sanitized evidence is ignored under `generated-artifacts/guest-payment-fixture/`:
`https-verification.json`, `mpesa-attempt.json`, `mpesa-pending-guard.json`.
Saved-credential OAuth evidence remains separate. Actual Paystack, controlled
lost-response recovery, completed/delayed/duplicate authenticated callbacks,
permanent voids, buyer email/push and operational delivery failures, physical
phone and any unobservable edge privacy evidence remain incomplete.
