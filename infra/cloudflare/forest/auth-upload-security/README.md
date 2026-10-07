# Frozen authentication/upload security revision

**Prepared and selected with owner byte-scope approval on 2026-10-08. Not published.**

Candidate SHA-256:
`88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`

Retained parent SHA-256:
`b3a298f2e19090a5da3b98a0c0b320cde8afe733f80430af48bfc9a24183921c`

The deterministic preparation script compares frozen preimages with the exact
merged security hunks. It never copies working-tree routes. `scope.json` records
each old/new byte count and SHA-256; `merged-security.patch` is the complete
readable delta. `auth-upload-security.mjs` pins both the archive and scope record
and checks every regular file against the retained parent.

## Narrow source scope

- `jwt.ts`: eight-hour default expiry; reject missing, malformed and expired
  expiry claims, including the exact expiry boundary.
- `objectStorage.ts`: merged security documentation correction only.
- `review-media-signature.ts`: shared exact MIME allowlists and bounded signature
  inspection even when stored MIME metadata claims a safe type.
- `storage.ts`: merged per-router storage adapter needed by regression tests;
  safe inline MIME types only, forced download otherwise; sandbox CSP/nosniff on
  original and derivative responses.
- `uc.ts`: only the attachment verification hunks and live active-team lookup
  on customer-count access. Preserve the frozen statistics query, receipts and
  every unrelated route byte.
- Five exact merged regression files: session expiry, live customer-count
  access, media signatures, public-media serving and upload allowlist.

Six existing regular files change, four regression files are added, and all
1,254 other parent regular files remain byte-identical. No lockfile, dependency,
schema, client, receipt feature or OTA changes. Earlier archives and rollback
files remain intact.

## Verification and selection

The retained source itself must pass API compilation, shared-library and all
three consumer typechecks, dependency-security fixtures and the five security
fixtures. Database-backed fixtures use the existing per-run disposable test
database wrapper; never point these fixtures at development or production data.

The owner approved this exact byte scope after reviewing the comparison and
local validation summary. `owner-approval.json` records selection approval,
not publication approval. The main handoff now selects this archive. API-first
production build and deployment post-build dependency cleanup remain unchanged;
client commands remain on their predecessor.

Deployment preparation also executes the three non-database merged security
fixture files before compilation. The two database-backed fixture files are
only run through the disposable-database wrapper during local validation.

## Future publication

Publication requires a separate owner action. Explain that previously unbounded
customer sessions will require a one-time sign-in and new sessions expire after
eight hours. No refresh/logout feature is introduced.

After API publication, verify the actually served API and both public hosts'
compatible fresh agreeing snapshots before any client advancement. Production
initialization, schema changes, client activation, native distribution and
physical-device checks are neither performed nor claimed by this preparation.
Final image-layer size is also unproven until a real publishing build succeeds.

See [`rollout-evidence/auth-upload-security-preparation.json`](../rollout-evidence/auth-upload-security-preparation.json)
for the final local checks, selection record and explicit publication limits.
Existing deployment metadata reports a successful older deployment; public
source/snapshot probes were unavailable from the probe environment. Neither
observation proves that these protections are live or allows client advancement.
