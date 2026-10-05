---
name: OpenAPI string-format codegen compatibility
description: URI and email OpenAPI formats can generate code incompatible with the workspace's runtime Zod version.
---

When adding URL or email fields to the OpenAPI contract, check the generated Zod module for standalone format constructors and verify that importing it works with the workspace's installed Zod. If incompatible, use a supported string/pattern schema and keep strict validation at the API boundary.

**Why:** Both URI and email formats have generated standalone constructors that typechecking accepted but the installed runtime did not provide, breaking unrelated API imports.

**How to apply:** After API codegen involving URI fields, verify the generated module can load and run the focused API tests before relying on typecheck alone.

Generated constraint constants must also be initialized before eager schema construction. Keep ordering fixes in the codegen postprocessor, not only in generated output, and verify a runtime API import after regeneration.

**Why:** Consumer typechecks and earlier test runs did not establish that the committed generated module was safe; a later full library check found declaration-order failures that prevented unrelated API routes from loading.

**How to apply:** Pair codegen with the shared-library check and a runtime import smoke check whenever adding bounded or patterned schemas. Source-text insertion must preserve regex literals rather than interpreting replacement-string metacharacters.