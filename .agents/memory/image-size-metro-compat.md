---
name: image-size Metro compatibility
description: image-size 2.x breaks Metro PNG asset processing; keep 1.x with targeted parser security backports until Metro upgrades.
---

## Rule
Do NOT add a pnpm override that forces `image-size` to 2.x while the project uses Expo/Metro. Backport parser security fixes to the pinned 1.x package instead.

**Why:** Metro's `Assets.js` calls `imageSize(buffer)` synchronously. Image-size 2.x builds a `new DataView(input.buffer, input.byteOffset + offset)` internally. Node.js Buffers from the shared allocator pool have a non-zero `byteOffset`, and for tiny PNG files (< ~200 bytes, e.g. `expo-router/assets/file.png` at 138 B) this pushes the DataView start past the ArrayBuffer's bounds. Node.js throws "The 'list' argument must be an instance of SharedArrayBuffer, ArrayBuffer or ArrayBufferView", which Metro surfaces as a SyntaxError at ~89% through the iOS bundle. The failure appears in the build script as "Download failed: HTTP 500" because the build.js script fetches bundles over Metro's local HTTP server, which returns 500 when the transform crashes.

**How to apply:** If a security scanner flags `image-size@1.2.1`, keep targeted backports for both zero-length parser loops:
- JXL/HEIF box traversal must always advance on a zero-sized box.
- ICNS entry traversal must advance by at least the eight-byte entry header.

Document the residual version-based scanner finding as patched locally:
- No 1.x patch release exists on npm (last is 1.2.1).
- Published 2.x releases through 2.0.2 are also affected, so upgrading does not resolve the advisories.
- Revisit when metro ships a version that no longer depends on image-size or upgrades to a compatible 2.x.
