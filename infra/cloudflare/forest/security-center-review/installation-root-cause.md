# Installation root cause and verification report

Status: **ready for owner review; NOT selected, NOT published.** The sealed
archive, `candidate.json`, `scope.json` and every prior approval are unchanged.

## Exact inputs

| Item | Value |
| --- | --- |
| Archive | `release-sources.tar.gz`, sha256 `a982fb107d05be012dc560e06823ecee97c4f0a5a307f98e00cc3880d319a387` |
| Scope | `3a560981d4f774353707a7e80f4b74c63de59d2914d4c4079273aff80e397c48` |
| Parent | `1e4c4a6ab52703298db9b4b460cc7faed8ccd796a672f46a9b8baa6c905e9af0` |
| Changed files | `package.json`, `pnpm-lock.yaml` only (1,262 others unchanged) |
| Tools | Node v24.13.0 (shell), pnpm 10.26.1 (`.npmrc` keeps `manage-package-manager-versions=false`) |
| braces 3.0.3 patch | `6afd45f7…d4b9`, identical to main's `patches/braces@3.0.3.patch` |
| http-cache-semantics 4.2.0 patch | `29714885…9ae9`, identical to main's |
| node-forge 1.4.0 patch | `dbb34570…9dd4`, identical to main's |

The candidate lock declares `patchedDependencies` with exactly those hashes, so
the source bytes, lock declarations and patch files are all valid. No source
byte needed to change and no replacement candidate was created.

## Root cause

**Established**

1. A fresh exact-archive install in an empty store applies all three patches.
   Four independent installs (below) pass every fixture with no special handling.
2. pnpm trusts an *existing* hash-qualified directory. In a disposable stage I
   replaced the guarded `http-cache-semantics` `index.js` with an unguarded file
   (unlink then write, so store hard links were never touched). A plain
   `pnpm install --frozen-lockfile` printed `Already up to date`, left the file
   unguarded, and the max-stale fixture failed; the directory name was still
   `http-cache-semantics@4.2.0_patch_hash=2971…`. Only `--force` restored it.
   So a hash-qualified name, an exit-0 install and a populated marker prove
   nothing about installed bytes. This is the mechanism that lets an inactive
   patched directory persist and look valid.

**Not established**

- How the original unpatched directory in the blocked trial first arose. It was
  not reproduced from any clean or interrupted install.

**Failed hypotheses (each tested, none caused the failure)**

- Poisoned pnpm side-effects cache: entries for all three packages
  (`linux;x64;node24;patch=<hash>`) were guarded in the shared store and in both
  isolated stores examined.
- Interrupted install: SIGKILL right after the cache directory appeared left an
  unpatched directory, but a plain frozen rerun healed it.
- Patch/lock hash mismatch or altered archive: hashes and bytes match main's.

## Correction (no source change)

`security-patch-installation.mjs` adds `verifyInstalledBackports`. It checks that
the real consumer chains resolve to `<name>@<ver>_patch_hash=<lock hash>`, that
the declared marker is in the resolved copy and in every virtual-store copy,
that no other copy of the package exists, and that
`scripts/tests/dependency-security.test.mjs` passes. `build-approved-consistency.mjs`
calls it after the forced install and before the prepared marker is written, and
again (markers only) every time an already-marked stage is reused, before the
fixtures, builds or any output copy. The existing `--force` install is retained.

## Repeat results (`installation-verification.json`)

| Run | Store | Result |
| --- | --- | --- |
| cold-1, `--force` | new isolated store | 7/7 fixtures; one guarded copy of each package |
| warm store, fresh stage, plain frozen | cold-1 store | 7/7 |
| warm in place, plain frozen | cold-1 store | 7/7 |
| cold-2, `NODE_ENV=production`, `--force` | second new isolated store | 7/7 |

Resolved consumer paths, for example
`node_modules/.pnpm/http-cache-semantics@4.2.0_patch_hash=29714885…9ae9/node_modules/http-cache-semantics`,
are recorded per run. No store or `node_modules` was shared with main or the
selected parent.

Negative checks on the cold-2 install: unguarded file rejected; plain frozen
reinstall (`Already up to date`) still rejected; forced reinstall restored and
accepted. Unit tests (`security-patch-installation.test.mjs`, 9) additionally
reject, on synthetic stages, an inactive guard for each of the three packages, a
non-lock directory name, a stray extra copy, a lock missing a patch, and a
builder that does not gate the marker or cache reuse.

## Final candidate revalidation (cold-2 stage)

- `prepare-security-center-review.py --verify` and `security-center-lock.test.mjs`: pass (7 lock tests).
- `security-center-runtime.test.mjs`: 7/7 (fast-copy 4.1.0, selector parser 7.1.6, pino-pretty, bounded deep-copy and flat-selector checks, sharp/shell-quote/music-metadata pins).
- `typecheck:libs`, api-server, projecthub, uc-companion `tsc --noEmit`: exit 0.
- api-server build passed; `dist/pino-pretty.mjs` (and its map) bundle `fast-copy@4.1.0`. projecthub build passed.
- `pnpm audit --json` all scope: 0 critical, 0 moderate, **3 high** of 1,465 packages: node-forge ≤1.4.0 (GHSA-86w9-cpqp-85rv), http-cache-semantics ≤4.2.0 (GHSA-ch52-4w7c-c8xp), braces ≤3.0.3 (GHSA-vfj7-8cjw-p6xm).
- `pnpm audit --prod --json`: **2 high** of 857: node-forge and braces. http-cache-semantics is dev/tooling only.
- These are version-based findings for locally patched packages. Nothing was suppressed. Behaviour is shown by fixtures, not by the audit; the audit is not clean.
- Builder-related suites run: `security-center-cache-lock` (with selection and lock, 33 tests), `release-integrity-negative` 41/41, `consistency-handoff` 9/9.

## Remaining gates

1. Exact-source selection approval by the owner.
2. Explicit acceptance of the retained high-version advisories (braces 3.0.3, http-cache-semantics 4.2.0, node-forge 1.4.0; the two production ones are braces and node-forge).
3. Aligning main runtime manifests and lock without unrelated features.
4. Separate API publication approval after a full production schema diff.
5. Verify the live API serves both hosts, then recheck both snapshots before any client advance.
6. Product-schema v2.4 and logging-worker resilience remain separate tasks.
