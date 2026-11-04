# Where to find builds and unfinished work

## GitHub source and downloadable web previews

The source of record is [RoyceD59/ULTRA-APP main](https://github.com/RoyceD59/ULTRA-APP/tree/main).
Companion code is in `artifacts/uc-companion`, Project Hub in
`artifacts/projecthub`, and the shared backend in `artifacts/api-server` and `lib`.
New task work starts on a `codex/<task>` branch from current main, with its own
pull request and entries in `docs/development-change-log.md`.

To find a newly tested web build:

1. Open [Isolated preproduction preview](https://github.com/RoyceD59/ULTRA-APP/actions/workflows/preproduction-preview.yml).
2. Choose the successful run for the intended pull request/commit. A failed run
   is not an accepted build; never substitute a previous green run silently.
3. Open its Summary and download `web-preview-builds-<run ID>` from Artifacts or
   the download link in the summary. GitHub sign-in may be required. Builds are
   retained for 14 days; request another run if the download has expired.
4. The ZIP contains `companion/`, `hub/`, `manifest.json`, `SHA256SUMS` and
   `README.txt`. The manifest records the exact CI checkout commit and file
   hashes. The workflow verifies those hashes before uploading. The separate
   `preview-evidence` download contains browser reports, screenshots and CI-only
   container diagnostics (retained for seven days).

These are fixture-configured **web review exports**, copied from containers
after the browser checks pass. They are not a hosted staging site, signed native
binary, production archive or proof of live sign-in/payment behaviour. No API
server, database, customer accounts or credentials are included. Opening an
`index.html` file directly does not start the full application.

For an interactive isolated full-stack preview, check out the exact source in
the manifest and run `scripts/preview/Start-Preview.ps1` with Docker Desktop's
engine running and enough disk capacity for images, dependencies and PostgreSQL.
It provides Companion at `http://localhost:3000`, Hub at `http://localhost:5055`,
and API health at `http://localhost:5000/api/healthz`. These are local URLs, not
links a phone on another network can open. Use the existing Stop/Reset scripts;
`-DropTestData` applies only to the explicitly disposable preview data.

## Replit production-candidate preparation

Publishing project: [jerryaroyce/ULTRA-APP](https://replit.com/@jerryaroyce/ULTRA-APP).
The project requires its owner's signed-in session. A logged-out/private-project
404 is not evidence that the deployed app is down.

The currently selected source in main is
`ee734d2d0e4d0fbb890900b694809b552e409e21a57e0fb8b53d3732dda75c7f`,
at `infra/cloudflare/forest/product-browser-restock-review/release-sources.tar.gz`.
Its checksummed Replit stage is:

```text
.consistency-build/ee734d2d0e4d0fbb890900b694809b552e409e21a57e0fb8b53d3732dda75c7f/
  companion-build.json
  artifacts/uc-companion/static-build/
  artifacts/projecthub/dist/public/
  artifacts/api-server/dist/
```

These paths describe the artifact builder's outputs; each output still requires
verification in the actual publishing workspace. The last verified Companion
candidate on 19 October was build `1792286812208-43226`, marked `localOnly: true`
and `compiled-not-published`. It cannot be promoted by deleting that marker.
Rebuild using the approved publication path and current retained rollback input.
Stage existence/current contents and API/Hub image lineage must be refreshed
after Replit access returns.

Editing or merging GitHub main does not change the selected frozen archive.
Pending source features outside its bounded allowlist need their own reviewed
archive update and checks before publication. Keep the exact source hash,
compiled build ID and public served version distinct.

## Remaining tasks and their delivery locations

| Work | Where to inspect it | Acceptance still needed |
| --- | --- | --- |
| Web preview and navigation | GitHub preview run and its two artifact downloads | Passing run for the exact requested source |
| Existing/new customer journeys and private-data isolation | Isolated API tests; then securely signed-in candidate/browser | Actual authenticated acceptance; no named two-customer prerequisite |
| Candidate API, Hub and Companion publication | Replit Publishing plus the checksummed stage above | Source/image/schema lineage, rollback retention, approved production-mode build and served-asset checks |
| Physical iPhone/Android behaviour, #822 | Approved candidate delivery selected in Replit; actual device results | Matching build identity, photos/maps/navigation/ratings/account checks; no current new phone link is claimed |
| Public image-cache change | Existing Cloudflare router worker from `infra/cloudflare/ucfilters-router.js` | Separately verify/publish the existing worker; Replit publication does not deploy it |
| Store distribution, #1005 | Approved store records and exact native binary | Owner signing/store readiness and binary approval; separate from an ordinary web release |

The public URLs remain [Companion](https://app.ucfilters.com) and
[Project Hub](https://hub.ucfilters.com). The live Companion was freshly checked
on 20 October and still serves `1792278093274-833`, not the newer local-only
candidate. Its existing Expo Go URL is a live-release URL, not proof that pending
changes are available for phone acceptance.

## Current dependencies and next action

At the 20 October inspection, GitHub access worked. The available Replit browser
was signed out; sign in there and open the project to enable candidate inspection
and controlled delivery. Local Docker was installed but its engine was stopped,
and the C: drive had approximately 250 MiB free. Do not attempt a large local
container build in that state. GitHub-hosted Docker checks provide an alternate
verification route without using local image space. No user files were deleted
to make room.

Next: use the passing GitHub preview download for source review; restore the
Replit session, verify the selected stage/rollback and API/Hub lineage, coordinate
secure account and #822 device acceptance, then publish and verify the approved
release. Preserve the database-backed adjustment row/audit and all personal
account boundaries.
