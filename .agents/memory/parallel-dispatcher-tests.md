---
name: Parallel dispatcher tests
description: How to keep broad scheduled-dispatch tests independent under file concurrency.
---

Scheduled dispatcher tests must inject provider calls and shared configuration instead of changing process globals or singleton rows. They must also scope each dispatch to the test's own recipient records.

**Why:** Parallel test files can share one isolated database. Even after global fetch and environment mutations are removed, an unscoped dispatcher scans rows seeded by other workers and makes counters and summaries nondeterministic.

**How to apply:** For tests of broad scheduled jobs, provide per-call dependencies for external providers and mutable settings, and use an explicit record or recipient scope. Keep production calls on the default unscoped dependencies.