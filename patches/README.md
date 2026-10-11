# Dependency security patches

The dependency remediation combines patched upstream releases with local pnpm
patches where no fixed upstream release is available. Use pnpm and commit the
patch files, package manifest, and lockfile together. Do not remove a patch until
an upstream release fixes the advisory and the regression tests still pass.

## Upstream upgrades

| Package | Locked version | Advisories addressed |
| --- | --- | --- |
| brace-expansion | 5.0.12 | GHSA-6j4f-fj2g-mc7p, GHSA-qhr7-859c-m2p7, GHSA-q2hr-2g5m-vwhr |
| nodemailer | 10.0.13 | GHSA-prgh-xp8r-p3m5, GHSA-v53p-9fqp-m79j, GHSA-6vj9-mwq6-2f5v, GHSA-8vvx-rff5-p5rq, GHSA-g57g-f23g-4646 |
| undici | 8.11.2 | GHSA-rfgv-xxqx-mfg5, GHSA-vp8m-p9jh-q5pm, GHSA-w293-vg96-wgc3, GHSA-2jfj-6hjv-fm6j, GHSA-3wwx-pv8p-q78v, GHSA-3xpg-4rpp-hhhm, GHSA-pmjh-fq2x-6v4x, GHSA-rx4f-c7p8-82vq, GHSA-2gqq-gqf2-x968, GHSA-8436-99hf-9mmv, GHSA-r53p-7pc4-xj5r |
| markdown-it | 14.3.2 | GHSA-253c-mchw-3w2r |
| ip-address | 10.7.3 | GHSA-2vr4-cq9g-pvrc, GHSA-h3mg-xc3c-68pw, GHSA-j6r3-76f7-8jcv, GHSA-rpw4-54j3-4h4q |
| fast-uri | 4.2.1 | GHSA-hrr3-gc8f-f4qj, GHSA-jvvf-x445-j334 |

Nodemailer now requires Node 20 or later; the workspace already requires Node
24 or later. Its `createTransport` / `sendMail` API is verified with an offline
message-composition test. Expo/native SDK package versions are unchanged.

## Local patches

### braces 3.0.3 — GHSA-vfj7-8cjw-p6xm

Bound parser nesting and recursive compile, expand, and stringify AST walks.
Patterns or externally supplied ASTs exceeding the safe depth budget are
rejected with a `SyntaxError` instead of exhausting the native stack.
The fixed maximum depth budget is 64 and cannot be disabled through options.
Ordinary glob compilation, ranges, and expansion are unchanged.

### http-cache-semantics 4.2.0 — GHSA-ch52-4w7c-c8xp

Prevent `max-stale` from reviving entries that cannot be reused safely:
non-storable responses, `no-cache`, `Vary: *`, shared `proxy-revalidate`, and
shared responses with `Set-Cookie` without the library's explicit public or
immutable opt-in. The guard runs in the common request-evaluation path, including
policies restored from persistent caches. Legitimate `max-age=0` public responses
can still be served stale when the client explicitly allows it.

### node-forge 1.4.0 — GHSA-86w9-cpqp-85rv

Validate the nested RSA PKCS#1 v1.5 `DigestAlgorithm` sequence element count as
well as the outer `DigestInfo` count. Permit only an OID and an optional empty
NULL parameter; reject extra elements, unexpected parameters, and nonempty NULL.
The regression constructs genuinely signed malformed DigestInfo objects using
a low-exponent RSA key, alongside valid SHA-256 signatures.

## Validation and scanner interpretation

Run:

```sh
pnpm install --frozen-lockfile
pnpm run test:dependency-security
pnpm run typecheck
pnpm --filter @workspace/uc-companion exec expo-doctor
```

The security tests resolve dependencies through their actual consuming packages,
not through an arbitrary retained copy in pnpm's virtual store.

A plain `pnpm install --frozen-lockfile` trusts an existing hash-qualified
directory (`Already up to date`), so a patch directory name or a successful
install is not proof a patch is active. `node infra/cloudflare/forest/security-patch-installation.mjs verify --stage DIR`
checks the installed bytes and fixtures; `pnpm install --force` replaces an
inactive copy. Never hand-edit `node_modules`.

A version-only dependency scan still reports the three locally patched
packages above: their upstream versions have intentionally not been falsified,
and no advisories have been ignored or suppressed. The other 26 findings are
removed by upstream upgrades. These three remaining scanner entries represent
patched upstream versions, not a clean upstream audit. Re-check for fixed
upstream releases when maintaining dependencies.