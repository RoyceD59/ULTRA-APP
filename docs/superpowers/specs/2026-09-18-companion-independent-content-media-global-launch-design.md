# Companion Independent Content, Media, and Global Launch Design

## Status

Approved in conversation on 2026-09-18. This specification records the implementation boundary before code changes.

## Goal

Launch Ultra Clear Companion for consumers without making normal app use depend on WooCommerce availability or response time. Companion must provide fast cached installation guides, support animated GIF/WebP and short videos, and accept international phone numbers with priority handling for Ghana, Kenya, Tanzania, Rwanda, Nigeria, and Uganda.

## Scope

### Included

- A durable, API-owned installation-guide catalogue stored in PostgreSQL.
- Guide media records for images, animated GIF/WebP, and short MP4/WebM videos.
- Public read endpoints that never call WooCommerce in the request path.
- Admin-only guide management in ProjectHub using existing team-admin authorization.
- Object Storage paths and validated remote-source URLs for guide media.
- Companion guide list/detail screens that use cached API content and retain bundled guides as an offline fallback.
- Lazy media loading, poster/thumbnail presentation, explicit playback, accessibility labels, and text fallback.
- International country selection and E.164 phone normalization.
- Priority ordering for Ghana, Kenya, Tanzania, Rwanda, Nigeria, and Uganda without excluding any supported country.
- Initial web startup optimization focused on WooCommerce-independent bottlenecks.
- Privacy-safe analytics hooks for guide views, media starts/completions/errors, and consumer acquisition outcomes.

### Excluded from this unit

- Rebuilding the WooCommerce storefront.
- Making WooCommerce the runtime source for Companion screens.
- Automatically importing content from an unverified CMS.
- Long-form video hosting, video editing, livestreaming, DRM, or autoplay with sound.
- Claiming that the Google Play production listing is live before store verification.

## Architecture

```text
ProjectHub admin or future CMS sync
                |
                v
Ultra Clear API validation
                |
                v
PostgreSQL guide metadata + Object Storage media
                |
                v
Public cached guide API
                |
                v
Companion React Query cache + bundled offline fallback
```

WooCommerce may later feed this store through a background synchronization job. A synchronization failure must not remove the last valid published guide set and must not block Companion requests.

## Guide Data Model

A guide contains:

- stable ID and slug;
- title, summary, category, product references, and ordered steps;
- publication state and version;
- optional locale/country targeting;
- updated and published timestamps.

Each step can contain text and zero or more media records:

- `image`: JPEG, PNG, or static WebP;
- `animation`: GIF or animated WebP;
- `video`: MP4 or WebM;
- media URL/object path, MIME type, alt text, caption, poster URL, duration, byte size, and ordering.

Published public responses expose only sanitized display fields. Draft, audit, uploader, and internal storage metadata remain admin-only.

## Media Rules

- Videos require an explicit Play action and never autoplay with sound.
- Media below the fold loads only when the step is near the viewport.
- Video displays a poster before loading playback bytes.
- GIF/WebP animations use `expo-image`; MP4/WebM uses `expo-video`.
- Animated files are served unchanged so image processing does not remove animation frames.
- Unsupported or failed media renders the step text, caption, and a retry/open control.
- Upload validation checks authoritative object metadata, MIME type, extension, and size.
- Public media responses retain long immutable cache headers for versioned object paths.
- Initial limits: 25 MB and 90 seconds per video; 8 MB per animation. Limits are enforced server-side and shown in ProjectHub.

## Public API and Caching

- `GET /api/uc/guides` returns the published guide index with cache validators.
- `GET /api/uc/guides/{slug}` returns one published guide.
- Responses use `ETag`, `Last-Modified`, and bounded public cache headers.
- Companion uses a shared React Query key and persisted last-successful data.
- Bundled guides remain the final offline fallback when no cached API response exists.
- Empty, partial, and stale responses are explicit; a failed refresh does not erase valid cached content.

## Admin Workflow

ProjectHub administrators can:

- create and edit guide metadata and ordered steps;
- upload or attach approved media;
- preview draft guides;
- publish or unpublish a version;
- see media validation errors without exposing storage credentials.

Every mutation rechecks the live active admin row. Publishing is transactional so the public catalogue never sees half-written steps.

## International Country and Phone Handling

- Store canonical phone numbers in E.164 form.
- Parse with a maintained international phone metadata library on the client for feedback and on the server for enforcement.
- Country selection controls the default calling code; users may still enter a complete `+` international number.
- Priority countries appear first:
  1. Ghana (`GH`, `+233`)
  2. Kenya (`KE`, `+254`)
  3. Tanzania (`TZ`, `+255`)
  4. Rwanda (`RW`, `+250`)
  5. Nigeria (`NG`, `+234`)
  6. Uganda (`UG`, `+256`)
- All remaining supported countries remain searchable; there is no generic “Other” value for persisted country data.
- Existing Kenyan local-number behavior remains compatible by converting valid local forms to `+254`.
- API endpoints never authorize identity from a caller-supplied phone number.

## Web Performance Work

The first optimization pass will:

- keep native notification modules out of the web startup path;
- avoid blocking the whole route tree on Clerk initialization;
- remove or replace the unused 1.26 MB duplicate icon;
- establish shared React Query cache defaults;
- stop duplicate/eager catalogue requests across Home and Products;
- defer account and product-detail requests until the relevant section is visible;
- preserve current offline/cache-first catalogue behavior.

Performance will be measured before and after using production-like web builds. No improvement will be attributed to WooCommerce unless measured independently.

## Analytics

Analytics must never delay rendering or media playback. Events are no-ops when no tracker is available and contain no names, phone numbers, addresses, guide free text, or secrets.

Initial events:

- `guide_list_viewed`
- `guide_opened` with guide slug/category
- `guide_media_started` with guide slug, step, and media type
- `guide_media_completed`
- `guide_media_failed` with bounded error class
- `water_check_started`
- `water_check_completed` with country code
- `signup_completed` with country code

Replit website analytics is preferred for the web artifact because pageviews are injected at publish time. Google Analytics may be added later if the user explicitly selects it and provides the measurement setup through the approved environment/integration flow.

## Failure Handling

- CMS or WooCommerce outage: serve the last published API copy.
- API outage: serve persisted Companion cache, then bundled guide fallback.
- Media timeout/unsupported codec: retain instructions and show retry/open fallback.
- Invalid phone: block submission with a country-aware message.
- Analytics failure: ignore it and continue the consumer action.
- Object metadata mismatch: reject publication and preserve the previous public version.

## Verification

- API tests for draft isolation, publication transactionality, cache validators, and media validation.
- Phone tests for the six priority countries plus representative numbers from other regions and invalid input.
- Companion web checks for GIF/WebP animation, MP4/WebM playback, lazy loading, fallback, and narrow layouts.
- Type checks for libraries, API, ProjectHub, and Companion.
- Production-like bundle comparison for root JavaScript and the duplicate icon.
- Workflow restart and visible screenshots after the completed implementation.

## Approved Extension: Worldwide Guidance and Water-Point Quality

Approved on 2026-09-18 using the reviewed-regional-profile approach.

### Worldwide Quick Water Test

- Generic source, concern, symptom, and setting rules remain available worldwide.
- Every geographic rule is country-scoped; place-name matching must never apply a Kenyan condition to a similarly named place in another country.
- Ghana, Kenya, Tanzania, Rwanda, Nigeria, and Uganda receive reviewed country-level guidance and may receive narrower city/region profiles only when the supporting condition is documented.
- Results state whether they use general indicative rules or reviewed regional guidance.
- Community ratings never change health-risk bands or recommendations.

### Water Location Types

Managed locations support:

- `water_atm`;
- `refill_station`;
- `city_tap`.

City tap points include country, city, coordinates, access/operating notes, municipal/source attribution, and verification status.

### Consumer Ratings

Authenticated, non-deleted consumers may submit one editable rating per location with:

- water quality;
- cleanliness;
- equipment condition;
- service reliability;
- overall safety confidence;
- an optional bounded comment.

The API enforces one row per user/location, score bounds, text bounds, authenticated write limits, and ownership. Public aggregates expose count and rounded averages only and never expose account IDs, email, phone, IP, moderation notes, or report identities.

Consumers may report a rating once using a bounded reason enum and optional bounded detail. Reports are retained for audit. Ratings can be hidden or removed from public aggregates without deleting their source record.

### ProjectHub Assessments

Active ProjectHub administrators may create a separately labelled assessment containing structured quality-control scores/checks, inspection notes, status, assessor, and verification date. Admin assessments are never merged into consumer averages.

### Release Safety

- Ratings are advisory community observations, not laboratory evidence.
- Verified-location status does not imply a verified reviewer.
- Consumer comments are published only under the moderation policy; aggregate scores remain server-computed.
- Automated rewards, anonymous ratings, photo reviews, replies, and rating-driven health recommendations are excluded.
