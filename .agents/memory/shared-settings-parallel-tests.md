---
name: Shared settings in parallel tests
description: How to avoid cross-file races from global settings and environment state in API tests.
---

API tests sharing one per-run database must not let unit tests depend on the singleton `team_settings` row or mutable process environment. Inject a settings reader, time source, and side-effect adapter; retain a separate integration test for the real database route.

**Why:** Parallel files can temporarily configure the singleton for integration coverage, causing unrelated policy tests to inherit wrong values and fail intermittently.

**How to apply:** Keep production defaults in the implementation. In unit tests, pass in-memory dependencies and explicit configuration so policy assertions remain deterministic under the full suite.