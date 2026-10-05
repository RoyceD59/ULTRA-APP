# Companion release and global-impact consistency

## Evidence and limits — 5 October 2026

These are **source/preparation results, not a publication announcement**.

Credential-free production reads found:

- The deployment-reported public ProjectHub/API URL and
  `https://api.ucfilters.com/api/uc/impact` both returned 5 users, 1,150 litres
  and 2,300 bottles, with zero reported offsets. These older responses do not
  establish that a real legacy adjustment file exists; the old API could
  silently default to zero.
- `https://app.ucfilters.com/version.json` selected build
  `1791145371862-306`, revision `a787b1a16fad710f8725a9e1fb7722a89661c54e`.
  Public iOS and Android Expo Go manifests selected that same build. Both
  public native bundles contained the production API hostname literal.
  A literal in a downloaded bundle is not an observation of an installed app's
  requests or proof of its loaded release.
- Those public manifests have no new `companionRelease` identity. They still
  declare updates disabled and the unconfigured placeholder update URL.
  Expo Go delivery is **not** installed standalone-binary delivery.
- No production customer sign-in investigation was resumed. No installed
  binary, physical phone, store distribution, or authenticated production
  personal-impact comparison was verified.

Consequently, independently stale browser/device queries, older JavaScript,
different installed origins and legacy process-local adjustments remain
**risks**, not a confirmed explanation for the reported account differences.
The credential-free sample did not reproduce unequal production global totals.

Local preview is a separate database/release: its verified response returned
9 users, 4,850 litres and 9,700 bottles, revision 1, with a comparable snapshot.
It is not evidence that production totals changed. A 390px About preview
rendered the snapshot status, last successful refresh, retry and loaded
development release without an application crash.

## Implemented boundary

Global adjustments and their audit trail now use the shared database. Startup
DDL and the standalone schema migration agree. Valid historical input is
imported only when the shared row is absent; imports and staff writes share
one transaction lock. Existing rows win over later legacy files. Staff edits
support optimistic revision checks, preserve omitted fields and use the
verified staff identity rather than client-supplied attribution. An unknown
historical timestamp remains unknown, not a fabricated 1970 update.

Global aggregates retain the existing formulas, fulfilled-order eligibility,
offline-client semantics and live-catalogue lifespan lookup. All database
components are read in one repeatable-read transaction. A content/revision
snapshot ID, server calculation time, adjustment revision and 60-second
receipt freshness contract make comparisons meaningful. Snapshot IDs are
comparison identifiers, not proof of independently verified environmental
outcomes. Catalogue lifespans retain their existing ten-minute cache; a
different lifespan calculation is a different snapshot, not an account
permission or personal-impact change.

Companion public reads carry no account token. Home and About share the same
query. They retain previous values only with stale/failure/offline labels,
last-successful-receipt time and retry; missing/unverifiable responses do not
become zero-filled live figures. Unavailable catalogue days are displayed as
unavailable. Native foreground/reconnect uses the existing read-only recovery
path; mutations are not replayed. ProjectHub labels the same snapshot and
ignores late superseded refreshes. Its background refresh does not overwrite
an open adjustment form.

Personal impact, ownership, purchases, permissions and customer history remain
separate. Programme policy, pending-evidence status and anonymous forest access
are preserved. No impact formula, eligibility rule, account data or historical
adjustment was intentionally reset.

## Prepared package, not an active release

Run:

```sh
node infra/cloudflare/forest/prepare-companion-consistency.mjs
node --test infra/cloudflare/forest/companion-consistency-package.test.mjs
```

The candidate is `.companion-consistency-release/release-sources.tar.gz`;
`candidate.json` records its scope and checksum.

- Frozen predecessor SHA-256:
  `bdc71175d7f653c99d9d431770200915acd2e8333220c59b8b66a3d48e03d3b2`
- Prepared candidate SHA-256:
  `db2ef861871dcff39cde08350d9374e9b8d1220409e2f506141cf9c4666cad59`
- 1,227 unrelated frozen files remain byte-for-byte unchanged.
- The approved archive, release manifest, active selection, `.prepared` marker,
  hosting, DNS, authentication and rollback assets were not changed.

The candidate transplants only this feature and its necessary frozen-build
prerequisites, including atomic selection and native reachability dependency.
It deliberately retains the archived monolithic web pipeline rather than
publishing unrelated workspace bundle-splitting/SEO changes. Source-contract,
syntax, archive-boundary and prepared-server fixture tests passed; **the full
candidate has not been compiled into browser/native release assets**.
Do not label its checksum as a built binary or published frontend.

Activation validates one selected browser/Expo Go build, matching supported
metadata and the approved production API origin `https://api.ucfilters.com`.
Retained and partially staged assets cannot advance one platform independently.
Rollback selects the complete prior build for all three delivery paths.

## Separate approvals and distribution prerequisites

1. Obtain explicit approval for the exact candidate checksum and subsequent
   production API/frontend publication. Do not point the existing release
   builder at the entire current workspace or silently lift the frozen gate.
   Compile the isolated candidate through the existing preparation/build
   process and inspect its resulting archive, build IDs and origins first.
2. Before production initialization, capture/compare actual legacy adjustment
   evidence from the serving instance(s), read-only. If files disagree, are
   missing or malformed, stop and have the team choose verified historical
   input. An old API zero fallback does **not** authorize a new zero row.
   An approved operator can run
   `pnpm exec tsx scripts/import-global-impact.ts /verified/impact-override.json`
   from the API package against the approved target database. This is a write
   requiring target-specific approval; it was not run against production.
3. Deploy the compatible API before delivering clients that require snapshot
   metadata. Extended responses remain compatible with older clients, but
   clients predating this feature cannot gain freshness/release notices remotely.
   Keep the database schema and shared adjustment row across rollback; do not
   revert to file authority or reset the imported values.
4. Browser/Expo Go publication is distinct from native binary distribution.
   Existing installed binaries with disabled automatic updates cannot be
   replaced by a website publish or a notice. Build a new approved binary
   containing these checks and native reachability support. Production binary
   preparation must provide an identifiable release and the approved API origin.
5. `data/supported-native-releases.json` intentionally has an empty native policy.
   Add an entry only after verifying the actual app store listing/application,
   platform, runtime, version and exact release identity. URL-shape validation
   alone is not verification of ownership or availability. Store configuration,
   signing/submission prerequisites and distribution need separate approval.
   Until then installed clients report support verification unavailable.
6. OTA remains disabled. A real configured update service, compatible runtime,
   credentials/project setup and separate approval are prerequisites for any
   future OTA work. The placeholder URL must not be activated.

Browser notices are advisory and require an explicit save/checkout confirmation
before reload; they do not auto-reload. Verified Expo Go launch links can reopen
the approved project when the customer is ready. Standalone notices open only
approved platform/runtime-scoped store destinations. Failed, offline, expired
or incompatible release metadata makes no claim that a client is up to date.

## Verification performed and post-approval checklist

Current source checks passed: shared-library and all three artifact TypeScript
checks; 19 isolated API/permission tests; 37 Companion component/cache/native
recovery/release/delivery tests; 4 ProjectHub component tests; 2 prepared-source
and prepared-server selection tests. These are not a full-suite or live-device
certification. Browser-fixture results are recorded separately below.

One local browser pass at 390×844 verified Home/About and the staff dashboard
with intercepted **synthetic** global responses. Home and About displayed the
same snapshot and four cards; unavailable days remained unavailable.
HTTP 503 and browser-offline refreshes retained the previous figures with
explicit stale labels and last-success times; restoring the response and
retrying returned the view to current. Programme/forest access and safe
development-release wording remained visible. Home/About had no horizontal
overflow. The staff dashboard used a mock local UI session and intercepted
read-only API responses; its global values matched and refresh failure retained
stale-labelled values. This verifies rendering and interactions, **not**
authentication, real customer data, staff write authorization or publication.
No production login, real credentials, data writes or UI saves were used.
The isolated API and component tests separately cover staff authority and
concurrent writes.

After publication/distribution approval:

- Confirm the **actually served** browser HTML, `/version.json`, iOS and Android
  manifests and launch assets identify one selected completed build. Inspect
  the served bundle's API origin; repeat through both public hosts.
- Compare exact snapshot IDs and numeric values on Home, About and ProjectHub,
  signed out and on two approved customer accounts. Do not use the paused
  production customer-login investigation until separately authorized.
  If snapshots differ, compare calculation/receipt times before alleging
  account-specific global totals. Check personal impact remains personal.
- Make one approved staff adjustment with a revision precondition, verify
  audit attribution, concurrent-edit conflict, two API instances and a restart.
  Confirm a later legacy import cannot overwrite that shared adjustment.
- On narrow browsers and actual iOS/Android devices, verify background/foreground,
  airplane mode, reconnection, failed refresh, retry and last-known/stale labels.
  Confirm account switching/late requests cannot expose private data.
- Keep an old browser tab open through a selected-build change and rollback.
  Verify the advisory notice and deliberate safe reload, without interrupting
  checkout, repeating reloads or blocking offline access.
- On a newly distributed compatible standalone binary, verify loaded identity,
  runtime-scoped policy and the real store destination. Record unsupported old
  binaries separately; do not report Expo Go checks as installed-app evidence.
- Test partial preparation failures and whole-build rollback without deleting
  retained assets. Record actual live build IDs, snapshot IDs, timestamps,
  physical-device versions and any remaining access limits.
