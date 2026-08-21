---
name: API test storage isolation
description: Keeping ProjectHub library storage tests reliable under parallel Node test execution.
---

Tests that exercise storage-backed library routes must inject a local storage adapter into the router rather than patching `ObjectStorageService.prototype`.

**Why:** Node test files run concurrently. Prototype mocks are process-global and can be overwritten by another test file, producing nondeterministic timeouts and false negatives.

**How to apply:** Add explicit dependency seams at route construction boundaries for external services. Use an isolated fake per test file, leaving production defaults at the export boundary.