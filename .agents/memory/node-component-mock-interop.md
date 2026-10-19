---
name: Node component mock interop
description: Reliable test mocks when TSX component requires cross Node CJS/ESM boundaries.
---

Use physical plain-ESM fixtures with explicit named exports for synchronous
component mocks when data-URL or reexport-based mocks fail.

**Why:** In this workspace, tsx's CJS loading path attempted to read data-URL
mocks as filesystem paths even after preimporting them. Star reexports also
failed named-export inference. Explicit exports in a plain ESM fixture avoided
both failures; the app itself was not broken.

**How to apply:** Diagnose mock resolution before changing production imports.
Keep the fixture local to the affected tests instead of broadening shared mocks
or treating Node-only CJS default wrappers as native/browser behavior.