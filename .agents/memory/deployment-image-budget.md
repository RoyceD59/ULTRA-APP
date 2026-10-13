---
name: Frozen deployment image budget
description: Trim generated build dependencies without removing runtime staging paths or rollback assets.
---

An isolated release's dependency graph does not establish the versions loaded
by externalized modules in the main runtime. Align separately approved root
manifests/lockfile and actual installed external dependencies before publication.

**Why:** A reviewed staging graph loaded fixed sharp/librsvg, but the API bundle
externalizes sharp and main still had its older dependency. Selecting/copying
the compiled archive alone would not deliver that security fix.

**How to apply:** Check external native dependency versions from the runtime
package context, retain them through image cleanup, and treat any mismatch with
the approved release graph as an API-publication blocker.

Keep generated build-stage dependency trees out of the final publishing image,
but do not delete whole frozen stages merely because compilation finished.

**Why:** An API-first publishing build compiled every service successfully but
failed at the 8 GiB image limit. Frozen API logging workers can retain absolute
staging-output locations, and the Companion core-Node server still serves assets
from its frozen stage. Deleting those entire stages would create runtime failures.

**How to apply:** Clean installed dependencies only after all artifact builds
complete. Preserve compiled worker paths, preparation identities, core servers,
static builds and retained source/rollback inputs. Preserve root runtime
dependencies, including workspace-specific dependency links. Do not recursively
delete every directory named node_modules: public font/image assets can have
that name in their URL layout. Verify the frozen server and logging workers
without build-stage installations before asking for a publishing retry.

Approved stage-local workspace resolution links are runtime inputs too; retain
validated relative links into the same frozen stage when pruning installations.

**Why:** The product-page server added a shared CommonJS import. Compilation and
image upload succeeded, but deleting all stage-local module links caused startup
to crash. The old startup fixture loaded a legacy server and missed this change.

**How to apply:** Exercise the selected release's actual server and shared modules
after cleanup, not an older retained release. Reject links outside that stage
before pruning; do not keep the large installed dependency graph as a workaround.
