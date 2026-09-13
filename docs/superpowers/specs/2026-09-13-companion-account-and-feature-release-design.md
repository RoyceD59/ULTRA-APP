# Companion account and feature release

## Goal

Ship a stable authenticated Companion experience and verify that customer-facing filter tracking, rewards, password recovery, and water-test history are available in the published app and represented correctly in ProjectHub.

## Session stability

- Hydrate the Companion token and profile before protected navigation or authenticated queries run.
- Treat the stored token and profile as one session record during writes and cleanup.
- Prevent stale login/logout/request completions from replacing or clearing a newer session.
- Clear malformed or partial stored sessions.
- Never use device localhost when a published API domain is missing.
- Keep Clerk identity separate when the Companion API rejects its own session.

## Customer features

- A signed-in customer can see registered-filter life, cleaning count, replacement timing, rewards balance, badge, permanent QR identity, and water-test request history.
- Empty, loading, offline, and rejected-session states remain explicit.
- ProjectHub displays the corresponding customer, filter, reward, and water-test records.

## Password recovery

- Self-service recovery supports verified email and WhatsApp channels and records delivery results without revealing whether an account exists.
- Authorized ProjectHub staff can generate a strong 24-hour temporary password for an active Companion customer and select email or WhatsApp delivery.
- Issuance invalidates existing customer sessions.
- Only a password hash is persisted. The plaintext is shown once to the authorized operator and sent through the selected verified channel.
- Temporary-password login forces the customer to choose a permanent password before accessing customer features.
- Issuance, delivery, rejection, and completion are audited without storing plaintext credentials.

## Security boundaries

- Existing password or social accounts cannot be claimed by matching an external-provider email alone.
- Temporary passwords are single-purpose, expire, and cannot be used after the forced password change.
- Admin endpoints re-check current team permissions from the database.
- Logs and audit rows contain metadata only.

## Acceptance

- Companion, ProjectHub, API, and shared-library type checks pass.
- Expo Doctor passes.
- Relevant unit/API tests cover session races, temporary credentials, delivery outcomes, filter/reward data, and water-test history.
- One authenticated customer journey and one ProjectHub admin journey are checked against the running app.
- Production build commands complete and the published app is checked after the user publishes.