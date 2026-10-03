# Companion public browser rendering

## Approved scope

Implement public rendering, route metadata, crawler endpoints, private indexing
exclusions, language/icon declarations and content-aware 404s. The owner approved
this file-level plan before implementation. This is not a redesign or a new
customer flow.

## Architecture

The standalone Expo server emits a readable semantic public document alongside
the existing, unchanged Expo root. Both browser visitors and crawlers receive the
same document. The initial document is removed only when the interactive app
mounts; no bot user-agent detection or hidden crawler-only content is used.

The public data adapter calls only anonymous catalogue, published article,
published guide and verified-location endpoints. It never forwards visitor
cookies, credentials, tokens or query strings. Mutable facts are derived from
these APIs, not a hand-maintained product/article copy. Static public summaries
live in shared JSON; the About screen consumes its existing copy from there.
Article links use the same shared parser in the browser and initial HTML.

Products are indexed only when present in the complete published catalogue.
WooCommerce catalogue reads explicitly request published products. Missing
published records yield 404; failed data reads yield 503, not fallback mock facts
or false 404s. Article inventories follow all cursors, rejecting incomplete or
repeated pagination. No persistent rendering cache retains unpublished records.

Page metadata and supported JSON-LD are emitted together. Product schema omits
offers because the API does not expose currency; no availability, certification,
rating or offer claims are invented. HowTo applies only to actual published steps.
BlogPosting uses the published title, summary, body and publication date.

Private documents remain authenticated by their existing providers and APIs.
They receive noindex without public canonicals or schema. Robots allows crawling
so search engines can read noindex; the sitemap includes only canonical public
routes and published identifiers. No guessed last-modified dates are generated.

## Files

- `server/serve.js`: initial HTML, metadata/crawler responses, icon, status codes.
- `server/web-routes.cjs`: public/private/unknown classification.
- `server/public-content.cjs`: anonymous public data reads and pagination.
- `server/public-rendering.cjs`: escaped content, metadata, sitemap and schema.
- `data/public-pages.json`: shared static summaries.
- `hooks/usePublicWebDocument.ts`, `app/_layout.tsx`: browser-only metadata changes
  on client navigation and initial-document handoff; native behavior unchanged.
- `scripts/build.js` and focused build helpers: publish verified PNG, retain
  versioned assets and archive prior native manifests for rollback.
- `artifacts/api-server/src/routes/uc.ts`: published-only public catalogue request.
- `lib/api-zod/src/blog-inline-links*`: preserve one shared article-link parser.
- Unit, production-server fixture and browser regression tests.

## Rollout and rollback

Public rendering is off by default. Enabling requires explicit canonical and API
origins, owner approval and the deployment regression checks in the runbook.
No canonical redirect, database, payment, auth, analytics or security-header
change is included. Production build/Lighthouse testing and deployment are not
authorized by implementation approval.

Flag-off restores the previous renderer while retaining language, icon and
private noindex corrections. Versioned assets are retained rather than deleted
on the next build. HTML and metadata remain no-store.

## Verification

Cover all represented public templates; titles, descriptions, canonical/social
URLs, JSON-LD, escaped untrusted data, complete public inventories, 404/503
distinction, private noindex, crawler MIME/status under differing Accept headers,
icon MIME/bytes, direct entries, native manifests, build/version pairing,
flag-off rollback and old-bundle handoff. Desktop and phone browser fixtures
exercise no-JavaScript links and the actual metadata hook.

Authenticated journeys and physical iOS/Android startup remain rollout gates.
No production score improvement is claimed from local fixtures.