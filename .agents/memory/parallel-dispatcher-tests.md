---
name: Parallel dispatcher tests
description: How to keep broad scheduled-dispatch tests independent under file concurrency.
---

Scheduled dispatcher tests must inject provider calls and shared configuration instead of changing process globals or singleton rows. They must also scope each dispatch to the test's own recipient records.

**Why:** Parallel test files can share one isolated database. Even after global fetch and environment mutations are removed, an unscoped dispatcher scans rows seeded by other workers and makes counters and summaries nondeterministic.

**How to apply:** For tests of broad scheduled jobs, provide per-call dependencies for external providers and mutable settings, and use an explicit record or recipient scope. Keep production calls on the default unscoped dependencies.

Tests of a dispatcher protected by one global database advisory lock must not run in parallel across files, even when product fixtures are disjoint.

**Why:** A worker holding the real lock makes another file's job correctly skip, which looks like a test failure rather than independent test execution.

**How to apply:** Put suites exercising the same global job lock in the test runner's serial shared-state phase. Preserve actual overlapping calls inside individual coordination tests.