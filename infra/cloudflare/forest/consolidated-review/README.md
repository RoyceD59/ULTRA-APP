# Consolidated release review — not selected or published

This is a separate review package, not approval to change production, schemas,
the main source selector, client activation, native distribution or OTA.

## Exact package

- Source snapshot: committed main
  `e91771af7f56fd838152d2b66560ecacfc451b85`.
- Retained approved parent:
  `88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`.
- Consolidated review SHA-256:
  `57b70b22b6faf692cc14c17b7858da52111d208354acab84f4e5d14f24c36feb`.
- Scope SHA-256:
  `candidate.json` pins the complete `scope.json`; that scope records every
  addition, removal and byte/executable-mode change against the parent.
- 1,908 source files, with 928 changed/added/removed paths against the narrow
  parent. Thirteen central consistency/security paths remain byte-identical.
- The initial committed-only review archive is retained by its SHA-256.
  Original consistency, dependency-security and auth/upload archives remain
  unchanged.

Reproduce with `prepare-consolidated-review.py` and the exact committed snapshot.
The three declared dependency-overlay inputs must be ordinary staging files;
manifest overlays permit only the reviewed versions below. No current working
tree application routes are copied. Untracked source, runtime customer records,
secret files, compiled output and unrelated products are excluded.

## Included merged work

The package includes the merged receipt, sign-in/session, upload, My Filters,
record-driven page, product-editorial/Excel variant, saved-order guest-payment
and AI access/feedback implementations. It retains the approved shared-impact
store, adjustment preconditions/audit, client freshness handling and old-release
policy.

Inclusion is not activation or a claim that every pending project task is done.
Topic/article, product evidence, provider, preview-feature, real-device and
native-distribution gates must remain intact. No new approvals were inferred
for product evidence or collections. Missing historical evidence remains unknown.

## Additional compatible dependency fixes — isolated only

- `sharp` **0.35.5**, Apache-2.0: fixed prebuilt librsvg; verify actual runtime
  librsvg **2.63.2**, not merely the manifest.
- `shell-quote` **1.11.0**, MIT: rejects line terminators after comment tokens.
- `fast-copy` **4.1.0**, MIT: bounded recursive copying.

Registry versions, licenses and integrity metadata were verified. All exceed
the existing dependency release-age window; no exception was added. Root
manifests and lockfile have NOT been changed to these versions.

The retained braces, http-cache-semantics and node-forge backports still need
their installed-consumer regression evidence. Version-based audit feeds may
continue to report their original versions. Do not describe a passing
backport test as a clean dependency scan.

The archive's sharp fix cannot be assumed to protect a published API until the
approved root runtime dependency graph is also installed: API output deliberately
externalizes sharp. Selecting an archive alone would still load main's old
external dependency. This is an explicit publication blocker.

## Review and rollout blockers

1. Obtain exact-byte selection approval for this new consolidated candidate.
   Current main selection remains the auth/upload parent; publication requires
   a separate owner action.
2. Review the complete production schema diff: guest-payment links, product
   editorial records, order-variant fields and AI-feedback fields/indexes.
   The last inspection found eleven additive statements and no destructive
   changes. No statement was applied during preparation.
3. Apply only separately approved runtime manifest/lock changes and check
   actual external dependency versions before API publication.
4. Resolve or explicitly review remaining scanner findings and their mitigations.
   No broad security sign-off is implied.
5. Publish compatible API first. Establish its exact served source provenance
   and verify both public API hosts return agreeing fresh snapshots. Keep the
   existing production adjustment revision and audit; never reinitialize them.
6. Retain the complete actually served rollback asset set before new paired
   browser/Expo Go client selection. The current public build is newer than the
   older retained static capture; do not silently substitute that old capture.
7. Reconfirm approved signed-in/provider/device checks, feature activation
   conditions and public client IDs/bundle hashes. Native distribution and OTA
   remain separate.

See `validation.json` for completed checks and explicit remaining limits, and
the main coordinated-verification evidence for the full schema statements.
