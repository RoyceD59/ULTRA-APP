---
name: pnpm workspace-state validation race
description: Distinguish package-manager workspace-state parsing failures from source type errors.
---

An “Unexpected end of JSON input” error in pnpm's `loadWorkspaceState` during
parallel validation is not evidence of a TypeScript source defect.

**Why:** One workspace typecheck command failed before its compiler ran, while
the parallel commands passed. The identical command then passed serially without
any code changes.

**How to apply:** Inspect the failure stack and retry the exact failed command
once in isolation before editing source or reinstalling dependencies. If the
failure persists, investigate workspace-state generation and concurrent pnpm
writes rather than bypassing validation.