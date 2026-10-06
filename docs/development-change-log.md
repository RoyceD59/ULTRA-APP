# Development change log

Track development progress here in Git. Record changes, verification, remaining
work and publication status. Never include secrets or customer identifiers.
Git history records exact file changes; entries here explain their purpose.

## 2026-10-05 — Consistency release preparation

**Scope:** The owner approved splitting preparation in the isolated task from
publication and live verification in the main workspace. This entry does not
announce a production release.

### Changes

- Recorded exact candidate approval, isolated compilation evidence and the
  historical-adjustment evidence gap in
  `infra/cloudflare/forest/companion-consistency-release.md`.
- Searched project files and Git history; found one real historical zero-offset
  file, but no serving-instance evidence. The owner explicitly chose its zero
  offsets as initialization input after the omission risk was explained.
- Checked available deployment logs without recording raw contents or private
  attribution; they did not establish historical production adjustments.
- Saved the approved source archive and scope metadata in
  `infra/cloudflare/forest/approved-consistency/`, separate from the unchanged
  predecessor. No unrelated working-tree sources enter the package.
- Added an isolated handoff builder and fail-closed live API snapshot gate.
  Default production commands are unchanged; the candidate is not selected.
  Local-only checks cannot copy deployment outputs or serve as published clients.
- Added package, snapshot-gate and handoff checks.
- Added explicit retention input and collision checks before production client
  preparation, including normalization of legacy native rollback manifests
  and checks for referenced font/image/manifest assets.
- Added the approved-source README with API-first main-workspace commands,
  audited initialization, safe rollback and credential/access prerequisites.
- Corrected the handoff after its completion check: removed external API and
  baseline gates from serving approved static assets. Build preparation still
  fails closed, but API outages no longer prevent server startup/restart.
  Added an executable production-command regression for that distinction.
- Added a `.consistency-build/` ignore pattern for disposable compilation, plus
  `docs/gitignore-record.md` to explain exclusions without hiding this log.

### Verification

- Original source-boundary/server-selection tests: passed.
- Candidate shared-library, API, ProjectHub and Companion type checks: passed.
- Candidate API, ProjectHub and browser/iOS/Android builds: passed.
- Local compiled Companion ID: `1791190818435-5334`.
- Saved candidate source SHA-256:
  `db2ef861871dcff39cde08350d9374e9b8d1220409e2f506141cf9c4666cad59`.
- Detailed build hashes and credential-free live observations are in the release
  document. Native compilation is not physical-device verification.
- Final saved-source handoff: 17 package/gate checks passed; the eight gate and
  retention checks passed again after referenced-asset validation was added.
- Fresh isolated API, Hub and Companion builds/type checks passed through the
  handoff builder. Its local-only HTTP server selected
  `1791259615348-6264` consistently across browser/version/iOS/Android. The
  compiler reports `2026-10-06T04:08:12.043Z`; this is not a publication timestamp.
- The current production response was rejected by the client snapshot gate.
- Existing signed-out ProjectHub preview rendered normally. No authenticated
  or physical-device verification was performed.
- After the startup correction, all nine handoff tests passed, including the
  production-command regression with all external requests unavailable and
  rejection of API outages during Hub/Companion build preparation. Archive and
  predecessor checks remain valid; no source recompilation was needed.

### Status

**Prepared/compiled, not selected or published.** No production write,
initialization, migration, rollback selection or customer login occurred.
Hosting, authentication and disabled OTA are unchanged. Publication must follow
the main-workspace handoff, with compatible API first, explicit audited
initialization, then client delivery and exact live snapshot comparisons.

### Still required

- Apply this preparation to main; inspect its actual deployment target and schema
  diff, preserving shared adjustment/audit tables and all rollback assets.
- Publish the API separately before clients; initialize only the authorized
  historical baseline if the shared record is still absent.
- Confirm both public API hosts return the same fresh snapshot.
- Publish paired browser/iOS/Android Expo Go clients; verify served IDs and origins.
- Compare Home/About/ProjectHub signed out and with approved accounts. The second
  customer's unambiguous identifier and secure credentials remain needed.
- Keep the paused customer-login investigation out of scope.

## Entry template

### 2026-10-06 — Main-workspace API-first consistency rollout preparation

- **Scope/approval:** Continue the approved consistency rollout in main. Publish
  the API-compatible response before advancing either client. Preserve hosting,
  authentication, OTA, source freeze and historical impact evidence.
- **Changes:** Confirmed the saved approved source candidate and predecessor
  checksums. Changed only API production build selection through artifact
  validation to `build-approved-consistency.mjs api --copy-output`. Its production
  run command is unchanged; Hub and Companion retain predecessor build commands.
  No production database write, initialization or publication was performed.
- **Verification:** `explainSchemaDiff()` returned success with no diff, no SQL
  statements and no destructive/backward-incompatible changes. Read-only
  production queries confirmed both impact tables exist, with no adjustment row
  and zero audit entries. Handoff/package tests: 18 passed, zero failed, exit 0.
  Isolated approved API source and libraries typechecked and API compiled, exit 0.
  The live-API compatibility gate still rejects the old served contract.
- **Rollback:** Captured served build `1791182522315-296`, public version metadata,
  all three bundles and both native manifests. Saved 60 unique files with
  checksum/provenance evidence in `infra/cloudflare/forest/rollback-static/`.
  Several public dependency URLs return 404. Recovered dependency bytes from
  retained local output only when their MD5 matches a platform/scale file hash
  declared in the actually served native bundles. No older build metadata or
  bundles were substituted. The handoff retention helper validated and copied
  the inputs to a disposable verification directory, retaining 61 files including
  the capture evidence. This is not certification of multi-scale/platform visual
  parity and does not repair the existing public asset URLs.
- **Ignore changes:** Added narrowly scoped exceptions for public rollback
  dependencies nested in `node_modules`, ensuring these release inputs can reach
  the publishing builder. Workspace dependencies and generated stages stay ignored.
- **Security gate:** The exact candidate's production dependency audit exited 1:
  four high findings and one critical finding. Existing braces/node-forge patches
  were verified by seven passing dependency-security regression tests (exit 0);
  a version-only audit still reports those two patched packages. The remaining
  findings are proxy-addr 2.0.7 (critical), source-map-js 1.2.1 (high) and compression
  1.8.1 (high). The latter two paths are Expo tooling; the proxy-addr advisory
  depends on an unsafe IPv6 trust-subnet configuration, not observed in the API
  source. This is not proof of a production exploit, but the clean shipping
  dependency gate is unmet. No dependency or approved archive was silently changed.
- **Status:** Main API build selection prepared and compiled; publication paused
  at the dependency-security gate. No initialization or client activation.
- **Remaining:** Owner Publish action for API-first stage; verify compatible live
  API before approved staff initialization with `expectedRevision: 0` if still
  empty. Preserve any intervening staff revision. Compare both API hosts, recapture
  the actually served predecessor after first publication, then configure/publish
  paired clients. Account/device checks and existing public asset failures remain
  distinct from successful compilation or schema inspection. Obtain approval for
  a narrowly scoped security revision/new candidate checksum before proceeding.

### YYYY-MM-DD — Change title

- **Scope/approval:** What was requested and any explicit operational approval.
- **Changes:** Every related change and its purpose; link focused evidence.
- **Verification:** Commands/results and evidence limits.
- **Ignore changes:** Patterns added/removed and reasons, or none.
- **Status:** Source / prepared / compiled / selected / published / rolled back.
- **Remaining:** Concrete unfinished checks or blockers.
