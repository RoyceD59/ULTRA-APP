# Release validation holds — 6 November 2026

| Reported hold or follow-up | Resolution and evidence boundary |
| --- | --- |
| Nine Expo SDK patch mismatches | Reproduced: 19/20 Doctor checks passed. Aligned the nine package ranges and pnpm lockfile within SDK 57. Local dependency validation and Doctor now pass 20/20 without exclusions. Companion CI and Replit validation execute the installed tools. |
| Alison-support API test: 503 instead of 200 | The supplied report says this cleared on rerun. Its exact support-test file/version is not in this checkout. No production 503 handler was weakened. Run the complete existing API CI suite on this branch's disposable PostgreSQL. Clarify whether the reported 314 count means files, cases or a subset before comparing counts across versions. |
| Alison browser check: preview 502 | The Docker workflow already waits for services and smoke-checks API/Hub/Companion. Run the welcome check afterward. Add explicit startup/HTTP diagnostics, fix its stale category label and use an explicit localhost-only catalogue fixture in CI. Preserve clock, positioning, filtering, navigation and dismissal assertions. Fixture UI testing is separate from live provider and phone acceptance. |
| Frozen auth/upload checks in active gate | The production builder already executes frozen JWT-expiry, media-signature and public-media fixtures before compilation. Keep DB-backed fixtures out of production builds. Correct the stale test expecting the old Hub/Companion builder and add a CI release-gate job. |
| Brittle counts and prebuilt-stage dependency | Use checked metadata and actual archive path sets instead of historical literal counts. Extract isolated stage fixtures from the approved archive. Copy the current source-verifier inputs into the startup fixture. Retain exact hashes, byte/mode checks, rejected tampering and rollback collision guards. |

## Exact dependency alignment

| Package | Before | After |
| --- | --- | --- |
| expo | ~57.0.30 | ~57.0.32 |
| expo-notifications | ~57.0.23 | ~57.0.25 |
| expo-sharing | ~57.0.23 | ~57.0.25 |
| expo-constants | ~57.0.22 | ~57.0.23 |
| expo-glass-effect | ~57.0.4 | ~57.0.5 |
| expo-image-picker | ~57.0.20 | ~57.0.21 |
| expo-location | ~57.0.21 | ~57.0.23 |
| expo-router | ~57.0.28 | ~57.0.30 |
| expo-splash-screen | ~57.0.10 | ~57.0.11 |

Use pinned pnpm 10.28.2. The first local Expo fix command selected a different
pnpm from PATH and refused the existing store. The successful installation used
the pinned binary and skipped lifecycle scripts. Require a subsequent successful
frozen-lockfile install; keep all existing security overrides and patch files.

## Completion and release steps

1. Require green Companion/Doctor, complete isolated API, Docker/Alison UI,
   frozen release gate, foundation and governance checks on the final branch.
   Keep failed runs and focused/complete coverage distinguishable.
2. Reconcile any newer Replit-only validation/support changes before applying
   this branch. Preserve that working tree; do not replace it with stale `App`.
3. The source-only publication archive is distinct from main's manifest/lockfile.
   This repair does not regenerate, select or publish an archive. Carry the
   alignment into the actual next reviewed candidate using existing integrity
   tooling, then rerun its frozen validation/compilation. Do not edit an approved
   archive in place, remove `localOnly`, or treat a source merge as deployment.
4. Preserve #1007's shared adjustment/audit and all rollback assets. No production
   DB tests, imports, schema push or initialization are needed. Authenticated
   live acceptance and #822 phone evidence remain separate.

At preparation, Doctor passes locally; new CI results are pending observation.
The initial Windows release-test run encountered CRLF tar-listing, Python-command
and stale-fixture issues. It is not passing evidence. Run the release gate on
Linux CI; preserve source byte/mode checks rather than hiding platform differences.

Reference: [Expo dependency alignment](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).
