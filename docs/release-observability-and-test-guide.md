# Release observability and implementation test guide

## Purpose and current status

Use this guide to determine whether approved code is actually running, not just
whether a build succeeded. It covers the API-first sign-in/upload security
release and provides a reusable checklist for later implementations.

**This guide is not publication approval.** No publication, production
initialization, schema changes, client advancement, or native distribution is
authorized by it.

The retained security candidate is:

`88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`

Expected build source identity:

`consistency-88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`

At the read-only check on **2026-10-08 at 15:20 UTC**, both public API hosts
returned compatible, fresh, agreeing impact snapshots. The API custom host
returned 404 for `/version.json`; the Replit host returned HTML rather than
revision JSON. Neither response identifies the API source. Deployment metadata
reported a successful public autoscale build, but matching build/image-size logs
were unavailable. **The security candidate is not verified live.**

These snapshot results are historical evidence, not a permanent freshness pass.
Repeat them after verified publication and immediately before client advancement.

Evidence:

- `infra/cloudflare/forest/rollout-evidence/auth-upload-security-live-verification.json`
- `infra/cloudflare/forest/rollout-evidence/auth-upload-security-preparation.json`
- `infra/cloudflare/forest/auth-upload-security/owner-approval.json`

## 1. Approval and release boundaries

Before publishing, record separate owner approval for the exact API candidate.
The existing record approves source selection only.

Tell customers:

> This security update requires a one-time sign-in for older sessions that had
> no expiry. Newly issued sessions expire after eight hours. No new refresh or
> logout feature is included.

Preserve these production settings:

| Setting | Required state |
| --- | --- |
| API build | `node infra/cloudflare/forest/build-approved-consistency.mjs api --copy-output` |
| ProjectHub client | Existing `release-build.mjs hub` predecessor selection |
| Companion client | Existing `release-build.mjs companion` predecessor selection |
| Post-build cleanup | `node scripts/prepare-deployment-image.mjs --post-build` |
| Production initialization / schema | No changes without separate approval |

Do not switch to whole-workspace source builds, change client pointers, remove
rollback assets, or manually run cleanup to make a verification check pass.

## 2. Verify retained inputs before testing

Run from the repository root:

```sh
node --input-type=module <<'JS'
import { verifyHandoff } from './infra/cloudflare/forest/consistency-handoff.mjs';
const info = await verifyHandoff();
console.log(JSON.stringify({
  candidateSha256: info.candidateSha256,
  baselineSha256: info.baselineSha256
}, null, 2));
JS
```

Pass only when verification exits successfully and the candidate hash matches
the exact approved hash above. This checks retained release inputs and approval
records; it does not establish that production uses them.

Read the retained README, scope and patch to identify the implementation being
tested. A passing working-tree test cannot substitute for a frozen-candidate
test.

## 3. Local implementation checks

### Packaging and rollout gates — no production writes

```sh
node --test \
  infra/cloudflare/forest/auth-upload-security.test.mjs \
  infra/cloudflare/forest/consistency-handoff.test.mjs \
  scripts/tests/deployment-image.test.mjs
```

Inspect failures rather than regenerating approval records. These checks cover
release validation, snapshot compatibility rules and cleanup behavior. They are
not proof of live deployment or actual publishing image size.

### Compile the selected candidate

This command installs/builds into the checksum-specific local staging folder;
it is not a publish command and does not copy deployment outputs:

```sh
node infra/cloudflare/forest/build-approved-consistency.mjs api --local-only
```

The builder runs retained dependency/security fixtures, API typechecking and
compilation. It does not run the two database-backed security fixtures or all
consumer typechecks. Verify shared libraries and each frozen consumer separately
when revalidating a changed candidate; use its staging folder, not the current
working tree.

### Database-backed checks — disposable test database only

Use the retained stage after successful local preparation. The stage root is:

`.consistency-build/88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82`

Run the existing test wrapper from its API directory:

```sh
cd .consistency-build/88f896ab82c4450ac11d9b21ce27035cc8596c0b36c122f29ff857ef124f5e82/artifacts/api-server
TEST_GLOB='src/tests/{customer-count-auth,storage-upload-allowlist}.test.ts' pnpm test
```

Use an approved development test infrastructure connection that can create and
drop disposable databases. Never use production credentials. Do not print the
connection string. Confirm the wrapper creates its per-run database and drops
it afterward. Do not invoke these fixtures directly against an existing
development or production database.

### Required security outcomes

| Area / retained fixture | Pass criteria |
| --- | --- |
| `jwt-session-expiry.test.ts` | Default eight-hour expiry; missing, malformed, expired and exact-boundary expiry rejected |
| `customer-count-auth.test.ts` | Active team members/admins retain access; the same bearer loses access immediately after deactivation/deletion; customer and invalid principals rejected |
| `review-media-signature.test.ts` | Exact MIME allowlists and bounded byte inspection; a claimed safe MIME cannot bypass signature checks |
| `storage-public-media-security.test.ts` | Safe inline types only; unsafe originals forced to download; original/derivative responses have sandbox CSP and nosniff |
| `storage-upload-allowlist.test.ts` | Unsupported uploads rejected; attachment verification enforces retained rules |

A test pass applies to those tested bytes and conditions. Record command,
candidate hash, time, exit code, failures and database cleanup result. Do not
copy access tokens, customer data, upload contents or secrets into evidence.

## 4. Publication evidence and image size

After separate approval and API-first publication, inspect the publishing build
logs and runtime logs. Save a sanitized release record containing:

1. Approval and publishing timestamps, and exact candidate hash.
2. Build command and proof that it selected the retained candidate.
3. Successful fixture, compilation and post-build cleanup results.
4. Final publishing image/layer measurement, its units and the platform limit.
   The earlier failure was at an 8 GiB image limit; use the actual limit reported
   by the new build. Local directory size is not an image measurement.
5. Successful image acceptance, deployment activation and startup.
6. A trusted connection between that build and the currently served API.

Check deployment metadata, but do not treat `hasSuccessfulBuild: true` as
candidate evidence. It may describe an older successful build. Missing logs
mean **unverified**, not **passed**.

Do not delete entire stage folders to reduce image size. Compiled workers and
static servers can still depend on their paths; keep rollback archives and
runtime assets.

## 5. Read-only live API checks

### Health

```sh
for origin in https://api.ucfilters.com https://team-horizon--jerryaroyce.replit.app; do
  curl --fail --silent --show-error --max-time 15 \
    -H 'Cache-Control: no-cache' "$origin/api/healthz"
  printf '\\n'
done
```

The current health endpoint reports application liveness. It does not certify
the database, external providers, security behavior or candidate identity.

### Fresh, agreeing snapshots

```sh
node --input-type=module <<'JS'
import { verifyLiveApi } from './infra/cloudflare/forest/consistency-handoff.mjs';
console.log(JSON.stringify(await verifyLiveApi(), null, 2));
JS
```

Pass requires HTTP success on both hosts, valid JSON and the exact compatible
contract: 64-character hex snapshot ID; positive integer adjustment revision;
`maxAgeSeconds: 60`; boolean lifespan availability; nonnegative finite totals;
calculation within the validator's freshness/future-clock bounds. Both hosts
must agree on comparison fields; their calculation timestamps may differ.

Timeout, stale calculation, incompatible fields, disagreement or an old
zero fallback blocks advancement. An unavailable probe does not prove downtime.
Capture UTC time and check clock accuracy before interpreting age failures.

### Source identity — currently an evidence gap

Do not assume `/version.json` exists on the API. Do not accept a 200 HTML
fallback as revision JSON. The Companion version at
`https://app.ucfilters.com/version.json` describes the client baseline checked
by the build script, not the running API's security implementation.

Require trustworthy build-to-runtime provenance or an owner-approved API
attestation mechanism identifying the candidate. A health response, matching
global totals, client version, or configured environment string alone does not
prove which API executable is serving traffic.

If this linkage is unavailable, mark source verification blocked. Do not claim
the sign-in/upload protections are live or add production diagnostics without
approval.

## 6. Signed-in and upload smoke tests

Production writes require separate approval and designated test accounts/media.
Never deactivate real staff, forge production bearers, or upload adversarial
files to public storage merely to demonstrate protection.

On an isolated staging environment using the retained candidate:

- Confirm an ordinary fresh login can access its authorized resources.
- Confirm a controlled old expiry-free session is rejected and signing in again
  restores access. Test expiry boundaries through fixtures rather than waiting
  eight hours or changing a production clock.
- Confirm customer A cannot attach customer B's media.
- Try approved valid media and controlled invalid MIME/signature cases.
  Confirm invalid attachments are rejected, not silently accepted.
- Check original and derivative response headers and download behavior.
- Confirm deactivated/deleted test team identities lose customer-count access.
- Remove authorized test fixtures and verify no production customers changed.

For a browser check, verify rejection messages are visible and recovery is
usable, not just that the network request failed. Record native/device checks
separately; local API tests do not certify physical-phone usability.

## 7. Ongoing observability

For each implementation, monitor a small set of signals:

| Signal | Interpretation and action |
| --- | --- |
| Per-host health status and latency | Investigate sustained errors/timeouts; compare hosts before blaming application code |
| Snapshot contract, age and agreement | Block client advancement on failure; inspect cache/calculation logs |
| Auth rejection rates | Expect a temporary rise after legacy-session expiry; investigate sustained fresh-login failures |
| Upload/attachment rejection rates | Distinguish invalid media from valid-file failures; inspect sanitized reason codes |
| Request 5xx, background-job failures | Correlate to publishing/startup time and operation; do not silently replay payments or notifications |
| Runtime memory/CPU and startup failures | Compare to pre-release baseline and inspect worker/module errors |

These are monitoring recommendations, not a claim that new metrics, alerts,
health dependencies or dashboards have been installed. Establish baselines and
owner-approved thresholds before activating alerts.

Prefer structured logs with UTC timestamp, service, operation, request ID,
status, duration and a sanitized error category. Never log Authorization
headers, cookies, reset tokens, signed upload URLs, passwords, connection
strings, email/phone/address or full request bodies. Public errors must not
reveal internal paths, stack traces or database details.

## 8. Release decision and recovery

Mark each gate **passed**, **failed**, or **unverified**, with evidence:

- [ ] Exact source selection and separate API publication approval.
- [ ] Retained candidate tests and compilation.
- [ ] Successful candidate publishing and actual image-size evidence.
- [ ] Currently served API linked to candidate.
- [ ] Fresh, compatible, agreeing public snapshots after publication.
- [ ] Approved signed-in/upload smoke checks, or explicit untested scope.
- [ ] No unexpected error/resource regression in the observation window.
- [ ] Separate approval before any client advancement.
- [ ] Separate approval before production initialization/schema changes.

If a gate fails, stop advancement. Preserve the evidence and retained
predecessor; obtain owner approval for any rollback or operational changes.
Do not turn an unavailable check into an assumed pass.

### Reusable implementation record

```text
Implementation:
Approved scope and candidate hash:
Owner publication approval:
Build / deployment identifier and UTC time:
Local fixture commands and results:
Database isolation and cleanup:
Actual image size / reported limit:
Served API source evidence:
Host checks, UTC time, freshness and agreement:
Authorized browser / device checks:
Error / resource baseline and observation window:
Untested or blocked items:
Client / production-init approvals (separate):
Decision: passed / failed / unverified
Recovery owner and approved next action:
```
