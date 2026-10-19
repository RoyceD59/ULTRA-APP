# Replit and main reconciliation — 19 October 2026

## Decision

Source recovery, local Companion verification and Replit rollback installation
passed. Publication remains not cleared: exact API/Hub release lineage,
account comparisons and physical-phone evidence remain separate gates. No
production publish, schema command, customer record change or Cloudflare
activation was performed in this reconciliation.

## Preserved identities

| Surface | Verified identity | Meaning |
| --- | --- | --- |
| GitHub main before this review | `7b392e75b800ad99aaf96a7e070a89e5230a8e7e` | PR #7 merged, applicable checks green |
| GitHub App baseline | `60e91e261701f19786b9e87362c4a6627cdc7fb9` | Replit's configured upstream was behind its checkout |
| Replit clean checkout recovered | `5e632ed16cbbda73f0f26f0c92a2d4924f375017` | 13 commits ahead, 193 changed paths |
| Preserved GitHub branch | `codex/replit-preserved-2026-10-19` | Exact recovered tip, no main overwrite |
| Live Companion | `1792278093274-833`, source `41d38f627258152d7cc7132b275f7c495e44e1ca1503391a165efed316e5212a` | Previously verified running release; source merge does not publish |
| Recovered selected source archive | `ee734d2d0e4d0fbb890900b694809b552e409e21a57e0fb8b53d3732dda75c7f` | Product browser/restock candidate, not proof of activation |

Replit's shell push failed with invalid credentials. A Git bundle of the 13
commits was downloaded through Replit's authenticated file interface, verified
against the local prerequisite commit, and pushed using the working local
GitHub connection. Original commit history was preserved. No token was copied,
new credential created, main reset or branch force-pushed.

## Integration and verification

The reconciliation combines main's CI repairs with the recovered Replit work.
Eighteen merge conflicts were confined to Companion tests and fixtures. It
preserves ready-account/provider guards, mounted analytics checks, strict
publication provenance, Windows-safe paths and the pinned browser setup.

The first full Companion run passed 995 of 1001 tests. The six failures were
stale expectations: opening a collapsed native HTML menu, retained authored
answers/details, derivative-first native photos with original-byte fallback,
and Notify me opening the product request form. Their assertions now check the
current behavior explicitly; security and account scoping were not removed.
The focused 16-test recheck and final full 1001-test run both passed, with no
skips. Browser emulation remains separate from actual iOS/Android evidence.

A new isolated API integration workflow runs the complete existing API runner
against a disposable PostgreSQL service using literal CI-only credentials and
no repository secrets. Its runner creates a separate test database and removes
it after execution. Its first run exposed the optional AI client's import-time
configuration requirement. CI now supplies a synthetic key and non-routable
`.invalid` origin, without changing production initialization or using a live
provider. A pending rerun must not be described as passed. Existing Companion,
foundation, governance and Docker preview checks passed on the first PR head.

The selected archive was inspected without extraction, installation, execution
of its application code or database access. Candidate, parent and scope hashes
match. The existing source validator accepted 1355 files, 1219 unchanged parent
files and exactly 136 allowlisted changed files. The frozen dependency lock is
unchanged relative to its retained parent. This is source integrity evidence;
it does not verify a prepared stage or compiled output.

## Schema and selection limits

PR #7 introduced no database schema changes. The recovered work includes
`0069_restock_requests.sql` and equivalent startup DDL: a restock-demand table,
indexes, and two customer-erasure triggers. Its DROP TRIGGER statements replace
the feature's named erasure triggers; there is no table truncation or stock
initialization in that migration. It still requires disposable-database tests
and an explicit release schema review before production startup can execute it.

The recovered inventory schema explicitly names its existing SKU unique
constraint to match startup SQL. This is intended to prevent Drizzle from
proposing another constraint/truncation; it is not authority to run db push.
The four constraint statements observed in the older successful deployment log
must not be replayed or blamed for a later publishing failure without evidence.

The selected archive uses a bounded feature allowlist. Its existence does not
prove that newer OAuth, admin registration-management or other working-tree
changes are included. Do not publish the entire reconciled workspace as a
shortcut. The public-image cache change also requires a separate publication of
the existing Cloudflare worker; a Replit publish cannot activate it.

## Remaining actions

1. Review the reconciliation PR and its exact-head checks, including the full
   isolated API result and existing Docker preview. Keep failures visible.
2. Replit browser access recovered through a fresh tab; no owner reconnect is
   now needed. Replit source remains preserved.
3. The actual served complete web/iOS/Android files were captured and installed
   into Replit's `infra/cloudflare/forest/rollback-static/` using the unchanged
   capture and collision-checking retention tools: 62 capture files, 60 asset
   references, 63 retained files including evidence, build `1792278093274-833`.
   Existing versions and selection pointers were not replaced. The earlier
   integrity assertion had stopped before capture because a Windows CRLF copy
   had a different byte hash; normalized LF matched the unchanged Git source.
   The publishing environment's handoff verification passed for the `ee734…`
   candidate. Its existing Companion build is `1792286812208-43226`, explicitly
   `localOnly: true` and `compiled-not-published`, with the production API origin.
4. Verify current selected archive, API/Hub lineage, approved schema delta and
   compiled stage before publication. Preserve the current database-backed
   adjustment row/audit and existing hosting, DNS, auth and distribution.
5. Complete configured-admin/two-approved-customer checks through secure access.
   Keep identifiers and credentials out of chat/files. Phones remain under
   #822; exact native binaries/store approval remain under #1005.

If another gated Replit publish fails without diagnostics, use its build ID and
UTC timestamp for a Replit Support investigation. No support message has been
sent, and no code fix for the unexplained build failure is claimed here.
