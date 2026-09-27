# ProjectHub Reliability and Impact Card Design

## Scope

Repair five related operational failures without redesigning the surrounding products:

1. Restore and preserve the configured ProjectHub administrator.
2. Fix location activation/deactivation updates.
3. Make temporary-password issuance reliable and explain failures precisely.
4. Make lost-registration recovery actionable and safely clear resolved logs.
5. Repair WhatsApp QR connection feedback.
6. Replace only the Companion personal Impact Card with the compact v1.2 design.

## Administrator authority

`PROJECTHUB_ADMIN_EMAIL` remains the break-glass administrator identity. On API startup, an existing matching team user is reconciled to `role = admin` and `isActive = true`; a missing row is created as today. Matching is normalized for case and whitespace.

Reconciliation does not overwrite an existing password hash or profile fields. A changed password remains valid. Admin-protected routes continue to verify the current database role and active state rather than trusting stale JWT claims.

The startup path will log whether it created, restored, or confirmed the configured administrator without logging credentials.

## Location updates

Location creation keeps full-field validation. Location updates use a separate partial schema:

- `active` may be updated by itself.
- Editable location fields are validated only when supplied.
- Empty or malformed update bodies fail with a specific 400 response.
- Identity/location changes continue to reset verification.
- Activation-only changes preserve verification.

The ProjectHub button sends only `{ active: boolean }`, updates the visible row after success, and displays the server's actionable error on failure.

## Temporary passwords

The customer panel will determine eligibility before enabling issuance:

- account is active;
- account uses password authentication;
- the selected email or WhatsApp destination exists and is verified;
- the operator has the required permission;
- WhatsApp is connected when that channel is selected.

The API remains authoritative and keeps the current security properties: random password, hashed storage, credential-version invalidation, forced password change, expiration, one-time plaintext return, and rollback if delivery fails.

Generic failure text will be replaced with safe reason categories such as ineligible account, unavailable/unverified destination, WhatsApp disconnected, delivery provider failure, or insufficient permission. No response will expose password hashes or provider secrets.

## Lost-registration recovery

Each unresolved row opens a resolution form with:

- corrected email;
- corrected phone;
- intended existing customer/account selection, or an explicit new-account choice;
- a preview of identity conflicts before submission.

The backend accepts the original ledger identity plus the corrected normalized values and selected target. It locks the relevant identities, fails closed on conflicting ownership, and either links the ledger row to the selected account or creates the recovered account. It never replaces an existing account password.

Successful recovery records `dbPersisted`, the target account, resolution status, timestamp, and resolving administrator. A separate “mark contacted” action remains available but is not treated as database recovery.

Resolved records remain visible for audit. An administrator-only **Clear resolved logs** action:

- requires confirmation;
- removes only records confirmed as database-persisted and resolved;
- never removes unresolved, blocked, retryable, or merely contacted records;
- rewrites the JSONL ledger atomically under the existing write lock;
- returns and displays the number cleared.

## WhatsApp QR connection

The QR card will expose explicit `disconnected`, `connecting`, `qr`, `connected`, and recoverable `error` states.

- QR generation errors move to `error` instead of leaving an endless spinner.
- The UI continues polling while connecting and uses copy matching the real interval.
- Connect/status request errors are visible with a retry action.
- A newly generated QR is shown as a data URI and refreshed when it changes.
- Disconnect cancels pending retry work and clears the active connection/session state safely.
- Team-session authentication remains required.

Runtime configuration problems will be reported without exposing secrets.

## Companion personal Impact Card

Only `PersonalImpactSection` changes. The global aggregate Impact Bubble is unchanged.

The attached Ultra Clear Impact Card v1.2 guide is the presentation and calculation source:

- the input is litres consumed since the previous update;
- submitting adds the increment to the stored cumulative total;
- the existing API idempotency, per-filter capacity checks, and server persistence remain authoritative;
- filter selection, capacity details, and history move behind the details action so the default card stays concise;
- the card shows cumulative litres, 500 ml bottle equivalents, estimated bottle-related CO2e, estimated annual savings, one active milestone, the exact trust statement, and the Hydrate the Future statement;
- tapping CO2e opens the guide's estimate disclaimer;
- shower-only users do not receive misleading drinking-water calculations.

Calculations live in a pure configurable helper with source metadata kept separate. The demo savings ratio remains clearly an estimate until real annualization data exists.

## API and data-flow rules

OpenAPI is updated before generated clients. ProjectHub uses generated hooks where available and invalidates all affected lists/detail queries after successful mutations. Forms send explicit corrected values and never infer server-owned identity or audit fields.

All destructive and authority-changing operations are admin-only, database-reverified, logged without sensitive material, and fail closed.

## Error handling

Every changed operation returns an actionable public error code and safe message. The UI preserves user input after recoverable failures, prevents duplicate submissions, and shows success only after the authoritative server mutation completes.

## Verification

Focused tests will cover:

- configured member/inactive admin is restored without replacing the password;
- active-only location updates succeed while invalid partial updates fail;
- temporary-password eligibility and delivery failures produce the correct UI state and preserve the prior credential;
- corrected lost registrations link/create safely, conflicts fail closed, and clear removes only eligible resolved rows;
- non-admin users cannot resolve or clear recovery logs;
- WhatsApp QR generation failure is recoverable and polling reaches a QR;
- Impact Card increment semantics, 576 L reference calculations, milestones, conditional content, and concise default rendering.

Then run affected API, ProjectHub, and Companion type checks/tests; restart changed workflows once; inspect logs; and verify ProjectHub and Companion previews.