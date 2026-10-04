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
- For long runs, use managed validation or the tool's supported background-task mode and collect its result before finishing. Do not rely on shell-detached `nohup`/`setsid` processes.

Per-run database isolation does not isolate test identities between files in that run.

**Why:** Fixed customer IDs inherited other suites' deleted-account state, causing a signed push-auth test to return 401 instead of its expected no-token 404.

**How to apply:** Use suite-owned identities and clean up only owned rows. Never assume small fixed user IDs are unused merely because the database is temporary.

Broad retention-job tests must isolate the table they prune, not just their fixture IDs.

**Why:** The per-run database is shared across test files; a real global DELETE can remove another suite's old fixtures even when each suite owns different IDs.

**How to apply:** Use a transaction-local temporary table that shadows the target table and route the production queries to that connection. Keep the real SQL predicates, inject deterministic time/settings, and roll back afterward.
