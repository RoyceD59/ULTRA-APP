---
name: Parallel task-merge artifacts
description: Failure modes to check after several task agents merge into main at once
---

**Rule:** After a batch of task merges, if `@workspace/db` (or another shared lib) suddenly "has no exported member X", suspect a merge artifact before suspecting the code: (1) duplicate `export * from "./same-file"` lines in `lib/db/src/schema/index.ts` — TypeScript treats the doubled names as ambiguous and silently drops them; (2) stale TS project-reference outputs — fix with `pnpm run typecheck:libs` (runs `tsc --build`) at the repo root.

**Why:** Two task agents both appended the same schema export line; the dedupe + `tsc --build` restored the export. The dev server (tsx, no typecheck) keeps running fine, so only `tsc --noEmit` reveals it.

**How to apply:** On any "no exported member" error right after merges: check the schema index for duplicated lines, then rebuild libs before touching feature code. Merges only land between agent turns (they wait on the workspace lock), so sequence work: low-conflict areas first, yield to release the lock, then build on top of merged state.
