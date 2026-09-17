# Ultra-Clear Responsive, Lead Resilience, Referral, and OAuth Upgrade

Date: 2026-09-17  
Status: Approved design

## Purpose

Strengthen the ProjectHub public water-check experience and Ultra-Clear Companion across narrow web and native screens, preserve useful UI during data disruption, provide an accurate mobile-install path, add a non-blocking Google Sheets lead backup, repair referral and promotion behavior, and expose explicitly scoped Companion and Alison data to approved external OAuth clients.

The work is divided into independent boundaries so a failure in an optional integration cannot prevent the primary customer journey:

1. Responsive and resilient client rendering.
2. Mobile application availability and signing readiness.
3. Primary water-lead persistence plus secondary Google delivery.
4. Referral attribution, first-order discount, and inviter earnings.
5. External OAuth authorization and filtered API resources.

## Product principles

1. ProjectHub remains authoritative for water assessments and leads.
2. Secondary lead delivery must never delay or replace a successful primary record.
3. A client must not crash, overlap text, or discard already loaded content because optional fields or a refresh are unavailable.
4. Referral codes and promotional coupon codes are different concepts and must not be interchangeable at the API boundary.
5. A referral reward is issued once after a qualifying paid order; duplicate payment events cannot duplicate earnings.
6. External integrations receive only approved scopes and filtered resources, never unrestricted database access.
7. Store availability and trust claims must be accurate. Unverified store links or signing identities are not presented as live.

## Responsive ProjectHub experience

### Public water check

The `/water-check` page must remain usable at a 320 CSS-pixel viewport and at all wider supported widths.

- Multi-column form groups stack when their labels or inputs cannot fit.
- Long select values, question options, badges, result summaries, recommendations, notices, and status labels wrap within their containers.
- Text-bearing controls use minimum heights with vertical padding rather than fixed heights.
- Flex children that contain text may shrink and use safe word-breaking where needed.
- Dialog bodies scroll when their content exceeds the available viewport.
- Horizontal overflow is fixed at its source rather than concealed by global clipping.
- The trust presentation uses **Your Neighborhood Rated** instead of any Unilever claim.

### Resilient data states

- Initial loading, background refresh, empty data, partial data, transient errors, terminal errors, and successful data are distinct states.
- Background refresh keeps the last valid content visible.
- Transient errors provide a **Try again** action.
- Expired or invalid public result links retain the existing new-check recovery action.
- Missing optional result fields render a controlled unavailable label.
- Missing required result structure renders a concise partial-result notice and retry action rather than throwing.
- Mutation controls remain disabled only while their own operation is pending.
- Raw server or network exception messages are not shown to customers.

## Responsive Companion experience

The Instant Water Test, result, verification, handoff, and history surfaces must work on native Android, native iOS, and Expo web.

- Use safe-area insets instead of fixed platform-specific header spacing.
- Stack identity and address fields on narrow layouts.
- Allow chips, band rows, recommendations, notices, and buttons to wrap and shrink.
- Make verification and booking modal bodies scrollable and safe-area aware.
- Preserve cached assessment history while refreshing.
- Provide retry controls for history, handoff, and attachment failures.
- Distinguish waiting for sign-in, temporary network failure, expired handoff, and completed attachment.
- Use an in-screen completion state where browser alert behavior is inadequate on Expo web.
- Guard incomplete result payloads before dereferencing nested fields.

## Mobile installation and Android signing

The public web experience includes an installation section:

- Google Play is shown as live only when the final application listing URL has been verified.
- Until that URL exists, Google Play is described accurately as not yet available rather than linking to another package or a guessed URL.
- iOS is labeled **Coming soon** because App Store registration is incomplete.
- Existing account and handoff links remain available independently of store availability.

The Android package is `com.ultraclean.companion`.

Production readiness requires:

- Google Play App Signing SHA-1.
- Google Play App Signing SHA-256 when required by the connected Google service.
- Upload-key identity recorded separately from the Play signing identity.
- Confirmation that the production Maps key allows the package plus current Play App Signing SHA-1.
- A first internal-track physical-device verification.
- Final Play Store listing URL.

The existing development SHA-1 is not evidence that a production Play build is ready. Existing fail-closed production checks remain in place.

## Google Sheets lead backup

### Primary path

The assessment API validates and transactionally stores the assessment, ticket, consent, identity, answers, attribution, and idempotency record. A successful response means the primary record exists regardless of secondary delivery.

After primary persistence, the server creates or confirms a durable Google-delivery outbox record in the same transaction or through an idempotent post-commit operation that cannot create duplicate logical deliveries.

### Server delivery

- A bounded worker claims pending outbox records with lease-based fencing.
- Provider calls have timeouts shorter than the claim lease.
- Failures use bounded exponential backoff with a terminal review state.
- Successful delivery stores a provider acknowledgement without copying unnecessary response data.
- Delivery payloads contain only the approved lead fields.
- Operational status is available to authorized ProjectHub staff.

### Browser emergency fallback

The browser invokes the fallback only after the primary API submission fails for a retryable availability or network reason.

- It does not run after a successful or validation-error response.
- It sends the minimum lead dataset, consent evidence, source attribution, client submission ID, and idempotency key.
- It does not transmit authentication tokens, internal IDs, or hidden customer data.
- It reports that the request was received for follow-up without claiming an indicative result was durably scored by ProjectHub.
- Failure of the fallback does not trap the customer in a loading state.

### Apps Script contract

The historical deployed endpoint may be reused only after ownership, deployment status, linked spreadsheet, and response behavior are verified. Its historical unauthenticated JSONP GET transport is not reused because it exposes personal information in URLs.

A paired Apps Script source file will be tracked with:

- POST-only JSON input.
- A versioned payload schema.
- Idempotent append keyed by client submission ID.
- Explicit success, duplicate, validation, and temporary-failure responses.
- Spreadsheet locking around deduplication and append.
- No secrets committed to source.

The deployment URL is environment configuration. If a verified endpoint is unavailable, both server delivery and browser fallback remain disabled without affecting the primary assessment flow.

## Referral and promotion behavior

### Separate concepts

- `referralCode` records who referred a registering customer.
- `promoCode` represents an ordinary campaign or WooCommerce-compatible purchase promotion.
- An earned referral benefit is selected from the authenticated customer's available benefits.
- APIs return explicit code types and statuses instead of one generic discount response.

### Registration

- A registration may include a referral code.
- The server normalizes and validates the code before finalizing attribution.
- Invalid, inactive, expired, exhausted, and self-referral codes receive explicit outcomes.
- Account creation and immutable account-ID attribution are persisted transactionally.
- A retry cannot create a second attribution.

### Referred-customer discount

The existing business rule remains: a valid referral grants the referred customer the configured immediate first-order discount.

- Eligibility and discount amounts are calculated by the server.
- First-order status is determined from authoritative paid-order history.
- Campaign dates, account limits, global limits, product/order eligibility, minimum spend, and combination rules are enforced.
- Checkout quotes and order creation use the same authoritative promotion/referral service.
- A referral share code is not sent to WooCommerce as if it were a WooCommerce coupon.

### Inviter earnings

After the referred customer completes the first qualifying paid order:

- Record one conversion under a database uniqueness boundary.
- Credit the inviter's configured earnings or benefit once.
- Store the earning in the inviter's account ledger.
- Make account totals derive from durable conversion and ledger records.
- Queue downstream settlement or notification independently.
- Duplicate and reordered payment webhooks remain idempotent.
- Cancellation and refund behavior follows the configured campaign rule and creates compensating ledger activity rather than deleting history.

### Limits and security

- Personal validation derives identity from the authenticated session.
- Public referral lookup returns only safe validity and campaign-display information.
- Callers cannot submit discount amounts or another customer's identity.
- Referral and promotion endpoints are represented in OpenAPI and generated clients.

## External OAuth API

### Authorization model

Approved external plugins use OAuth 2.1 authorization-code flow with PKCE.

- Clients are registered by an administrator.
- Redirect URIs use exact matching.
- Access tokens are short lived.
- Refresh tokens are revocable, rotated, and stored hashed where applicable.
- Client, user, and grant revocation take effect without waiting for token expiry where sensitive operations require it.
- Machine-to-machine access, if later needed, receives a separate client-credentials policy and cannot impersonate customers.

### Scopes

- `companion.monitor.read`: service health, failed jobs, queue status, and non-sensitive operational metrics.
- `companion.users.read`: approved customer/account fields.
- `companion.manage`: explicitly listed support actions.
- `interactions.read`: filtered user interaction history.
- `alison.read`: permitted Alison conversations, outcomes, and context.
- `alison.manage`: explicitly listed Alison management actions.

Read access does not imply manage access. Monitoring access does not imply personal-data access.

### Resource boundaries

- API responses use stable, paginated OpenAPI resources.
- Customer identity, contact, order, assessment, interaction, and Alison fields are filtered by scope and tenant/account boundary.
- Secret values, credentials, raw provider payloads, internal security fields, and unrelated customers are never returned.
- Customer consent and deletion state are enforced when exposing interaction and Alison data.
- Management endpoints use explicit action schemas and idempotency keys rather than general record mutation.
- Every sensitive read and management action records actor, client, scopes, target class, timestamp, and outcome in an audit trail.
- Rate limits apply per client, grant, and sensitive resource.

## Failure handling

- Optional integration failures never roll back a successful assessment or paid order.
- Outbox processing is lease-based and safe across worker restarts.
- OAuth denial returns a scope-specific error without leaking whether an inaccessible resource exists.
- Revoked clients and grants fail closed.
- Partial external-provider responses are not treated as committed success.
- Loading clients retain valid cached data and clearly indicate stale or unavailable sections.

## Verification

### Interface

- ProjectHub at 320, 375, 768, and desktop widths.
- Companion native-sized Android and iOS layouts plus narrow Expo web.
- Longest known labels, enlarged text where supported, modal overflow, and keyboard interaction.
- Initial load, cached refresh, offline, retry, empty, malformed optional data, and malformed required data.
- Trust wording and store-availability accuracy.

### Lead backup

- Primary success plus secondary success.
- Primary success plus secondary retry/failure.
- Primary retryable failure plus browser fallback.
- Validation failure does not invoke fallback.
- Duplicate browser and server deliveries produce one sheet row.
- Unconfigured or unverified Apps Script does not disrupt the assessment.

### Referral and promotions

- Valid, invalid, expired, exhausted, and self-referral registration.
- Concurrent registration retries create one attribution.
- First-order discount quote and checkout.
- Promotion and referral inputs cannot be confused.
- First qualifying payment credits one inviter earning.
- Duplicate and reordered payment events do not duplicate rewards.
- Campaign/account/global limits, refund compensation, and inviter account totals.

### OAuth

- Authorization-code and PKCE validation.
- Exact redirect URI matching, token rotation, revocation, and expiry.
- Each read and management scope independently allowed and denied.
- Cross-customer and cross-scope requests fail closed.
- Interaction and Alison filtering, pagination, rate limits, idempotency, and audit records.

## Delivery order

1. Responsive and resilient ProjectHub/Companion UI plus accurate install messaging.
2. Lead backup contract, outbox, paired Apps Script, and browser emergency fallback.
3. Referral/promotion contract separation and end-to-end reward repair.
4. External OAuth authorization server surface and scoped Companion/Alison resources.
5. Consolidated verification and operational documentation.

Each stage must preserve existing primary functionality and may be validated independently.