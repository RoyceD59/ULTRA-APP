---
name: API server data-folder resolution
description: How the api-server durable data folder (accounts/tickets/water-tests JSONL) must be resolved so it works from both the esbuild bundle and tsx tests.
---

The API server's durable folder is `artifacts/api-server/data/` (accounts.jsonl, tickets.jsonl, water-tests.jsonl, impact-override.json, accounts-backfill.done marker).

**Rule:** never compute the data dir with a fixed `../..` hop count from `import.meta.url`. The server runs two ways with different module depths:
- dev/prod: esbuild bundle at `dist/index.mjs` → data is `../data`
- tests: tsx from `src/...` → data is `../../data`

`src/lib/account-records.ts` owns resolution (`ACCOUNT_DATA_DIR`): it probes both relative candidates for an existing dir, with the `UC_ACCOUNTS_DATA_DIR` env var as a test seam (must be set before module import). All other code should import that constant instead of re-deriving paths.

**Why:** a previous fixed-depth computation silently pointed at a nonexistent workspace-root `data/`, so JSONL backups were written nowhere for weeks with no error (appends were fire-and-forget).

**How to apply:** any new durable file under `data/` goes through `ACCOUNT_DATA_DIR`; keep account records sanitized via the explicit allow-list types there (never spread DB rows/request bodies — `authProvider: "password"` is a legitimate *value*, so sanitization checks must look at keys, not substrings).
