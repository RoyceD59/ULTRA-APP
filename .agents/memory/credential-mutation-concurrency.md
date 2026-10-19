---
name: Credential mutation concurrency
description: Serialization and rollback rules when temporary-password delivery and self-service resets can overlap.
---

Temporary-password issuance and self-service password reset must use the same per-user database lock. The lock must cover credential mutation and external delivery for issuance.

**Why:** Without shared serialization, a valid reset link can replace a newly installed temporary password while that password is being delivered, causing the operator endpoint to report success for an unusable credential.

**How to apply:** Acquire the same per-user advisory lock before either mutation; revalidate reset tokens after locking; invalidate active reset tokens only after temporary-password delivery succeeds; on delivery failure restore the complete prior credential state and leave reset links usable.