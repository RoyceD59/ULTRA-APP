---
name: Expo static production routing
description: Non-obvious SDK 57 static-web and custom-host proxy requirements for the Companion production build.
---

When Expo preview API calls appear to fail CORS, verify the configured development API hostname before changing the CORS allowlist.

**Why:** A stale development-only API-domain override pointed to a retired preview hostname returning 404 without CORS headers; the current workspace API already allowed the Expo origin.

**How to apply:** Compare the bundle's configured API origin with the current workspace health endpoint. Correct only the stale development override and restart Metro; do not widen production CORS or change production routing.

SDK 57 Metro bundles can emit direct `/assets/?unstable_path=...` module exports in addition to `httpServerLocation` metadata. A static deployment must rewrite both forms to copied build assets.

**Why:** Rewriting only asset metadata leaves fonts and images requesting Metro-only `/assets` URLs, which return 404 after publication.

**How to apply:** After any Expo/Metro upgrade, inspect a production web bundle for remaining `unstable_path` URLs and verify at least one font and image URL against the static server.

The generated Expo web document must make `html`, `body`, and `#root` full height, and `#root` must be a flex container.

**Why:** React Native Web's flex chain otherwise collapses scroll views to zero height while their controls remain present in the accessibility tree, producing a blank white page.

**How to apply:** Validate production-equivalent deep routes in a real browser and inspect the root/provider/scroll-view dimensions when the DOM exists but nothing paints.

When Cloudflare Workers route custom hostnames to a shared Replit deployment, the normal forwarded-host header can be replaced by Replit's outer proxy. Carry only allowlisted public hostnames in a dedicated header for Clerk's proxy-host calculation.

**Why:** Clerk rejects production requests when the browser origin is the custom hostname but the proxy identifies itself with the generated Replit hostname.

**How to apply:** Keep the edge and API allowlists identical, never accept arbitrary values, and verify Clerk environment/client calls from the custom production origin.

Public Expo domains and the Clerk proxy path must be declared in the artifact's production build environment, and an explicit public domain must take precedence over Replit's injected internal hostname. Run production Metro with a cleared transform cache.

**Why:** Publish builds do not inherit development-only variables. Metro can also reuse a transform where an `EXPO_PUBLIC_*` value was previously absent, leaving that compiled constant `undefined` even after the build environment supplies it.

**How to apply:** Keep public build variables in the validated artifact configuration, use Metro's cache-clear option for production builds, and inspect the compiled root-layout constant—not just build logs—when changing Clerk proxy settings.

Replit's static screenshot helper can capture an all-white Expo web page before a large development Metro bundle finishes painting, even when React later mounts without errors.

**Why:** The Companion's direct deep route repeatedly looked blank in static captures while a real browser, after the bundle was warm, showed a populated non-zero root and the complete screen.

**How to apply:** Before treating a blank Expo screenshot as an app failure, confirm the generated entry-bundle URL returns JavaScript, check for the `Running application "main"` log, and use a real browser test to inspect the DOM and computed root dimensions.

When manually rebuilding the committed static bundle, use the production artifact's entire build environment, including its route prefix, rather than a development-domain substitute.

**Why:** A build can succeed and remove stale UI strings while embedding development API/asset origins or missing the production path prefix, leaving its checked-in output unusable after publishing.

**How to apply:** Read the validated artifact production build settings before a manual regeneration, then confirm generated web/native bundles use the intended API origin and prefixed asset URLs.

An assigned task's checkout can lag the published Companion implementation. Verify both the deployed build and its canonical browser origin before diagnosing a live failure from local source.

**Why:** A live browser audit exposed blog screens absent from the task checkout; the deployment alias also produced cross-origin errors against APIs configured for the custom app domain.

**How to apply:** Obtain deployment metadata, compare public build identifiers and available merged source, and distinguish canonical-domain failures from alias-only failures. Do not infer that a CMS feature is missing merely because it is absent from an older task checkout.

The supported published Companion browser origin is the custom app domain. Browser entry from the shared deployment alias should lead there, rather than widening production API CORS to accommodate the alias.

**Why:** Public API and asset delivery are configured for the custom domain, while the deployment alias shares its root with ProjectHub. Allowing the alias alone does not resolve root-route collisions or cross-origin assets.

**How to apply:** Preserve browser routes and query parameters when directing visitors to the custom app domain; keep native manifests, assets and development previews out of browser-only redirects. Do not hijack ProjectHub's shared-root routes.

Run manual noninteractive production packaging with `CI=1` while the development
Metro workflow is running.

**Why:** A second watch-mode Metro instance exhausted the shared container's
inotify watcher budget even after leftover pnpm staging packages were removed.
Expo's CI mode disables file watching without disabling production bundling.

**How to apply:** Include `CI=1` in the packaging command rather than raising
system limits or changing application source for a host resource-limit failure.