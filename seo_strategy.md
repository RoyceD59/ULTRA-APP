# SEO Strategy

## In scope
- Task 851: Ultra-Clear Companion's publicly accessible browser routes: `/`, `/products`, `/product/:id`, `/blog`, `/blog/:slug`, `/about`, `/enquiry`, `/water-test`, `/map`, `/support`, and `/guide/:id`.
- Source-detectable WCAG 2.2 A/AA issues on public web content; verify previously seeded ProjectHub authentication findings.
- Native-only screens are not SEO surfaces. The Companion artifact is mobile-labelled but its standalone server serves a public browser SPA.

## Out of scope
- Indexing login/registration, password recovery, customer account, product registration, rewards/QR, order history, cart/checkout, payment callbacks, admin, and all ProjectHub internal routes.
- The WooCommerce/marketing site at `www.ucfilters.com` is external; its homepage/replacement-filter/FAQ/evidence templates cannot be audited without their source.
- Design previews, API endpoint SEO, database mutations and live audits.

## Target audience and topics
- Kenyan customers seeking Ultra-Clear water filters, replacement guidance, water testing, refill locations, product information and educational articles.
- ProjectHub remains an internal team operations application, not a public marketing property.

## Crawler assumptions
- Public product/editorial content should be discoverable by search, social preview and AI retrieval crawlers without login or interaction.
- Google can render JavaScript, but an empty SPA shell delays content access; social/AI crawlers generally cannot render it.
- Source references identify `app.ucfilters.com` as the Companion browser origin; verify ownership/canonical destination before implementation.
- Cloudflare router code does not establish dashboard bot-blocking settings; review them manually rather than assume blocking.
- Private and transactional pages should remain nonindexable; no recommendation to expose personal data or remove authentication guards.

## Dismissed categories
- (None yet)

## Measurement limits
- Task-provided Lighthouse numbers are historical laboratory inputs, not newly verified results. No field data available.
- This scan is source-only: no server starts, new builds, Lighthouse, browser audits or live requests. LCP element identity, timing breakdown, transfer size, unused-code coverage, actual headers/statuses and runtime errors require separately authorized production testing.
