---
name: Companion session rejection
description: Scope and concurrency rules for automatic Companion sign-out after account deletion or password reset.
---

Automatically end a Companion session only for the exact deleted-account or password-reset session-expired 401 contract, not every authentication failure. Apply the same rule to manual and generated requests.

**Why:** Endpoint-specific 401s may represent unrelated authentication failures. Concurrent rejected requests must not supersede the first queued credential removal, and delayed responses must not clear a newer login.

**How to apply:** Carry the bearer actually sent by the failing request, invalidate the active token synchronously before awaiting persistence, and disable query retries for the exact forced-sign-out contracts.