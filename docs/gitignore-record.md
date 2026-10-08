# Git ignore record

## Forged security file-review fixtures — 2026-10-08

No ignore patterns changed. Forged records and scope checksum adjustments exist
only in disposable temporary fixture copies, which are removed after each case.
Regression tests and development evidence are tracked; real approval records,
candidate archives and release selections are untouched.

## Security release corruption fixtures — 2026-10-08

No ignore patterns changed. Regression code and its documentation are tracked.
Copied archives, mutated metadata, extracted sources and output sentinels live
only in disposable operating-system temporary directories and are removed after
each case. Real retained archives and rollback assets are untouched.

## Saved-order guest-payment source — 2026-10-07

No ignore patterns were changed. Capability lifecycle, migration, checkout
sharing, private document/proxy, isolated tests/read-only catalogue fixture and
release-readiness evidence are tracked. Raw bearer links, contact data, test
session credentials and provider credentials must never be committed.

## Editable product pages — 2026-10-07

No ignore rule changed. Editorial schema/migration, shared content and tests,
browser screenshot and verification/development documents are tracked.
Disposable API test databases were dropped; build exports and test logs remain
under `/tmp`. No credentials or private runtime data were added.

## Record product preparation — 2026-10-07

No ignore rule was added or removed. Supplied product JSON/schema, the standalone
generated validator and public-page tests are tracked. Disposable web exports,
test logs and read-only operational reports were written under `/tmp`, not added
to source control. Existing private/runtime exclusions remain unchanged.

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

### Publishing input exclusions — 2026-10-07

`.replitignore` additionally excludes `.cache/`. Whole-stage and recursive
node_modules exclusions are removed: frozen stages hold runtime server/worker
outputs, and bundled public asset paths can contain node_modules. Their retained
source archives and rollback inputs under `infra/` remain included. `.gitignore`
itself is unchanged.

Ignore rules alone do not reliably clean dependencies regenerated during the
publishing build. A deployment-only post-build hook removes installed
dependencies at the roots of marked frozen stages and their workspace packages,
then retains the existing pnpm store prune. It does not remove stage servers,
compiled worker output, static asset directories or rollback dependencies.

### Approved consistency rollback inputs

Scoped exceptions retain `infra/cloudflare/forest/rollback-static/**/node_modules/`
and its contents. These files are public static dependencies verified against
the asset hashes in the served predecessor bundles, not an installed dependency
tree or runtime data. The exceptions make rollback inputs available to publishing.
The general `node_modules` exclusion remains in force elsewhere.

- Record every development change in the tracked development log, grouping
  related edits with scope, verification and publication status.
- For every new ignore pattern, record its reason and where safe evidence lives.
- Never put credentials, tokens, customer identifiers, raw production logs or
  customer records in tracked history.
- Do not delete retained release assets merely because they are ignored.
- A compiled or selected package is not a publication. Record those separately.
