---
name: Shared library typecheck freshness
description: Distinguishing stale referenced declarations from real API and web type errors.
---

Consumer typechecks must use fresh shared-library declarations after schema or generated API changes.

**Why:** TypeScript project references can resolve stale declaration output even when package exports point at source. This produced missing-member errors in unrelated consumers despite the definitions already being present in source.

**How to apply:** If a consumer reports a missing export or DB field, verify the source first. When the definition exists, run the workspace library typecheck/build before checking API and web consumers; do not edit correct consumer code to accommodate stale declarations.