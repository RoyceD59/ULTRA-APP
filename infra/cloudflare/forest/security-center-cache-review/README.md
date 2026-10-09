# Security-only cache/install revision — verified, unselected, unpublished

Exact archive: `d7ee99bdc3df01868cab10da1aa61bcde14f9737c659d306f09ddbf597dfc921`

Scope: `f2f190773180b02ec45fde79addbb39a48c9cdd5f583071b026892d20ef5b320`

Parent: `1e4c4a6ab52703298db9b4b460cc7faed8ccd796a672f46a9b8baa6c905e9af0`

## Resolved blocker

The source guard was valid. A normal frozen install reused an inactive cached
installation despite its hash-qualified path. Forced frozen reimport restored
the guard without changing manifest or lock bytes. Exact internal store cause
is not established; do not infer that hash-qualified names prove applied code.

The revised package pins genuine http-cache-semantics **4.3.0** (BSD-2-Clause),
fast-copy **4.1.0** (MIT) and postcss-selector-parser **7.1.6** (MIT).
Cache 4.3.0 uses the byte-identical stronger existing guard. Its declared patch
key is 4.3.0; the retained filename remains `http-cache-semantics@4.2.0.patch`
intentionally to avoid introducing another source file or guard implementation.

Only root `package.json` and `pnpm-lock.yaml` change. All other 1,262 source
files/modes, 11 workspace importers, peers and unrelated dependency resolutions
are unchanged. Old review archives are retained, not overwritten. The loader,
product-content v2.4 and other merged feature changes are not imported.

Release preparation now runs frozen installation with `--force --prod=false`
and still executes real-consumer fixtures before building/copying outputs.
Explicit build dependencies avoid NODE_ENV=production skipping the tools and
dev-only consumers used by the release checks. Existing prune/image-budget
behavior is unchanged.

## Verification

- Seven backport attack/ordinary-behavior tests: passed.
- Seven actual dependency-consumer checks: passed.
- Both sets repeated from a second clean extraction of this exact sealed
  archive, under production NODE_ENV with explicit build dependencies: passed.
- Fifteen narrow-scope/negative-lock/preparation-policy checks: passed.
- Shared-library, API, ProjectHub and Companion typechecks: passed.
- API and ProjectHub production builds: passed; baked logging worker includes
  fast-copy 4.1.0.
- Candidate all-scope audit: **0 critical, 0 moderate, 2 high**. Braces 3.0.3 and
  node-forge 1.4.0 retain the existing tested backports; findings are not
  suppressed. No cache advisory or new cache risk waiver is retained.
- Full immutable scope verification: passed.
- The broader existing release-integrity matrix timed out after six successful
  cases; no failure was reported before timeout. It is not recorded as passed.

Production preflight: public autoscale target has a successful build, full
schema diff is empty, no statements/destructive flags/warnings. Both existing
public API hosts returned fresh agreeing snapshots. These are observations of
the current API, **not evidence that this new package is live**.

## Test locations and commands

```sh
PYTHONDONTWRITEBYTECODE=1 python3 infra/cloudflare/forest/prepare-security-center-cache-review.py --verify
node --test infra/cloudflare/forest/security-center-cache-lock.test.mjs \
  infra/cloudflare/forest/security-center-lock.test.mjs

# Existing second clean exact-archive extraction:
cd .consistency-build/security-center-cache-cold
CI=1 NODE_ENV=production GOMAXPROCS=2 \
  pnpm install --frozen-lockfile --ignore-scripts --force --prod=false
GOMAXPROCS=2 pnpm run test:dependency-security
cd ../..
SECURITY_CENTER_STAGE=.consistency-build/security-center-cache-cold \
  SECURITY_CENTER_CACHE_REVIEW=1 \
  node --test infra/cloudflare/forest/security-center-runtime.test.mjs
```

## Remaining approval/publication gates

1. Exact-source selection approval, explicitly retaining the two tested
   braces/node-forge advisory exceptions.
2. Align main runtime pins/lock and selection verification without importing
   unrelated features. Do not switch client selectors.
3. Separate API publication approval after checking the then-current target and
   full schema diff. Stop on unrelated/destructive changes.
4. Verify the matching new API source is actually live.
5. Repeat both hosts' fresh snapshot agreement immediately before client
   publication. Existing fresh agreement alone cannot authorize that step.

No runtime manifest/lock, selected archive pointer, client selector, production
schema or publication output was changed during this preparation.
