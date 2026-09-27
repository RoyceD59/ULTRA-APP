# Companion Domains and Offline Account Provisioning

## Status

Approved on September 14, 2026.

## Goals

1. Serve Ultra-Clear Companion and ProjectHub on separate public hostnames.
2. Give every eligible offline-sale customer a database-backed Companion account.
3. Support Companion password sign-in with either email or phone number.
4. Deliver a one-time temporary credential that expires after 14 days and forces a permanent-password change.
5. Never overwrite an existing customer's password merely because an offline sale matches their contact details.

## Public Hostnames

- Companion: `https://app.ucfilters.com`
- ProjectHub: `https://hub.ucfilters.com`
- API: `https://api.ucfilters.com`

Cloudflare will route each hostname to the appropriate service or artifact on the Replit production origin. Companion must render at `/`, not at `/uc-companion`, and ProjectHub must render at `/`. API traffic must not be cached.

Only these browser origins may call the production API:

- `https://app.ucfilters.com`
- `https://hub.ucfilters.com`

Native Companion builds may call the API without a browser Origin header. Production builds must fail explicitly when the API hostname is absent.

## Cloudflare and Replit Routing

The preferred architecture uses hostname-aware Cloudflare routing in front of the existing Replit services:

- `app.ucfilters.com/*` routes to the Companion web build.
- `hub.ucfilters.com/*` routes to ProjectHub.
- `api.ucfilters.com/api/*` routes to the API server.

The implementation must inspect the live `ucfilters.com` zone and existing records before changing DNS. It must preserve unrelated records and avoid guessing record targets. Cloudflare TLS, proxying, API no-cache rules, and Replit custom-domain requirements must be verified against the live configuration.

If the reconnected Cloudflare API token is not available through the workspace integration, DNS mutation is blocked until the correct connection is attached. Application changes may proceed independently.

## Offline-Sale Provisioning Boundary

ProjectHub's existing **Add offline sale** operation is the provisioning trigger. A successful new offline-sale record represents the sale-completion boundary.

The request must contain at least one usable login or delivery identifier:

- a valid email address; or
- a normalized international phone number.

The server, not ProjectHub, owns account matching, password generation, expiry, linkage, and delivery-state decisions.

## Transaction and Idempotency

The server must atomically:

1. Create or identify the offline-sale record.
2. Find, create, or flag the related Companion account.
3. Link the sale to the account when unambiguous.
4. Record an idempotent credential-delivery job for a newly created account.

External email or WhatsApp delivery occurs only after the database transaction commits. A retry of the same sale request or delivery job must not create another account, reset a password, or send unrelated credentials.

The offline-sale model therefore needs:

- a stable idempotency key;
- an optional Companion user relationship;
- account setup status;
- delivery status and metadata without plaintext credentials;
- conflict or failure information suitable for staff action.

## Existing-Account Matching

Matching order:

1. Normalized email.
2. Normalized phone number.

Outcomes:

- **No match:** create a new password-authenticated Companion account.
- **One account matched:** link the sale to that account and never replace its password.
- **Email and phone identify the same account:** link normally.
- **Email and phone identify different accounts:** create no account and change no credentials; mark the sale as an account conflict for staff resolution.
- **Multiple phone matches or another ambiguous legacy state:** fail closed and mark the sale for staff resolution.
- **Existing social or WooCommerce account:** link only when the existing identity rules permit it; never silently convert or claim the account.

An existing customer may receive a notification that the sale was linked, but that notification must not contain a newly generated password.

## New Companion Accounts

A new offline-sale customer receives a database-backed password account with:

- normalized email when supplied;
- normalized phone when supplied;
- a cryptographically random temporary password;
- only a password hash stored in PostgreSQL;
- `mustChangePassword` enabled;
- temporary-password expiry exactly 14 days after issuance;
- normal authenticated features blocked until permanent-password completion.

For phone-only customers, the implementation may maintain an opaque internal email-compatible identifier if required by legacy database constraints. It must not be presented as the customer's login identity. The user-facing login identifier is the phone number.

Plaintext temporary passwords must never be stored in the sale, user record, logs, audit records, error reports, analytics, or delivery-status tables.

## Phone-Number Sign-In

The Companion login screen accepts one identifier field:

- email address; or
- phone number.

The API normalizes phone input to an international canonical form before lookup. Email matching remains case-normalized. Ambiguous phone matches return a safe authentication failure and never select an arbitrary account.

Successful phone sign-in returns the same Companion session type and forced-password state as email sign-in. Existing email, WooCommerce, and Clerk flows remain compatible.

## Credential Delivery

### Customer with email

Email is the primary delivery channel. The message includes:

- customer login email;
- one-time temporary password;
- `https://app.ucfilters.com`;
- exact 14-day expiry date and time;
- instruction to choose a permanent password on first sign-in.

### Customer without email

WhatsApp is the delivery channel. The message includes:

- normalized login phone number;
- one-time temporary password;
- `https://app.ucfilters.com`;
- exact 14-day expiry date and time;
- instruction to choose a permanent password on first sign-in.

### Delivery failures

Delivery uses a durable retryable job or outbox with an idempotency key. Provider submission is not treated as guaranteed recipient delivery. ProjectHub exposes setup and delivery states such as pending, sent, failed, linked-existing, and conflict.

If final delivery fails, staff must be able to retry safely. Retrying must not expose a previously stored plaintext password because none exists. The server must either retry within a tightly controlled one-time credential handoff or invalidate the failed credential and issue a new one atomically.

## ProjectHub Changes

The offline-sale form must:

- require at least email or phone;
- explain that a Companion account will be linked or created;
- submit a client-generated idempotency key;
- show the returned account setup and delivery result.

The offline-sales view must expose:

- linked Companion customer;
- login identifier used;
- account setup status;
- delivery channel and status;
- conflict or failure reason;
- safe retry or resolution actions.

The UI never retrieves a stored temporary password. Plaintext may be returned once only when an authorized manual recovery action explicitly requires staff-mediated delivery.

## Manual Temporary Passwords

The 14-day expiry applies to automatically generated offline-sale onboarding credentials.

Existing manual ProjectHub temporary-password resets remain at their current 24-hour expiry unless separately changed. This keeps high-risk recovery credentials short-lived while allowing an offline customer reasonable onboarding time.

## Security and Error Handling

- All provisioning and conflict-resolution endpoints require the shared server-side admin gate.
- Password hashes use the existing approved password-hashing implementation.
- Credential-version checks continue to invalidate old sessions after password changes.
- Existing account passwords are never replaced automatically.
- Contact conflicts fail closed.
- API authentication and credential responses use no-store cache headers.
- Cloudflare must not cache API or authentication responses.
- Audit records contain actor, customer, channel, timestamps, status, and redacted failure metadata only.
- CORS must allow only approved production browser origins and development origins explicitly configured for development.

## Verification

### Domain routing

- `app.ucfilters.com/` renders Companion and not ProjectHub.
- `hub.ucfilters.com/` renders ProjectHub and not Companion.
- `api.ucfilters.com/api/health` returns a healthy API response.
- Companion no longer renders Expo Router's base-path error.
- API and authentication responses bypass Cloudflare caching.

### Account provisioning

- A new email customer receives one account and an email credential valid for 14 days.
- A new phone-only customer receives one account and a WhatsApp credential valid for 14 days.
- Both identifiers can sign in through Companion.
- First sign-in permits only permanent-password completion.
- Expired credentials are rejected.
- Completing password change invalidates the temporary session and enables normal features.
- Plaintext credentials are absent from persisted records and logs.

### Idempotency and identity safety

- Repeating an offline-sale request does not duplicate the sale, account, or credential job.
- A sale matching an existing account links without replacing its password.
- Conflicting email and phone matches modify neither account.
- Existing WooCommerce and social identities retain their current ownership protections.

### Production acceptance

Before publishing or changing production DNS, validate Companion QR, rewards, filter information, location editing, temporary-password onboarding, and unsynced-registration recovery against the production-style configuration. DNS cutover occurs only after origin routing and API reachability pass together.