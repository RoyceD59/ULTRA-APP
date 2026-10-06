# Security-only revision of the approved consistency candidate

Prepared with owner approval on 2026-10-06. **Not published.**

| Input | SHA-256 |
| --- | --- |
| Security candidate | `b3a298f2e19090a5da3b98a0c0b320cde8afe733f80430af48bfc9a24183921c` |
| Original approved consistency candidate (retained) | `db2ef861871dcff39cde08350d9374e9b8d1220409e2f506141cf9c4666cad59` |
| Original predecessor (retained) | `bdc71175d7f653c99d9d431770200915acd2e8333220c59b8b66a3d48e03d3b2` |

Only `pnpm-lock.yaml` differs from the original approved candidate:

- `proxy-addr` 2.0.7 → **2.0.8** (MIT).
- `source-map-js` 1.2.1 → **1.2.2** (BSD-3-Clause).
- `compression` 1.8.1 → **1.8.2** (MIT), including its required `destroy`
  reference to the already-locked 1.2.0 package.

These genuine existing packages and exact patch releases were verified against
the npm registry. All application source, schemas, workspace manifests, SDK
versions, existing backports, assets and OTA configuration are byte-identical to
the approved candidate. Importers and unrelated dependency resolutions are
unchanged. The original approved archive and predecessor are never overwritten.

The initial resolver output pruned an absent sandbox importer and changed
unrelated TypeScript peer resolutions. It is **not** the delivered lockfile.
`consistency-security.mjs` independently verifies the narrow delta; the archive
scope test compares every regular file against the original candidate.

The handoff now selects this security archive, with source identity
`consistency-b3a298f2e19090a5da3b98a0c0b320cde8afe733f80430af48bfc9a24183921c`.
API production build command remains:

```
node infra/cloudflare/forest/build-approved-consistency.mjs api --copy-output
```

Both client production commands remain on their unchanged predecessor. Build
preparation now runs the existing seven backport regressions and four fixed-
dependency runtime regressions through actual frozen consumers, before compiling
or copying outputs. These guards never run in static-server startup.

## Audit interpretation

The revised candidate's npm audit has zero critical findings and two version-only
high findings: braces and node-forge. Their retained local security backports pass
the real-consumer regressions. The three previously unaddressed findings are gone.
The Security Center dependency feed additionally flags the retained
http-cache-semantics backport and two moderate findings outside this update.
Its three high findings correspond to the existing, tested local backports.
Do not call either scanner wholly clean or claim a complete Security Center scan:
the tracked workspace scan is paused waiting for input.

## Rollout boundary

Preparation/compilation is not publication or a live API compatibility check.
No production initialization has occurred. Resume the original API-first
checklist only after publication review and the owner's Publish action. Verify
the actually served API before approved zero-baseline initialization, preserve
any intervening revision, compare fresh snapshots on both API hosts, and recapture
the then-served predecessor before selecting candidate clients.

The existing rollback asset-404 and platform/scale parity limitations remain.
Signed-in/device verification is unchanged and unclaimed.
