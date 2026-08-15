---
name: Parallel task-merge artifacts
description: Failure modes to check after several task agents merge into main at once
---

**Rule:** After a batch of task merges, if `@workspace/db` (or another shared lib) suddenly "has no exported member X", suspect a merge artifact before suspecting the code: (1) duplicate `export * from "./same-file"` lines in `lib/db/src/schema/index.ts` — TypeScript treats the doubled names as ambiguous and silently drops them; (2) stale TS project-reference outputs — fix with `pnpm run typecheck:libs` (runs `tsc --build`) at the repo root.

**Why:** Two task agents both appended the same schema export line; the dedupe + `tsc --build` restored the export. The dev server (tsx, no typecheck) keeps running fine, so only `tsc --noEmit` reveals it.

**How to apply:** On any "no exported member" error right after merges: check the schema index for duplicated lines, then rebuild libs before touching feature code. Merges only land between agent turns (they wait on the workspace lock), so sequence work: low-conflict areas first, yield to release the lock, then build on top of merged state.

**Rule 2 — spliced handler code:** A merge batch can splice fragments of one route handler into another in the same file (undefined variables, "Unexpected catch" syntax errors → server won't build). Recovery: `git log --oneline -- <file>` to find the last good commit, diff it against HEAD to separate corruption from legitimate changes, `git checkout <good> -- <file>`, then re-apply only the legitimate lines (usually tiny — one or two). Never hand-untangle the spliced file.

**Why 2:** A merge spliced M-Pesa callback code into the Paystack webhook and replaced Stripe session-create with session-retrieve; the only legitimate change in that commit's version of the file was a single added parameter.

**Rule 3 — nested .gitignore:** A nested `.gitignore` (e.g. `node_modules/` inside a subdir) overrides parent un-ignore rules, so intentionally tracked files under an ignored dir silently stay uncommitted — verify with `git check-ignore -v`. Also: a merged test can miss its dev-typing dep (e.g. `@types/*` for a runtime package), failing only `tsc --noEmit`.

**Rule 5 — stale generated API clients:** A merged task can update `lib/api-spec/openapi.yaml` and hand-written routes but land without the regenerated orval output, so `@workspace/api-zod` / `@workspace/api-client-react` "has no exported member" errors appear for brand-new endpoint types. Fix: `pnpm run codegen` in `lib/api-spec` (runs orval + `typecheck:libs`), never hand-edit the generated files. Check the spec first — if the schema IS in openapi.yaml, it's stale codegen, not a dropped export.

**Rule 4 — mid-session reverts and replayed stale diffs:** A concurrent task merge can land mid-session and overwrite fixes you already applied to a shared file, or replay a stale diff over another task's identical fix, re-introducing corruption a commit already reverted. Re-run the typecheck immediately before marking a task complete; after a rejected validation, re-diff the file against the last-known-good blob and restore from the sibling task's merged commit if it is the cleaner base.
