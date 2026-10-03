---
name: PNPM patched dependency validation
description: How to verify a pnpm patched dependency without accidentally loading its retained unpatched virtual-store copy.
---

## Rule

When testing a pnpm `patchedDependencies` fix, resolve the package from a consuming project or explicitly target the lockfile's `patch_hash` virtual-store instance. Do not use the first package path returned by a broad filesystem search.

**Why:** pnpm retains the original package copy beside the patched copy. A broad lookup can load the original code, reproduce a fixed vulnerability, and make a valid patch appear ineffective.

**How to apply:** Confirm the patch marker in the hash-qualified installed source, then run the regression fixture against that exact path. Keep the patch file and the lockfile's `patchedDependencies` entry together.

Generate multi-file patches with `pnpm patch` and `pnpm patch-commit`, and verify
behavior through real consumers after installing; a patch hash alone is not
proof that every file was modified.

**Why:** A hand-authored multi-file patch produced a hash-qualified installation
whose source remained unchanged, while a package-manager-generated patch
installed correctly. Regression tests caught the ineffective installation.

**How to apply:** Prefer the package manager's patch generator over manually
counted diff hunks, and keep an attack fixture for each locally patched advisory.