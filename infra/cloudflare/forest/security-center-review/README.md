# Security Center dependency review — ready for owner review, unselected, unpublished

This is a separately retained review package, not a selected release.
Main still selects its parent `1e4c4a6ab52703298db9b4b460cc7faed8ccd796a672f46a9b8baa6c905e9af0`.
Both client selectors, production schemas and publication state are unchanged.

## Exact narrow source

- Candidate: `a982fb107d05be012dc560e06823ecee97c4f0a5a307f98e00cc3880d319a387`.
- Scope: `3a560981d4f774353707a7e80f4b74c63de59d2914d4c4079273aff80e397c48`.
- Only `package.json` and `pnpm-lock.yaml` change.
- Fast-copy **4.1.0** (MIT), postcss-selector-parser **7.1.6** (MIT).
- All other **1,262** archived files, modes, all 11 workspace importers,
  codegen peers and unrelated dependency versions remain unchanged.
- Existing sharp 0.35.5, shell-quote 1.11.0, music-metadata 11.16.0 and
  security patches remain unchanged. No product-schema v2.4 source is imported.

Registry identities and exact integrity values were verified. The isolated
resolver pruned unrelated packages; that output was rejected. The delivered
lock derives only the two registry-verified upgrades from the retained parent.

## Verified progress and blocking failure

The logging and typography consumers resolve the fixed versions. Ordinary and
cyclic copies, controlled deep-copy rejection, ordinary logging, selector
round-trip and a bounded large-selector parse were verified. The compiled API
logging worker includes fast-copy 4.1.0. The typography production build passed.
Typechecks and builds passed during dependency review with the trial cache
upgrade present; these do not override the subsequent cache safety failure.

The final candidate all-scope pnpm audit reports **zero critical, zero moderate,
three high**. High findings are retained versions of braces 3.0.3,
http-cache-semantics 4.2.0 and node-forge 1.4.0; nothing was suppressed.
This audit is not proof that declared backports are applied.

Upstream cache 4.3.0 failed the required private-cache regression. Declaring the
rebased guard with either its original or a distinct patch hash did not produce
a passing installed consumer. That upgrade path was stopped, not shipped.
The final review source retains the original 4.2.0 patch unchanged.

**Installation discrepancy (resolved as a verification gap):** the sealed
archive installs correctly. Two fresh isolated cold installs and two warm repeats
pass every fixture. A plain frozen install trusts an existing hash-qualified
directory, so an inactive copy can persist; the release builder now inspects the
installed bytes and fixtures before marking a stage or reusing it. The origin of
the original unpatched directory was not reproduced. See
`installation-root-cause.md` and `installation-verification.json`. This is ready
for owner review only; nothing is selected or published.

## Test locations and steps

Preparation tools and regression checks live in `infra/cloudflare/forest/`.
The isolated stage is `.consistency-build/security-center-draft`, already ignored.

```sh
# Immutable archive and complete narrow dependency/source scope
PYTHONDONTWRITEBYTECODE=1 python3 infra/cloudflare/forest/prepare-security-center-review.py --verify
node --test infra/cloudflare/forest/security-center-lock.test.mjs

# Actual consumers and installation gate (requires an installed stage)
node infra/cloudflare/forest/security-patch-installation.mjs verify --stage .consistency-build/security-center-draft
SECURITY_CENTER_STAGE=.consistency-build/security-center-draft \
  node --test infra/cloudflare/forest/security-center-runtime.test.mjs
cd .consistency-build/security-center-draft
GOMAXPROCS=2 pnpm run test:dependency-security
GOMAXPROCS=2 pnpm audit --json
```

Run those checks against a fresh
stage extracted from the exact sealed archive. Then rebuild/typecheck all
relevant consumers, verify baked worker paths, and retain evidence. Do not adopt
a populated stage or add a prepared marker without full source/mode verification.

## Separate release gates

1. Installation gate: satisfied for review (see report); keep fixtures strict.
2. Obtain exact-source selection approval and explicit acceptance of any
   remaining high-version advisories. The prior newly accepted exceptions cover
   braces/node-forge, not an implicit additional cache risk waiver.
3. Align main runtime manifests/lock without importing unrelated merged features.
4. Review deployment target and full current production schema diff; stop on
   unrelated/destructive changes. Obtain separate API publication approval.
5. Verify the matching new API release actually serves both public hosts.
6. Recheck both fresh agreeing snapshots immediately before any client advance.
7. Keep product-content v2.4 and its failing broader schema fixtures in their
   separately approved review; this security package does not publish that UI.
