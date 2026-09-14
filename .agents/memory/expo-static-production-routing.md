---
name: Expo static production routing
description: Non-obvious SDK 57 static-web and custom-host proxy requirements for the Companion production build.
---

SDK 57 Metro bundles can emit direct `/assets/?unstable_path=...` module exports in addition to `httpServerLocation` metadata. A static deployment must rewrite both forms to copied build assets.

**Why:** Rewriting only asset metadata leaves fonts and images requesting Metro-only `/assets` URLs, which return 404 after publication.

**How to apply:** After any Expo/Metro upgrade, inspect a production web bundle for remaining `unstable_path` URLs and verify at least one font and image URL against the static server.

The generated Expo web document must make `html`, `body`, and `#root` full height, and `#root` must be a flex container.

**Why:** React Native Web's flex chain otherwise collapses scroll views to zero height while their controls remain present in the accessibility tree, producing a blank white page.

**How to apply:** Validate production-equivalent deep routes in a real browser and inspect the root/provider/scroll-view dimensions when the DOM exists but nothing paints.

When Cloudflare Workers route custom hostnames to a shared Replit deployment, the normal forwarded-host header can be replaced by Replit's outer proxy. Carry only allowlisted public hostnames in a dedicated header for Clerk's proxy-host calculation.

**Why:** Clerk rejects production requests when the browser origin is the custom hostname but the proxy identifies itself with the generated Replit hostname.

**How to apply:** Keep the edge and API allowlists identical, never accept arbitrary values, and verify Clerk environment/client calls from the custom production origin.