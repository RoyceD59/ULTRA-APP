---
name: OpenAPI integer validation
description: Generated query validators can coerce numbers without enforcing integer semantics.
---

Do not assume an OpenAPI `type: integer` query produces an integer-only runtime
validator. Check the generated validator and explicitly reject fractional or
unsafe pagination values at the HTTP boundary when necessary.

**Why:** The workspace's Orval generation emitted numeric coercion with minimum
and maximum constraints but no integer check. A fractional page passed validation
and reached PostgreSQL as an invalid OFFSET, returning a server error.

**How to apply:** Whenever adding numeric identifiers or pagination parameters,
include fractional-value regression checks alongside lower and upper bounds.
Keep fixes outside generated files so regeneration cannot erase the protection.