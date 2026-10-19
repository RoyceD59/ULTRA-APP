---
name: Orval output isolation
description: Non-obvious workspace barrel and indexFiles behavior when adding filtered public clients.
---

Give additional filtered Orval clients their own generation workspace. Do not
point multiple generated clients at a shared manually maintained public barrel.

**Why:** Orval automatically appends each workspace's implementation and schema
exports to its index. A second filtered client in the same workspace silently
adds duplicate exports and exposes the broad graph again. In Orval 8.22,
disabling `indexFiles` on a split client with inline schemas also changes imports
to individual schema paths that are not emitted; it is not a safe way to disable
only the workspace barrel.

**How to apply:** A manually maintained public index can be preserved by using
an absolute output target without `workspace` for that output. Keep additional
filtered output in a separate workspace. Verify regeneration leaves public
exports stable and compare generated contracts before relying on subpaths.