---
name: API test-DB isolation
description: How api-server tests isolate from the live dev database, and the drizzle-kit constraints that shaped it
---

**Rule:** The api-server test wrapper (`src/tests/run.ts`) isolates each run in a per-run **database** (`test_api_<ts>_<pid>`), not a schema. `CREATE DATABASE` is allowed on the Replit Postgres. Cleanup validates names against `^test_api_\d+_\d+$` (regex, not LIKE — `_` in LIKE is a wildcard) before `DROP DATABASE ... WITH (FORCE)`.

**Why:** The original approach (per-run schema + `options=-c search_path=...`) is fundamentally broken: `drizzle-kit push` always introspects/diffs the **public schema of the connected database**, while its data-loss count queries run under the search_path — so any drift between live `public` and the schema files makes push die with "relation does not exist", leaving an empty test schema and hundreds of cancelled tests. `schemaFilter` doesn't help (unqualified pgTables are excluded entirely → push does nothing).

**How to apply:**
- If api tests suddenly fail en masse with "relation X does not exist", check whether `public` drifted from `lib/db/src/schema/` — any table/column created only by raw SQL (e.g. the api-server's startup migrations in `src/index.ts`) must have a matching Drizzle schema file, or push-based flows break. `uc_return_requests` was the first such case.
- `TEST_GLOB='src/tests/foo.test.ts' pnpm test` runs a subset inside the same isolation.
- Never execute an API test file directly with `tsx --test`: it inherits the development `DATABASE_URL`, and destructive failure-injection tests can mutate live development tables. Always enter through the package test wrapper, including focused runs.
- The full suite exceeds the 300s shell cap; run it via the validation mechanism (registered command `api-tests`), not a raw shell call. Backgrounded (`nohup`/`setsid`) shell processes get killed when the tool call returns — don't rely on them.
