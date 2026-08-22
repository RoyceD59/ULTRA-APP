---
name: PNPM patched dependency validation
description: How to verify a pnpm patched dependency without accidentally loading its retained unpatched virtual-store copy.
---

## Rule

When testing a pnpm `patchedDependencies` fix, resolve the package from a consuming project or explicitly target the lockfile's `patch_hash` virtual-store instance. Do not use the first package path returned by a broad filesystem search.

**Why:** pnpm retains the original package copy beside the patched copy. A broad lookup can load the original code, reproduce a fixed vulnerability, and make a valid patch appear ineffective.

**How to apply:** Confirm the patch marker in the hash-qualified installed source, then run the regression fixture against that exact path. Keep the patch file and the lockfile's `patchedDependencies` entry together.