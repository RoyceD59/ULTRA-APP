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

### YYYY-MM-DD — Change title

- **Scope/approval:** What was requested and any explicit operational approval.
- **Changes:** Every related change and its purpose; link focused evidence.
- **Verification:** Commands/results and evidence limits.
- **Ignore changes:** Patterns added/removed and reasons, or none.
- **Status:** Source / prepared / compiled / selected / published / rolled back.
- **Remaining:** Concrete unfinished checks or blockers.
