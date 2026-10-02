# External source sync into Replit

## Source and scope

Imported the changed files from `RoyceD59/ULTRA-APP`, branch
`codex/preprod-harness`, revision
`55c2da9a8d732ffc4b087f3875214d99dd92348b`.

The comparison used the external fresh-import baseline
`3f5da0c340471becf001ea384ff4e4356047181c`. All 46 externally modified
files matched their baseline counterparts in this container before import.
The change set also contained 55 new files. All 101 selected files are
present; unrelated container files and local history were retained.

## Included changes

- Companion's six-tab navigation, compact dock, medium rail and expanded sidebar.
- Responsive grids, content/cart insets, swipe order and account-scoped cache
  refresh behavior.
- Deep-link serving, build identification, HTML cache policy and the browser
  map-refresh timer binding fix.
- Care Overview, refill economics/readiness and station/campaign governance.
- Additive database schema and append-only governance audit records.
- Isolated preproduction Compose harness, mock service, smoke/browser checks,
  start/reset scripts and GitHub workflows.

The external branch is not a complete financial refill system or a new
interactive web map. Its remaining rollout limits still apply.

## Replit adaptations

ProjectHub now offers **Admin → Care & Refill Activation** with two persisted,
off-by-default switches:

- **Care Overview**: controls Companion's overview of existing free-member features.
- **Station & campaign governance preview**: enables administrative review
  records only, not credit issuance or dispensing.

Changes require a live database-backed team administrator, survive restarts
and do not require client rebuilds. Companion checks the public capability
on mount/focus; governance operations check the persisted API gate.
Promotional refills, paid refills, wallets, paid care and automatic collection
remain disabled and cannot be enabled by these switches.

Schema changes have matching API startup guards and shared SQL migrations.
The governance workflow now uses the full isolated API test harness. Its
integration tests reject non-harness database names before performing SQL.

Automatic pnpm version switching is disabled in this Nix/Replit environment
to prevent recursive self-installs. The external CI version pin is retained;
the compatible frozen lockfile installs successfully here.

## Local verification

- Frozen-lockfile dependency installation and OpenAPI code generation passed.
- Shared libraries, API, ProjectHub and Companion TypeScript checks passed.
- The focused API suite passed, including persistent activation, independent
  partial updates, live administrator enforcement, hard-off transaction
  capabilities, immutable governance and test-database safety.
- Admin activation component tests and exact-unit input tests passed.
- Companion capability, responsive layout, build metadata, direct-route
  serving and preview-isolation checks passed.
- Managed API, Hub and Expo workflows were restarted. The API's additive
  startup guards ran successfully; public capabilities returned HTTP 200
  with both previews/transaction capabilities off.
- Companion web preview rendered all six navigation destinations.
- A signed-in browser check activated/deactivated both previews, confirmed
  persisted settings after reload, verified governance direct-access blocking
  while off and checked the controls at 390px without horizontal overflow.
  No station/campaign records were changed; both settings were restored to off.

Prior green GitHub runs apply to the external revision, not the subsequent
Replit activation adaptations. No Docker engine was run in Replit. Native
device/rotation testing remains a separate release check. Expo SDK 57 patch
packages were aligned during final validation; Expo Doctor now passes all checks.

**No production publication, production database change, Cloudflare deployment
or GitHub push was performed by this sync.**