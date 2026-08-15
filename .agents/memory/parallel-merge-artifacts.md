---
name: Parallel task-merge artifacts
description: Failure modes to check after several task agents merge into main at once
---

**Rule:** After a batch of task merges, if `@workspace/db` (or another shared lib) suddenly "has no exported member X", suspect a merge artifact before suspecting the code: (1) duplicate `export * from "./same-file"` lines in `lib/db/src/schema/index.ts` — TypeScript treats the doubled names as ambiguous and silently drops them; (2) stale TS project-reference outputs — fix with `pnpm run typecheck:libs` (runs `tsc --build`) at the repo root.

**Why:** Two task agents both appended the same schema export line; the dedupe + `tsc --build` restored the export. The dev server (tsx, no typecheck) keeps running fine, so only `tsc --noEmit` reveals it.

**How to apply:** On any "no exported member" error right after merges: check the schema index for duplicated lines, then rebuild libs before touching feature code. Merges only land between agent turns (they wait on the workspace lock), so sequence work: low-conflict areas first, yield to release the lock, then build on top of merged state.

**Rule 2 — spliced handler code:** A merge batch can splice fragments of one route handler into another in the same file (undefined variables, syntax errors → server won't build). Recovery: `git log --oneline -- <file>` to find the last good commit, diff it against HEAD to separate corruption from legitimate changes, `git checkout <good> -- <file>`, then re-apply only the legitimate lines (usually tiny). Never hand-untangle the spliced file.

**Rule 3 — nested .gitignore:** A nested `.gitignore` (e.g. `node_modules/` inside a subdir) overrides parent un-ignore rules, so intentionally tracked files under an ignored dir silently stay uncommitted — verify with `git check-ignore -v`. Also: a merged test can miss its dev-typing dep (e.g. `@types/*` for a runtime package), failing only `tsc --noEmit`.

- Parallel merges can replay a stale diff over another task's identical fix and re-introduce corruption a commit already reverted; after a rejected validation, re-diff the file against the last-known-good blob and restore from the sibling task's merged commit if it is the cleaner base.
