# Ultra Clear preproduction preview

This preview runs the **Companion**, **Project Hub**, API, a disposable PostgreSQL database, and a mock Team AI endpoint. It does not deploy or change `app.ucfilters.com` or `hub.ucfilters.com`. It uses no production account data, payment keys, or outbound agent credentials.

## First run on Windows

1. Install Docker Desktop, open it, and wait until it reports the engine is running. Keep Docker in Linux-container mode. Node.js 24 is needed for the local smoke check.
2. From this repository folder, run `powershell -ExecutionPolicy Bypass -File scripts/preview/Start-Preview.ps1`. The initial build can take several minutes.
3. Open [Companion](http://localhost:3000/), [Project Hub](http://localhost:5055/), and [API health](http://localhost:5000/api/healthz). Only the computer running Docker can reach these loopback ports.
4. To inspect compact, medium, and expanded browser layouts locally, install the pinned tools once with `corepack pnpm install --frozen-lockfile --ignore-scripts` and `corepack pnpm exec playwright install chromium`, then run `corepack pnpm exec playwright test`. The GitHub workflow does this automatically and saves screenshots.

All preview services are named under the fixed `ultra-preview` Compose project. The database name is `ultra_preview`. The API refuses live domains and credentials in preview mode. The database, API, Hub, Companion, and Team AI mock stay on an internal network without external access. A credential-free Nginx gateway joins that network and a browser-facing bridge; only its ports are published, on `127.0.0.1`. This allows safe inspection of public pages and API behavior but means sign-in, payments, real agent actions, live maps/tiles, and cross-account data synchronization need a later connected staging environment.

## Stop, reset, and recover

- To stop without losing synthetic test data: `powershell -ExecutionPolicy Bypass -File scripts/preview/Stop-Preview.ps1`.
- To restart all preview services and keep synthetic data: `powershell -ExecutionPolicy Bypass -File scripts/preview/Reset-Preview.ps1`.
- If migrations or test data have become unusable, start a clean preview database: `powershell -ExecutionPolicy Bypass -File scripts/preview/Reset-Preview.ps1 -DropTestData`. This removes only the `ultra-preview` containers and their preview volume, then rebuilds them. It cannot remove the production database.
- If startup fails, use `docker compose -p ultra-preview -f infra/preview/compose.yaml logs --tail 150`. Fix the failure on the branch, rerun the reset, and keep the last passing GitHub run as the baseline.

## Staged release and fallback

| Stage | Evidence to retain | If the stage fails |
| --- | --- | --- |
| 1. Pull request | Tests, container logs, and browser screenshots from **Isolated preproduction preview** | Keep the pull request unmerged; restore the last passing branch state. |
| 2. Connected staging | Separate staging domains, database, test accounts, and staging-only integration keys. Test sign-in, cross-account updates, map tiles, payment sandbox, and agent permissions. | Stop the staging release and restore its disposable database snapshot; do not point staging at production. |
| 3. Production release | Recorded source commit, deployment ID, migration result, API health, and mobile/desktop checks | Roll back app/API to the previous deployment only if its schema remains compatible; otherwise apply a reviewed forward fix. Never reset or replace live customer data with preview data. |
| 4. Post-release watch | Error rates, page load, account sync, payment/refill audit events, and map loading | Pause further rollout, preserve logs and current database state, use the recorded deployment ID, then run a focused recovery check. |

The repository currently has no verified connected staging deployment or production rollback control. Before stage 2, provision distinct staging origins and credentials. The Expo `preview` APK profile now **fails closed** until `EXPO_PUBLIC_API_DOMAIN` and `EXPO_PUBLIC_DOMAIN` are set to HTTPS staging origins and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is a test-instance key; it cannot silently target the live app. The production EAS profile is unchanged. Before stage 3, identify the live Replit deployment, snapshot/restore mechanism, and owner of the production database. A green local preview alone is not a production release approval.

## GitHub checks

The `.github/workflows/preproduction-preview.yml` workflow is configured for pull requests and manual dispatch, without repository secrets. It builds the containers, verifies database initialization and CORS isolation, opens both web apps in Chromium at three Companion widths, and uploads logs/screenshots. Its CI database volume is removed at job end. The import into this Replit workspace has not executed Docker or verified a GitHub Actions run; only an actual Actions result establishes whether the external workflow passed. A failed build or screenshot test blocks the evidence gate until fixed.