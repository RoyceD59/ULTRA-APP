# Approved consistency source — inactive handoff

`release-sources.tar.gz` is the **exact approved source candidate**, not a built
binary and not the active production archive. `candidate.json` is its original
scope/checksum record. It must not be regenerated from later workspace changes.

- Candidate SHA-256:
  `db2ef861871dcff39cde08350d9374e9b8d1220409e2f506141cf9c4666cad59`
- Retained predecessor SHA-256:
  `bdc71175d7f653c99d9d431770200915acd2e8333220c59b8b66a3d48e03d3b2`
- Unrelated frozen files preserved: 1,227.
- Approved API origin: `https://api.ucfilters.com`.
- OTA: disabled. Standalone native distribution: not part of this handoff.

The owner approved gated publication of this exact source and subsequently
approved splitting preparation here from publication/live verification in main.
The owner explicitly chose the real July 31 project file's zero historical
offsets, with the production-evidence gap explained. Its hash is
`90d07bcb36e9ba92333937abe2e1887bb6e754dc79bb53a4bed50228d3aec3ad`.
This choice is **not proof of current production file values**. Do not create a
fake historical timestamp or claim to have recovered production history.

The builder and handoff documentation are packaging tools outside this source
archive. Current production commands and the predecessor manifest are unchanged.
Applying this task does not select or publish the candidate.

## Local preparation checks

From the repository root:

```sh
node --test infra/cloudflare/forest/consistency-handoff.test.mjs
node infra/cloudflare/forest/build-approved-consistency.mjs api --local-only
node infra/cloudflare/forest/build-approved-consistency.mjs hub --local-only
node infra/cloudflare/forest/build-approved-consistency.mjs companion --local-only
```

Outputs live under `.consistency-build/<candidate-sha256>/`, which is ignored.
These commands never publish, select deployment configuration, run a database
import, start the API or copy outputs into the working applications. The source
and all app consumers are typechecked from the saved archive.

External live-baseline/snapshot gates run only during deployment preparation.
Serving an already-approved build checks local source identity and build
provenance without depending on either API host. API outages must not prevent
static server startup/restart or access to the client's stale/offline states.

`--local-only --copy-output` is rejected. A local-only Companion build cannot be
used by the production serve command.

## Main-workspace rollout — separate operational work

Only after applying this preparation to main:

1. Read the deployment, database, artifacts, environment-secrets and testing
   skills. Obtain the actual main-project deployment URL and inspect its schema
   diff. **Stop on unrelated or destructive schema changes.** Do not add custom
   production DDL or database-push hooks. Both shared-impact tables were already
   present at the recorded read-only check.
2. Revalidate archive hashes and the actually served release. Capture complete
   browser/iOS/Android static rollback assets, manifests, build metadata and
   asset dependencies from the approved serving release or a verified deployment
   artifact. The local `.hydrate-release` may be older than production; do not
   label it as the current rollback merely because its directory exists.
   Retain the original archive and all rollback assets.
3. Use validated artifact-configuration updates in main to change **only the API
   build command** to:

   ```sh
   node infra/cloudflare/forest/build-approved-consistency.mjs api --copy-output
   ```

   Keep the existing API run command. Keep the predecessor client/Hub source
   selection in this first publication; do not route them to candidate builds.
   Do not use a workspace-wide source build. Publish through the main workspace
   using the documented publishing flow. A scheduled/successful publish is not
   proof of actual served code.
4. Verify that the live API is the compatible candidate. If a shared global row
   exists, preserve it and its audit entries. If it is absent, initialize only
   the owner's chosen zero baseline using the configured, approved staff account
   and the compatible `/api/uc/impact/override` endpoint with:

   ```json
   {"litresOffset":0,"usersOffset":0,"expectedRevision":0}
   ```

   This is an explicitly chosen **staff initialization**, not a claim of
   recovered historical production data. Keep its actual audit actor and actual
   write time; preserve the separate unknown historical timestamp. Never send
   this write to the old file-based endpoint. A 409 requires rereading the shared
   row, not dropping the precondition or replacing another staff edit.
   If an authorized operator instead imports the approved original file,
   verify the exact hash and target and use the existing import path, without
   adding a production schema-migration mechanism. Do not silently substitute
   development records.
5. Confirm the adjustment and audit state with read-only production queries and
   compare both public API hosts. Before building clients, the new builder
   rejects old, missing, stale, invalid or disagreeing snapshots. If unavailable,
   stop: the new clients must not advance.
6. Preserve the complete **currently served** static predecessor directory, then
   configure only candidate Hub/Companion builds and the Companion serve command
   through the artifact validation tool:

   ```sh
   node infra/cloudflare/forest/build-approved-consistency.mjs hub --copy-output
   node infra/cloudflare/forest/build-approved-consistency.mjs companion --retain-static=<verified-static-directory>
   node infra/cloudflare/forest/build-approved-consistency.mjs serve-companion
   ```

   The retention directory must be part of the approved main publication input,
   not a private temporary path unavailable to the deployment builder. Client
   preparation requires its exact actually served build, all three bundles and
   paired native manifests; it copies versioned files without replacing existing
   bytes or advancing the candidate pointer. The frozen candidate build then
   stages and selects a complete browser/iOS/Android build together. Hash collisions
   or missing rollback files stop the build.
7. Publish the clients only after API verification. Record the actual served
   browser HTML/script IDs, version metadata, both native launch keys/URLs,
   downloaded bundle hashes and production API origin on both public hosts.
   The locally compiled ID in the preparation report is not a promised
   production ID: production compilation generates a new one.
8. Use one testing pass for exact Home/About/ProjectHub snapshots with the
   specifically approved accounts. Do not store account identifiers or credentials
   in this repository. Confirm the second customer's exact identifier and secure
   access before attempting sign-in. Use existing valid credentials only; no
   resets, impersonation, account creation or paused login investigation.
   Keep personal impact personal. Signed-out delivery, Expo Go and physical
   installed-binary evidence must remain distinct.

## Rollback boundary

Roll back the **complete client selection** using the candidate's
`activateStaticBuild` helper and the verified retained browser/iOS/Android build,
and pair Hub rollback with compatible public response fields. Retain the new
database-backed API, shared adjustment row and audit history. Never restore the
file-authoritative API or drop/reinitialize shared tables. Do not delete newer
assets: an existing tab or device may still reference them.

Whole-build rollback, interrupted preparation, stale/offline displays and actual
device checks remain live-rollout verification, not claims of this handoff.
Hosting, DNS, authentication and OTA must stay unchanged.
