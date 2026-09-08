---
name: Drizzle post-merge false success
description: Non-interactive Drizzle pushes can report success despite skipping schema changes after a prompt failure.
---

**Rule:** A post-merge `drizzle-kit push --force` must treat `Interactive prompts require a TTY` in combined output as failure even when the command exits with status 0. Never feed automatic approval to a truncation prompt.

**Why:** Drizzle can discover a constraint/index representation mismatch, propose truncating populated tables, print a non-TTY exception, and still return exit code 0. A shell using only `set -e` then continues through codegen and falsely reports successful reconciliation.

**How to apply:** Capture combined push output, check both exit status and the prompt-error text, and fail loudly on either. Before changing data, compare the Drizzle declaration with the existing database object: an equivalent named unique index should be represented as `uniqueIndex`, including its partial predicate, rather than as column-level `.unique()`.