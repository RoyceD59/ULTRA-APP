---
name: OpenAPI URI codegen compatibility
description: URI-format OpenAPI schemas can generate code incompatible with the workspace's runtime Zod version.
---

When adding URL fields to the OpenAPI contract, check the generated Zod module for standalone `zod.url()` and verify that importing it works with the workspace's installed Zod. If incompatible, use a supported schema shape and keep strict URL checks at the API boundary.

**Why:** A URI-format field generated a `zod.url()` call that typechecking accepted, but runtime module import failed and broke unrelated API tests.

**How to apply:** After API codegen involving URI fields, verify the generated module can load and run the focused API tests before relying on typecheck alone.

Generated constraint constants must also be initialized before eager schema construction. Keep ordering fixes in the codegen postprocessor, not only in generated output, and verify a runtime API import after regeneration.

**Why:** Consumer typechecks and earlier test runs did not establish that the committed generated module was safe; a later full library check found declaration-order failures that prevented unrelated API routes from loading.

**How to apply:** Pair codegen with the shared-library check and a runtime import smoke check whenever adding bounded or patterned schemas. Source-text insertion must preserve regex literals rather than interpreting replacement-string metacharacters.