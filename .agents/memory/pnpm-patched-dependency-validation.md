---
name: PNPM patched dependency validation
description: How to verify a pnpm patched dependency without accidentally loading its retained unpatched virtual-store copy.
---

## Rule

When testing a pnpm `patchedDependencies` fix, resolve the package from a consuming project or explicitly target the lockfile's `patch_hash` virtual-store instance. Do not use the first package path returned by a broad filesystem search.

**Why:** pnpm retains the original package copy beside the patched copy. A broad lookup can load the original code, reproduce a fixed vulnerability, and make a valid patch appear ineffective.

**How to apply:** Confirm the patch marker in the hash-qualified installed source, then run the regression fixture against that exact path. Keep the patch file and the lockfile's `patchedDependencies` entry together.

A successful frozen install and a hash-qualified path do not certify that the
patch code was applied in a fresh release stage.

**Why:** A new isolated stage resolved a hash-qualified cache library but lacked
its guard, while the unchanged parent and main consumers contained it. Version
scans and installation success alone would have missed this safety failure.

**How to apply:** Validate marker presence and security behavior in a fresh
installation, not only a warmed development/parent cache. Block release on any
discrepancy; do not relax the regression or manually edit installed code to
manufacture a passing result.

Generate multi-file patches with `pnpm patch` and `pnpm patch-commit`, and verify
behavior through real consumers after installing; a patch hash alone is not
proof that every file was modified.

**Why:** A hand-authored multi-file patch produced a hash-qualified installation
whose source remained unchanged, while a package-manager-generated patch
installed correctly. Regression tests caught the ineffective installation.

**How to apply:** Prefer the package manager's patch generator over manually
counted diff hunks, and keep an attack fixture for each locally patched advisory.

A frozen install can preserve an already-cached, inactive backport even in a
hash-qualified directory; a correct lockfile alone does not prove runtime safety.

**Why:** Actual-consumer regression fixtures failed in main despite matching
patch-hash directory names; a forced frozen reinstall restored the existing
backports without changing their source or declared package versions.

**How to apply:** If those regressions fail, inspect installed guards first and
refresh the frozen installation rather than weakening fixtures or silently
editing node_modules. Execute real-consumer checks again during release build
preparation so cache reuse cannot bypass security verification.