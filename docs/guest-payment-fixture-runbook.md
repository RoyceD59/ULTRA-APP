# Local guest-payment preparation fixture

This is an isolated **preparation tool**, not a sandbox-transaction result or a
release candidate. It never changes the published app, DNS, existing secrets,
development customer tables or production orders.

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
