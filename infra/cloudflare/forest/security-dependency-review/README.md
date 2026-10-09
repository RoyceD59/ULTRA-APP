# Selected security-only dependency revision — not published

Prepared after owner approval to prepare a security-only revision. The owner
subsequently approved selection and the two documented backport mitigations.
Main now selects this exact archive and its runtime dependency pins are aligned.
This is **not** approval to publish the API, advance clients, apply schemas or
distribute native binaries.

`candidate.json` and `validation.json` retain their original preparation-time
status/evidence. Current selection approval is recorded separately in
`owner-approval.json`; current verification is in `selection-validation.json`.
Prior approval records and source archives have not been rewritten.

## Exact package

- Parent:
  `88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`
- Candidate:
  `1e4c4a6ab52703298db9b4b460cc7faed8ccd796a672f46a9b8baa6c905e9af0`
- Scope:
  `4ee4d0f8c6741da1fd5e7b5c840286ec79214d6f561662ed3a85f332fc546cb6`
- Exactly three changed files:
  `package.json`, `artifacts/api-server/package.json`, `pnpm-lock.yaml`.
- **1,261 other retained files are byte-identical**, including API routes,
  security patches/fixtures, contracts, schema/migrations, customer data flows,
  receipts, all clients and native/OTA policy.
- No consolidated source or unrelated feature changes.

Registry-confirmed, exact pins:

| Dependency | Pin | License | Purpose |
| --- | --- | --- | --- |
| sharp | 0.35.5 | Apache-2.0 | Fixed librsvg image-renderer dependency; runtime confirms rsvg 2.63.2 |
| shell-quote | 1.11.0 | MIT | Fixed comment/line-terminator quoting issue |
| music-metadata | 11.16.0 | MIT | Fixed newly reported parser bounds/crash findings |

The existing direct WhatsApp parent is already the registry's current release.
The QR/native dependency chain is tied to the retained Expo SDK. Targeted
transitive overrides avoid changing those parent integrations or the SDK.
Unrelated sandbox lock importers and original codegen TypeScript peer contexts
were preserved rather than accepting pnpm's incidental pruning/re-resolution.

## Validation

All results refer to the exact checksum-specific candidate stage, not main:

- Shared-library and API/ProjectHub/Companion typechecks pass.
- API and ProjectHub builds pass.
- Companion web/iOS/Android JavaScript bundles and manifests compile; this is a
  static Expo Go build, **not a native binary or physical-device test**.
- Six negative/positive scope checks pass.
- Six installed-consumer dependency tests pass: PNG rendering, fixed quoting,
  WAV parsing and bounded MP4/EBML/DSF cases.
- Seven retained dependency/backport fixtures pass.
- Four retained installed-consumer pin/proxy/source-map/compression checks pass.
- All five retained auth/upload fixture files pass: **49 tests**, through the
  disposable test-database wrapper; the database was dropped afterward.
- Total targeted checks: **72 passed, zero failed**.

The production dependency audit reports **zero critical, zero moderate and two
high** version-based findings: `braces` and `node-forge`. Their unchanged
backports are covered by the installed-consumer regression fixtures. This is
**not a clean advisory feed**; review that mitigation evidence before selecting
or publishing. No new risk acceptance is implied.

Build warnings remain: Vite source-map/chunk-size warnings and the missing
development-only React Native DevTools shared library. Static exports completed
successfully. These results do not establish signed-in browser or device
usability, live security behavior or publication image size.

## Reproduce verification

From repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 infra/cloudflare/forest/prepare-security-dependency-review.py --verify
PYTHONDONTWRITEBYTECODE=1 python3 infra/cloudflare/forest/security-dependency-scope.test.py
node --test --test-concurrency=1 infra/cloudflare/forest/security-dependency-runtime.test.mjs
node infra/cloudflare/forest/verify-security-dependency-consumers.mjs
```

The runtime commands require the already installed checksum-specific stage:

```sh
HASH="$(node -p "require('./infra/cloudflare/forest/security-dependency-review/candidate.json').candidateSha256")"
STAGE="$(pwd)/.consistency-build/$HASH"
cd "$STAGE"
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/projecthub run typecheck
pnpm --filter @workspace/uc-companion run typecheck
node --test --test-concurrency=1 scripts/tests/dependency-security.test.mjs
pnpm audit --prod
```

The audit exits nonzero for its two reported high advisories; do not conceal
that result. Inspect and assess the backports separately.

For fixture/database instructions use Section 9 of
`docs/release-observability-and-test-guide.md`. For this review use the candidate
hash above, not that guide's older consolidated-stage hash:

```sh
cd "$STAGE/artifacts/api-server"
GOMAXPROCS=2 TEST_GLOB='src/tests/{customer-count-auth,jwt-session-expiry,review-media-signature,storage-public-media-security,storage-upload-allowlist}.test.ts' pnpm test
```

Never supply production database credentials.

## Reproduce preparation

Use a fresh ordinary `.consistency-build` child directory containing the verified
parent archive and its `.npmrc`. Apply only the exact manifest pins above.
Before regenerating its lock, preserve the absent sandbox importer with
`preserve-frozen-lock-importers.mjs <draft> <installed-parser-stage>`. After the
isolated lock refresh, restore original codegen contexts with
`restore-frozen-codegen-lock.mjs <draft> <installed-parser-stage>`. The parser
stage must provide the retained `yaml@2.9.0`; neither helper adds a dependency.
Then seal with:

```sh
export DRAFT=".consistency-build/security-dependencies-draft"
python3 infra/cloudflare/forest/prepare-security-dependency-review.py --derived-source-dir "$DRAFT"
```

Only the three reviewed dependency files are copied as overlays. The temporary
sandbox manifest is not packaged. `scope.json` records complete old/new hashes;
the verifier rejects changes to other files, manifests or lock importers.
Preparation is idempotent for the retained bytes and refuses to overwrite the
review archive with a different package.

## Remaining API-first gates

1. Completed: owner reviewed/approved this exact scope and the two backported
   high findings; selection is recorded separately from publication.
2. Completed: main's exact pins and installed consumers are aligned. Unrelated
   main workspace importer semantics are preserved, including codegen peer
   contexts. The API builder checks actual main external runtime pins.
3. Completed: handoff selects the approved archive; all 1,264 retained source
   files and modes were verified before adopting its previously installed
   review stage. Local-only API compilation passes and copies no outputs.
4. Review the broader Security Center scan: three high version-based findings
   (braces, http-cache-semantics, node-forge) and two moderate findings
   (fast-copy, postcss-selector-parser). The production-only pnpm audit reports
   two highs, zero critical and zero moderate. These are different scopes/feeds;
   do not dismiss the additional findings as covered by the two new approvals.
5. Current production schema diff is empty, with no warnings or removal/data-loss
   lists. Inspect it again immediately before publication. Stop on unrelated or
   destructive changes. Preparation changes no schemas.
6. Offer API-only publication after the main security/release checks pass.
   Verify matching publication provenance and both public API hosts' fresh,
   compatible, agreeing snapshots.
7. Retain and verify the complete actually served client rollback build, then
   prepare/check the candidate clients. Recheck snapshots immediately before
   separately approved client publication. Do not advance client pointers based
   on the local compilation above.

Both public API hosts returned fresh, agreeing snapshots at 2026-10-09 10:44 UTC.
That check does not prove the newly selected security package is live and must
be repeated before client publication.

See `selection-validation.json` for current evidence. No production schemas
were applied, deployment outputs copied, client activation, provider
configuration changes or publication occurred during selection. Development
services were restarted to load the aligned runtime dependencies.
