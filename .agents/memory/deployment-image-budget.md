---
name: Frozen deployment image budget
description: Trim generated build dependencies without removing runtime staging paths or rollback assets.
---

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
