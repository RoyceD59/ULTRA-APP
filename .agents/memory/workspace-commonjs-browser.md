---
name: Workspace CommonJS browser imports
description: Why typed shared CommonJS helpers can pass server checks but fail in Vite previews
---

A typed workspace wrapper around a CommonJS helper does not establish that its named exports will work in the browser. Linked workspace modules can bypass Vite's dependency optimization and arrive as raw CommonJS.

**Why:** ProjectHub passed type checks and server-oriented tests but failed to render with a missing named export from a raw shared CommonJS helper.

**How to apply:** Prefer browser-compatible ESM for new shared helpers. When retaining an existing CommonJS implementation, prebundle its workspace wrapper in Vite and verify an actual browser import; type declarations alone are insufficient.