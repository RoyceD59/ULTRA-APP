# Git ignore record

This file and `development-change-log.md` are tracked by Git. `.gitignore`
excludes private or reproducible runtime files, not the development history.

## Release-preparation exclusions — 2026-10-05

| Pattern | Reason | Tracked evidence |
| --- | --- | --- |
| `.hydrate-release/` | Generated predecessor staging and dependency installation | Frozen archive and release manifest under `infra/cloudflare/forest/` |
| `.companion-consistency-release/` | Disposable source preparation, tests and local compilation | Exact saved candidate under `infra/cloudflare/forest/approved-consistency/` |
| `.consistency-build/` | Checksum-specific build outputs, locks, dependencies and local reports | Candidate checksum, tests and build results in the consistency release document |
| `artifacts/uc-companion/static-build/` | Generated browser/Expo Go assets; retain operational rollback copies outside Git | Selected IDs and bundle checksums in release evidence |
| `artifacts/api-server/data/` | Runtime customer records; never commit personal data | Sanitized aggregate findings only |
| `.env`, `.env.*` | Secrets must never enter version history | `.env.example` may describe required keys without values |

Existing dependency, cache, build, log and operating-system exclusions remain
unchanged. The complete authoritative list is `.gitignore`.

## Rules for future changes

- Record every development change in the tracked development log, grouping
  related edits with scope, verification and publication status.
- For every new ignore pattern, record its reason and where safe evidence lives.
- Never put credentials, tokens, customer identifiers, raw production logs or
  customer records in tracked history.
- Do not delete retained release assets merely because they are ignored.
- A compiled or selected package is not a publication. Record those separately.
