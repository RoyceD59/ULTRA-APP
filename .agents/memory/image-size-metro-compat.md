---
name: image-size Metro compatibility
description: image-size 2.x breaks Metro PNG asset processing — must stay on 1.x until Metro upgrades.
---

## Rule
Do NOT add a pnpm override that forces `image-size` to 2.x while the project uses Expo/Metro.

**Why:** Metro's `Assets.js` calls `imageSize(buffer)` synchronously. Image-size 2.x builds a `new DataView(input.buffer, input.byteOffset + offset)` internally. Node.js Buffers from the shared allocator pool have a non-zero `byteOffset`, and for tiny PNG files (< ~200 bytes, e.g. `expo-router/assets/file.png` at 138 B) this pushes the DataView start past the ArrayBuffer's bounds. Node.js throws "The 'list' argument must be an instance of SharedArrayBuffer, ArrayBuffer or ArrayBufferView", which Metro surfaces as a SyntaxError at ~89% through the iOS bundle. The failure appears in the build script as "Download failed: HTTP 500" because the build.js script fetches bundles over Metro's local HTTP server, which returns 500 when the transform crashes.

**How to apply:** If a security scanner flags `image-size@1.2.1 (CVE-2025-71329)`, document it as an accepted-risk transitive dependency:
- No 1.x patch release exists on npm (last is 1.2.1).
- metro@latest (0.87.0) still pins `image-size: '^1.0.2'`, confirming the ecosystem has not migrated.
- Revisit when metro ships a version that no longer depends on image-size or upgrades to a compatible 2.x.
