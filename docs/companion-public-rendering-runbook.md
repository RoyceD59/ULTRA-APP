# Companion public-rendering rollout

## Current state

Implementation is available but public rendering is **off by default**. No
deployment, canonical-host redirect change, production benchmark or customer
mutation has been performed. The supported Companion hostname already appears
in the existing browser/Cloudflare configuration; this work does not select or
change it.

## Configuration and owner approval

Before rollout, confirm the canonical Companion origin with the owner, then set
these non-secret production environment variables using the workspace environment
configuration:

- `PUBLIC_WEB_RENDERING_ENABLED=true`
- `PUBLIC_WEB_CANONICAL_ORIGIN`: approved HTTPS origin only, without a path,
  credentials, query or fragment.
- `PUBLIC_WEB_API_ORIGIN`: authoritative API HTTP(S) origin only, without a path,
  credentials, query or fragment. Public production delivery should use HTTPS.

Do not use forwarded Host headers or development domains as canonical origins.
`BASE_PATH` still controls upstream local navigation/asset paths, not canonicals.
The existing Cloudflare Companion routing removes the artifact prefix for public
browser URLs; no Worker changes are needed for crawler documents or the icon.
With the flag enabled, missing/invalid origin configuration fails startup
explicitly. No secrets are needed by the public data adapter.

The API must support `publicationSafe=true` and return
`X-UC-Catalogue-Provenance: woocommerce-published`. Missing WooCommerce
configuration returns 503/no-store in this mode. An old API or demo catalogue
without this provenance is rejected, never indexed. The ordinary interactive
app's fallback catalogue remains unchanged.

## Pre-release checks

1. Build with the artifact's complete production environment and cleared Metro
   cache. Retain the current deployment and build configuration.
2. Record revision, build ID and canonical hostname. Confirm `/version.json`
   identifies the same script version served in document HTML.
3. Fetch raw HTML for `/`, `/products`, an existing catalogue product, `/blog`,
   a published article, `/support`, a published guide, `/map`, `/about`,
   `/water-test` and `/enquiry`. Verify visible content, unique titles,
   descriptions, HTTPS canonical/social URLs, H1, links, lang and JSON-LD.
4. Check nonexistent/unpublished product, article and guide URLs return 404;
   an API outage returns 503/no-store, not an indexable empty response.
5. Request `/robots.txt` and `/sitemap.xml` with HTML and non-HTML Accept.
   Validate XML/MIME/status, public-only inventory and absolute sitemap URL.
   Verify `/favicon.png` returns the brand PNG.
6. Validate schema against verified visible data. Product offers are deliberately
   omitted until authoritative currency and offer fields exist.
7. Exercise signed-out and signed-in startup, login/register/invite, password
   recovery/change, product registration, cart quantities and totals, COD,
   M-Pesa, Paystack initiation/return/callback reconciliation, rewards/QR,
   orders, profile and ProjectHub synchronization without changing analytics.
8. Test actual iOS/Android manifests, startup/splash and deep links; test browser
   cold direct entries, back/forward navigation, slow/failed JS, public-to-private
   metadata changes, keyboard behavior, and both desktop/mobile layouts.
9. Capture an authorized production baseline and three cold-cache mobile/desktop
   runs per representative template. Report medians and variation. Historical
   Lighthouse values are not results for this implementation.

## Rollback

Set `PUBLIC_WEB_RENDERING_ENABLED=false` and restart/redeploy the previous known-
good renderer if content parity, native delivery, auth or payments regress.
No database migration is required. Keep the known-good deployment and its
configuration available.

New builds no longer delete versioned JS/font/image directories. The build helper
archives valid legacy root manifests beneath their referenced build ID, but
**never overwrites those live root manifests**. New native manifests are staged
exclusively inside the new release directory. Until activation, a legacy
no-pointer server therefore keeps both native platforms and the browser on the
old release, including if staging fails partway through. Completed builds atomically publish
`static-build/active-build.json` **last**, after all bundles, assets, build
metadata and per-build native manifests exist. Running servers re-read this
pointer, selecting the same release for HTML, `/version.json` and native
manifests while old assets remain fetchable. Partial builds do not activate.

Restore the matching old code/configuration and active build together. To select
a retained, completed build with this server, run the checked activation helper:

```sh
cd artifacts/uc-companion
node -e "require('./scripts/active-static-build.cjs').activateStaticBuild(process.cwd(), process.argv[1])" APPROVED_BUILD_ID
```

Legacy releases may lack per-build native bundles/manifests. For those, restore
the complete known-good deployment/configuration rather than bypassing the
activation checks. Do not mix HTML with a different build's script or release
metadata. Do not delete the active pointer to force an unverified newest scan.

Only retire old build directories after the rollback window and in-flight clients
are safe. Disk cleanup is an owner-controlled operation, not part of SEO rollout.
Purge only affected public caches; private/customer APIs must remain no-store.
Verify analytics and protected flows after rollback, not just the visible page.

## Local checks

From the workspace root:

```sh
pnpm run typecheck:libs
pnpm --filter @workspace/uc-companion run typecheck
pnpm --filter @workspace/api-server run typecheck
cd artifacts/uc-companion
node --test scripts/__tests__/public-rendering.test.mjs scripts/__tests__/serve-public.test.mjs scripts/__tests__/public-web-browser.test.mjs scripts/__tests__/serve.test.mjs scripts/__tests__/serve-deep-links.test.mjs scripts/__tests__/browser-entry.test.mjs
```

The browser fixture requires workspace Chromium and `@playwright/test`; it runs
the actual browser metadata hook against isolated public API fixtures. It is not
a replacement for authenticated, physical-device or production checks.