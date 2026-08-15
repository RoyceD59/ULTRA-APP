---
name: Image derivative pipeline quirks
description: sharp-on-pnpm install quirk and the disposable tmpdir derivative cache convention for resized images.
---

# Image derivative pipeline quirks

## sharp installs fine despite pnpm "approve-builds" warning
`pnpm add sharp` (pnpm 10) blocks sharp's postinstall script and prints an
"approve-builds" warning — this is harmless. sharp ≥0.33 ships prebuilt
binaries as `@img/*` optionalDependencies, so it loads without any build
script. Verify with `node -e "require('sharp')"` instead of approving builds.
**Why:** first install looked failed (installLanguagePackages callback also
reported failure); the pnpm CLI + verification is the working path.
**How to apply:** any future native-binary package on pnpm — check whether
prebuilt optional deps make the blocked postinstall irrelevant before
approving builds. build.mjs already externalizes sharp for esbuild.

## Derivative caches are disposable per-instance
Resized image derivatives (catalogue + upload thumbnails) cache in
`os.tmpdir()` and are regenerated after restart/redeploy by design — never
try to persist them, and never make image serving depend on cache presence:
every resize path must fall through to the original bytes on any failure.
**Why:** images must never fail to load because resizing failed; tmp storage
is per-replica and cleared on deploys.

## Remote (WooCommerce/CDN) originals must be rewritten to the proxy
WC product payloads carry raw CDN URLs to multi-megapixel originals; the
client resize helper only recognises local `/api/uc/product-images/...`
paths, so any unrewritten src silently downloads full-size photos again.
**Why:** the invariant lives server-side (normalize → proxy path), and any
server proxy fetching remote URLs here must re-validate the host allow-list
on every redirect hop and bound bytes/concurrency/cache — `redirect:
"follow"` plus unbounded buffering was flagged as a critical SSRF/DoS combo.
