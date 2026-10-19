# Ultra Clear: verify a deployment after PR #6

Use this guide for the Companion, Project Hub and shared API. A merged pull
request proves that GitHub accepted source changes. A live release is valid only
after its published files, API and representative customer journeys are checked.
Record each check as PASS, FAIL, or UNVERIFIED with a UTC timestamp.

## 1. Establish the source being tested

PR #6 merged on 19 October 2026 at 08:02 UTC into commit
`3731f8414e662b2dce464ba45f6a8481eeabfe23`. Its tree is identical to reconciliation
commit `6c64a852595d3898b460c4226f8b88ba355a65b6`. That commit retains both the old
`main` history and `App` at `60e91e261701f19786b9e87362c4a6627cdc7fb9`.

In GitHub, open **Code → main**, then the latest commit and its checks. Confirm
the full commit ID. Open **Actions** and inspect runs for that exact commit,
rather than a successful run on an earlier branch.

At this review GitHub reported `main` as unprotected. After the checks are
reliable, configure a branch rule requiring pull requests and the agreed checks,
including administrator enforcement where appropriate. This prevents another
accidental merge with red checks. No repository protection setting was changed
by preparing this guide.

The post-merge baseline had failing Companion and refill-foundation checks;
governance and Maps record health passed. The EAS build/submission job was
skipped. These results are recorded evidence, not proof of a store binary or a
working native map. The repair PR must supply new results for its own head.

The production artifact tools select a reviewed source archive. A Git commit
ID, source-archive SHA-256 and client build ID are different identifiers. Record
all three and trace them through the selected candidate, build logs and served
version. Editing the current workspace does not automatically update the frozen
publication archive. Never infer publication from `main` alone or from an old
`NOT PUBLISHED` note in a handoff.

## 2. Check CI and the isolated preview

Require successful Companion, refill foundation, refill governance and isolated
preproduction preview checks on the repair PR. Inspect failed steps rather than
rerunning until a failure disappears. Keep assertions that protect account
isolation, checkout identity, provenance, real 404s and storage-failure handling.

Open the preview run and expand these steps:

- Validate and start isolated containers.
- Smoke-check all three app surfaces.
- Exercise responsive browser navigation.
- Capture container logs and upload `preview-evidence`.

Download the artifact and open its Playwright report. Confirm that it contains
test results, not just an empty archive or a short startup log. Docker preview
uses fixtures and a disposable database; it does not prove production auth,
payments, account data or physical-phone behaviour.

For a local Windows preview, install/start Docker Desktop, open PowerShell in
the repository root, and run the existing script:

```powershell
.\scripts\preview\Start-Preview.ps1
```

Open Companion at `http://localhost:3000/`, Hub at
`http://localhost:5055/`, and API health at
`http://localhost:5000/api/healthz`. The script reports missing Docker or invalid
configuration. Use `Stop-Preview.ps1` to stop while retaining preview data.
`Reset-Preview.ps1` restarts the preview; its optional `-DropTestData` erases only
the disposable `ultra-preview` volume. Never point this setup at a production
database or copy production secrets into it.

## 3. Check the publication and rollback evidence

In the main ULTRA-APP Replit project, open **Publishing** and the deployment
history. Identify the exact successful publication and its build/startup logs.
Record the approval/publish times, selected archive hash, build command,
post-build cleanup result, final image size against its configured limit, and
startup result. Missing evidence stays UNVERIFIED.

Confirm that the build/run configuration agrees with the selected artifact
handoff. Use its artifact validation tools; do not replace them with a whole
workspace build to bypass a failure. Inspect the schema diff before publishing;
unrelated or destructive changes stop the release.

Before the next publication, retain the *actually served* browser, iOS and
Android bundles, native manifests and all referenced assets. Check the capture
record's build ID, file sizes and SHA-256 hashes against the live version.
An older directory in `rollback-static/` is insufficient. The existing builder
and `capture-live-client.mjs` enforce this capture; do not remove the gate.

## 4. Confirm what the public hosts serve

Use a private browser window. Open Developer Tools → Network, enable **Disable
cache**, then reload. Browser cache and an existing Expo Go session can conceal
an older release.

1. Open `https://app.ucfilters.com/version.json`. It must return JSON, not a login
   page or HTML fallback. Record `buildId`, revision, build time, `apiOrigin`,
   production marker and supported web/Expo Go IDs. Compare them with the
   selected artifact. The production API origin must be
   `https://api.ucfilters.com`.
2. Recheck the corresponding served HTML and bundle requests on both
   `app.ucfilters.com` and `team-horizon--jerryaroyce.replit.app` using the client
   base path declared by the release. Compare downloaded bundle SHA-256 hashes;
   a successful HTTP status alone is insufficient. Every referenced asset must
   be present with its correct content type.
3. Request the iOS and Android launch manifests at the release's Companion base
   path, with `expo-platform: ios` or `expo-platform: android` and
   `expo-protocol-version: 0`. Check manifest IDs, `launchAsset.key`, launch URL,
   bundle hash and API origin against the same selected release. Opening the URL
   as an ordinary browser request does not perform this native-manifest check.
4. Open `https://hub.ucfilters.com/`. Verify the HTML and downloaded JavaScript
   against the selected Hub output. Use a Hub version endpoint only if that
   release actually provides one; an arbitrary `/version.json` route is not
   guaranteed for Hub.
5. Check `/api/healthz` and `/api/uc/impact` on both API hosts:
   `https://api.ucfilters.com` and
   `https://team-horizon--jerryaroyce.replit.app`. Require healthy responses,
   fresh `calculatedAt`, compatible snapshot fields and agreeing snapshot IDs,
   adjustment revisions and values. Apply the response's freshness policy
   (`maxAgeSeconds`); a stale/offline view must label last-known figures.

If any request is blocked in the testing environment, record UNVERIFIED and
repeat through an authenticated browser or the publishing environment. An
environmental 403 or TLS failure alone does not prove the public site is down.

## 5. Walk through the public and account journeys

Check compact (390 px), medium (768 px) and expanded (1440 px) widths. Also use
a real Android and iPhone under task #822. Device emulation is separate evidence.

- Navigate every visible tab; confirm the selected release's tab list is
  complete. Check navigation overflow, scrolling, touch targets, text wrapping,
  portrait/landscape, slow loading and useful failure/retry feedback.
- Open catalogue → a real published product → photos/options → back to its
  category. Copy the product URL into a new tab and hard-refresh it. Verify
  correct image content types, quantities, price/stock state and visible
  suitability information. Unpublished records stay private.
- Check blog/article links, support, Alison enquiry handoff and map selection.
  A nonexistent public content URL must show a genuine 404. A 200 HTML shell
  does not prove that a route or its data works.
- Compare Home, About and ProjectHub global snapshots signed out, as the
  configured admin, and as the two approved customers. Use existing credentials
  through secure access. Record only comparison results and public snapshot
  IDs; keep customer identifiers, credentials and raw logs out of documents.
- Confirm that personal orders, filter state, rewards and personal impact remain
  scoped to the signed-in account, including switching accounts on one device.
  Shared global counters agreeing does not mean private account data is shared.
- Checkout provider, cancellation/retry and duplicate-order tests belong in the
  isolated/sandbox verification first. Any real production transaction needs
  its approved test procedure. Do not use a live customer payment as a casual
  smoke check.
- Verify `/api/uc/refill/capabilities` against the approved scope. This repair
  does not authorize paid refill, money wallet, paid Care or auto-collection.
  Preserve the existing adjustment row and audit. Task #1062's formula change
  and #1005's exact binary/store approvals remain separate.

## 6. Release decision and recovery

PASS requires traceable source/artifact identity, passing required checks,
verified rollback files, healthy compatible APIs, correct served assets and
successful agreed browser/account/device journeys. A successful publish button,
green preview or matching version number alone is incomplete evidence.

If public navigation, auth, checkout or source compatibility regresses after a
client publication, stop advancing releases. Restore the complete previous
verified client selection and retained assets, then repeat the served checks.
For the consistency rollout, preserve the database-backed API, adjustment row
and audit; do not reset production data or re-run schema/import commands as a
client rollback. Replit's earlier-deployment option is usable only after its
artifact/API compatibility and retained-client selection are confirmed.

Record the decision in `docs/development-change-log.md` with timestamp, exact
commit/archive/build IDs, safe evidence links, pass/fail/unverified results,
owner of each unresolved dependency and next action.

**Next step:** finish the CI repair PR, review its exact-head checks and preview
report, then run the live comparison above before selecting a new publication.

References: [GitHub status checks](https://docs.github.com/en/pull-requests/reference/status-checks),
[required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks),
[Replit publishing monitoring](https://docs.replit.com/references/publishing/monitoring-a-deployment),
[Replit deployment rollbacks](https://replit.com/blog/introducing-deployment-rollbacks).
