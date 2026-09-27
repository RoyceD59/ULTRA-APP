# Ultra-Clear Instant Water Check and Lead Flow

Date: 2026-09-14  
Status: Approved design

## Purpose

Add a quick indicative water check that works as:

- A public lead-generation page for blog, social, campaign, and direct-link traffic.
- A signed-in Ultra-Clear Companion experience.
- A ProjectHub water-test ticket and customer-history source.
- A private, account-scoped context source for Alison.

This feature adapts the questions and interpretation rules from `attached_assets/UltraClear_Water_Test_1789413307624.html`. The uploaded HTML is an initial design reference, not runtime code or a permanent authority. Implementation must copy the approved rules into a versioned server scorer named `instant-water-check-v1`; committed scorer fixtures become the authoritative regression contract.

## Product principles

1. The instant result is an indicative screening result, not a laboratory result or health assessment.
2. Result bands are calculated by the API from validated answers. Clients do not submit authoritative scores.
3. One assessment follows the customer from lead capture through optional physical testing. ProjectHub must not create duplicate lead and booking records.
4. Public contact details do not attach to an existing customer account until the phone number is verified.
5. General water interpretation knowledge may be shared with Alison. Customer result data remains private and is loaded only for the authenticated owner.
6. Notification failure must never discard a saved assessment or ticket.

## Entry points

### Public web page

ProjectHub exposes a public route at `/water-check`. It is available without a team session and is suitable for links from the Ultra-Clear website, articles, social posts, adverts, and QR codes.

The page uses Ultra-Clear branding and is isolated from the authenticated ProjectHub workspace. It records source attribution from `src` and standard `utm_*` parameters.

### Ultra-Clear Companion

The Companion Water Test navigation entry opens the instant check first. Assessments created inside an authenticated Companion session attach directly to that authenticated user; they are not public leads and do not require a second ownership challenge.

Guests may complete the public-style contact and question flow. A result remains a lead until verification or sign-in attaches it to an account.

## Customer journey

### Step 1: contact and consent

Before any result is shown, the public flow requires:

- First name.
- WhatsApp-capable phone number.
- Country and service area.
- Explicit consent to receive the result and an Ultra-Clear follow-up on WhatsApp.

WhatsApp is the primary verification channel. If WhatsApp delivery is unavailable and an SMS provider is configured, the UI may offer **Send the code by SMS** only after a separate, explicit SMS consent action. No marketing consent is inferred from requesting an OTP.

The signed-in Companion flow uses the authenticated account identity. A missing or unverified contact number may limit result delivery, but it does not change ownership of an assessment created in that authenticated session.

### Step 2: six-question check

The flow collects the same core factors as the uploaded prototype:

- Water source.
- Main concern.
- Visible or experienced symptoms.
- Area.
- Household or business setting.
- Relevant use context.

Questions use controlled values defined in the API contract. The server maps those values to versioned scoring rules.

### Step 3: indicative result

The API returns:

- Hardness and scale band.
- Taste and odour band.
- Sediment and clarity band.
- Microbial-concern band.
- Plain-language summary.
- Recommended next step.
- Regional warning, including the Rift Valley fluoride flag where applicable.
- Scoring-rules version.
- Disclaimer that the result is indicative and does not establish safety.

The result page offers:

- **Book a physical water test**
- **Send result on WhatsApp**
- **Verify and save to my account** for an unverified public lead
- **View in my account** for an attached Companion result

### Step 4: optional physical test

Booking a physical test updates the existing assessment ticket instead of creating a second ticket. The customer confirms service address, preferred contact time, concerns, and optional photos/videos. The media contract is defined under API authorization below.

If physical testing is not yet serviced in the selected market, the result remains available and the ticket records a product-follow-up request rather than promising a technician visit.

## Separate deliverable: Impact Card

This is an independent UI deliverable in the same release, owned by the Ultra-Clear Companion Account screen and implemented only in `PersonalImpactSection`. It has no dependency on water-check data, API changes, lead state, or ProjectHub.

- The collapsed header shows the card title, current litres, and an expand chevron.
- The card is collapsed by default to reduce page height.
- The toggle exposes an accessible expanded state and descriptive label.
- Expanding reveals the existing litre input, impact metrics, milestone, savings, methodology details, and history.
- Calculations, history dialogs, update behavior, and the separate global `ImpactBubble` remain unchanged.

Acceptance criteria:

- The Account screen initially shows the collapsed Impact Card summary.
- Tapping the header toggles the full existing content on native and web.
- Screen readers announce the control and its current expanded state.
- Collapsing does not clear an entered litres value, change a saved total, or alter history/details behavior.
- Existing Impact calculation tests, the Companion type check, Expo Doctor, and native/web previews remain clean.

## Data model

### Instant assessment

A durable assessment record stores:

- Public assessment ID and human-readable `WT-*` reference.
- Idempotency key.
- Rules version.
- Lead/customer relationship:
  - Nullable customer user ID.
  - Lead first name.
  - Normalized phone.
  - Phone-verification state and timestamp.
- Consent state, consent timestamp, and consent wording version.
- Country, area, water source, concern, setting, and controlled answers.
- Server-calculated result bands and summary.
- Regional flags.
- Attribution fields.
- Lifecycle status.
- Physical-test request state.
- Created and updated timestamps.

Raw answers and computed summary are stored separately so future scoring changes do not silently rewrite what the customer originally received.

### Independent lifecycle fields

Creating a valid assessment and its ProjectHub ticket is one database transaction. Every completed quick check therefore has exactly one ticket, including unverified public leads.

Account-link states:

1. `unverified_lead`
2. `verified_unmatched`
3. `attached`
4. `ambiguous_match`

Service states:

1. `instant_result_ready`
2. `follow_up_requested`
3. `physical_test_requested`
4. `scheduled`
5. `completed`
6. `closed`

A public check starts with account-link state `unverified_lead`; verification changes it to `verified_unmatched`, `attached`, or `ambiguous_match` without changing service progress. An authenticated Companion check starts as `attached`. A market without physical service may move from `instant_result_ready` to `follow_up_requested`. If service later becomes available, the customer or authorized staff must explicitly request the physical test before it moves to `physical_test_requested`.

`closed` means no further operational action is expected after completion, cancellation, or a declined follow-up. Closing does not delete the result. Reopening requires an authorized staff action and creates an audit event.

Assessment creation idempotency is scoped to the create-assessment endpoint plus authenticated user ID, or plus a server-issued anonymous browser-session ID for public use. Physical-request idempotency is scoped to the assessment ID and endpoint. Keys are retained for 30 days. Reusing a key with the same normalized payload returns the original resource; reusing it with a different payload returns `409 Conflict`. The physical booking updates the one assessment/ticket atomically.

### Customer relationship

Signed-in assessments attach directly to the authenticated user ID.

Public assessments are not linked by phone alone. After successful WhatsApp verification, or separately consented SMS verification, the API:

- Attaches to the unique matching active customer when safe.
- Offers sign-in or account creation when no account exists.
- Leaves the record for staff resolution when matching is ambiguous.

Signing in alone does not claim an arbitrary public lead. A signed-in user may claim a public assessment token without another OTP only when the lead’s normalized phone equals a phone already verified on that account. Otherwise the public assessment completes its own OTP challenge.

Successful OTP confirmation issues a 30-minute assessment-scoped action token. It may authorize physical-test booking and account attachment for that assessment only. It cannot list customer data, access another assessment, or replace normal customer authentication.

Only an active ProjectHub administrator may manually resolve an ambiguous account match. Authorization must be re-read from `team_users` at request time; JWT role claims alone are insufficient.

## API contract

The OpenAPI specification is the source of truth. The feature adds contract-generated clients for:

- Creating a public or authenticated instant assessment.
- Fetching a redacted assessment result by an unguessable result token.
- Requesting and confirming phone verification.
- Attaching a verified assessment to the authenticated account.
- Requesting the physical-test stage.
- Listing the authenticated customer’s assessment history.
- Fetching a customer-owned assessment for Alison context.
- Listing and viewing water-test tickets in ProjectHub.

Public creation and verification endpoints require:

- Strict input schemas and normalized phone numbers.
- Per-IP and per-phone rate limits.
- Expiring OTPs with attempt limits.
- Idempotency keys.
- Unpredictable public result tokens.
- No account-existence disclosure.

Public result tokens are reusable for 24 hours so a customer can reload the result page. A token returns only the four bands, general summary, region flag, recommendation, disclaimer, reference, and service availability. It never returns name, phone, address, account match, consent evidence, internal notes, or media. Tokens are hashed at rest, rate-limited, revoked after account attachment or explicit deletion, and cannot authorize account attachment or booking by themselves.

After attachment, the public result URL asks the customer to sign in and redirects to the authenticated assessment view. The authenticated owner can continue to view the result through customer history after the public token is revoked.

OTP codes expire after 10 minutes, allow at most five attempts, and are invalidated after successful verification. Resend limits apply per phone and IP.

### Customer-action authorization

- A public result token is read-only and redacted.
- A valid assessment-scoped action token may request a physical test, submit service address/preferred contact time, or attach that assessment during its 30-minute lifetime.
- An authenticated UC customer may view or request service only for assessments owned by that database-backed user.
- Only active ProjectHub users with `water_tests` permission may update scheduling or service state.
- Only active ProjectHub administrators may reopen closed tickets, resolve ambiguous identity, delete records, or retry failed customer notifications.
- Every mutation revalidates the current record state and returns a conflict instead of overwriting a newer transition.

### Media contract

Physical-test booking accepts at most five images (`jpg`, `png`, or `webp`, maximum 10 MB each) and two videos (`mp4`, `mov`, or `webm`, maximum 50 MB each). The server validates declared type, file signature, ownership metadata, and size before attachment. Unsupported or scanner-flagged content is rejected or quarantined and is never served.

Files use server-generated private object paths. Downloads require the authenticated customer owner or an active ProjectHub user with `water_tests` permission. Unattached pending uploads expire after 24 hours. Attached media follows the ticket retention period defined below.

## ProjectHub experience

### Staff access boundary

Water-test lead and ticket data is available only to active ProjectHub users with the `water_tests` permission; manual account resolution and deletion require an active administrator. List views mask phone numbers. Full contact details are available only in ticket detail when needed for customer follow-up. Opening full contact details, exporting records, resolving identity, and deleting records writes an audit event containing the acting team-user ID, action, record ID, and timestamp.

Staff access is limited to fulfilling the customer-requested assessment and service, customer support, scheduling, fraud/security handling, and legally required record administration. WhatsApp consent authorizes result delivery and follow-up communications only; it is not treated as consent for unrelated marketing, staff browsing, export, or indefinite retention. Requesting a physical test includes a separate acknowledgement that contact and service-address data will be processed for scheduling and delivery.

Customer water-test data is not added to the general team document library.

### Water-test queue

The ProjectHub water-test queue must provide:

- Instant result and physical-test status.
- Lead/account badge.
- Four result bands.
- Area, source, concern, attribution, and consent.
- Verification and account-link state.
- Filter for instant-only, physical requested, scheduled, completed, and follow-up markets.

### Ticket detail

The ticket shows:

- Customer/lead contact summary.
- Original answers.
- Versioned indicative result.
- Safety disclaimer.
- Physical-test request and scheduling details.
- Notification delivery status.
- Timeline of verification, account attachment, booking, scheduling, and completion.

### Customer account summary

The ProjectHub customer detail adds:

- Latest instant-result summary.
- Current physical-test status.
- A compact history linked to ticket detail.

Only verified or staff-confirmed assessments appear on a customer account.

## Alison integration

The product name remains **Alison**.

### Shared interpretation knowledge

Alison’s approved guidance is extended with:

- Meanings and limitations of the four result dimensions.
- Recommendation rules used by the versioned scorer.
- Regional warning language.
- Physical-test service expectations.
- Mandatory safety and laboratory-test disclaimers.

This shared guidance contains no customer identifiers or customer results.

### Private customer context

This integration applies to the Companion customer Alison chat only. Alison acts with the UC customer JWT from the active chat request. The server resolves that principal to the database-backed customer user, checks assessment ownership, and then may retrieve the latest eligible assessment owned by that user and inject a compact structured summary:

- Assessment reference and date.
- Four result bands.
- Water source and area.
- Regional flags.
- Recommended next step.
- Physical-test ticket state.

The server derives this context. It does not trust client-provided water-result context. It excludes phone numbers, addresses, media, unrelated tickets, and other customers’ data. Team sessions, generic Anthropic routes, and staff-mediated chat cannot use this customer-context path.

Alison may explain the result, remind the customer of the recommendation, and state the physical-test status. Alison must not diagnose health conditions or present the instant check as measured laboratory data.

## Notifications

After persistence succeeds:

- The result may be sent over WhatsApp using the approved summary and disclaimer.
- ProjectHub may receive a team alert for a new lead or physical-test request.
- The customer receives booking confirmation when physical testing is requested.

Provider failure is recorded on the ticket and made retryable. It does not roll back the assessment or booking.

## Retention, correction, and deletion

- Unverified or unmatched public leads are retained for 90 days, then deleted unless a physical test or active support follow-up remains open.
- Account-linked assessments and completed service tickets are retained for 24 months after the latest ticket activity, subject to any longer legally required transaction record.
- OTP plaintext never persists. OTP hashes and attempt records are deleted within 30 days; individual OTPs expire after 10 minutes.
- Public result tokens expire after 24 hours and their hashes are deleted within 30 days.
- Consent evidence is retained with the lead/ticket for the same period as that record.
- Notification delivery logs are retained for 90 days.
- Optional media uses the private-media contract above and is deleted when its owning ticket is deleted.
- Account deletion and approved data-erasure requests remove or anonymize eligible assessment, lead, media, and notification data without deleting legally required operational records.
- Authenticated customers may correct current contact details through customer-profile endpoints. Public leads correct details through the assessment-scoped verification flow. Staff correction requires `water_tests` permission, preserves an audit trail, and never rewrites the original questionnaire answers or delivered result.
- Customer data export includes attached assessment summaries and ticket status, but not internal staff notes or security/audit metadata.

## Error handling

- Validation errors identify the field without exposing internal data.
- Scoring fails explicitly if the rules version or controlled answer is unknown.
- Duplicate submissions return the original assessment.
- Verification expiration permits a rate-limited resend.
- Ambiguous customer matches remain unlinked.
- Unsupported physical-test markets offer product follow-up without creating a technician promise.
- ProjectHub displays notification failures without hiding the ticket.
- Alison proceeds without private assessment context when ownership cannot be proven.

## Accessibility and responsive behavior

- Public and Companion questions use labels, progress text, minimum touch targets, and keyboard-safe mobile forms.
- Result bands include text labels and do not rely on color alone.
- The Impact Card toggle exposes `accessibilityRole="button"` and `accessibilityState.expanded`.
- Public web layout supports narrow mobile screens and desktop embedding widths.
- Loading, retry, offline, and partial-notification states remain actionable.

## Verification plan

### Scoring and API

- Exact `instant-water-check-v1` scoring fixtures derived from the approved prototype.
- Regional hard-water and Rift Valley fluoride cases.
- Unknown-value and rules-version failure cases.
- Idempotent assessment and physical-booking creation.
- Public rate limiting and OTP attempt/expiry behavior.
- No account-existence disclosure.
- Cross-account result denial.
- Ambiguous phone matching remains unlinked.

### ProjectHub

- New instant result appears in the queue.
- Physical request updates the same ticket.
- Customer detail shows only attached assessments.
- Filters and detail summaries use the generated contract.
- Delivery failures remain visible and retryable.

### Companion and public page

- Required contact/consent gate.
- Signed-in and guest journeys.
- Verification and account attachment.
- Indicative-result disclaimer.
- Unsupported-market behavior.
- Collapsed and expanded Impact Card on native and web.

### Alison

- General guidance answers use approved interpretation language.
- Customer result context is loaded server-side.
- One customer cannot retrieve another customer’s result.
- Alison distinguishes indicative screening from physical or laboratory measurements.

## Out of scope

- Laboratory instrument integration.
- Medical or drinking-water safety certification.
- Automatic product purchase or checkout.
- Automatic account linking based only on an unverified phone number.
- Publishing private customer results into the shared ProjectHub document library.