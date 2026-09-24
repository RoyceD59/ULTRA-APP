---
name: OpenAPI URI codegen compatibility
description: URI-format OpenAPI schemas can generate code incompatible with the workspace's runtime Zod version.
---

When adding URL fields to the OpenAPI contract, check the generated Zod module for standalone `zod.url()` and verify that importing it works with the workspace's installed Zod. If incompatible, use a supported schema shape and keep strict URL checks at the API boundary.

**Why:** A URI-format field generated a `zod.url()` call that typechecking accepted, but runtime module import failed and broke unrelated API tests.

**How to apply:** After API codegen involving URI fields, verify the generated module can load and run the focused API tests before relying on typecheck alone.