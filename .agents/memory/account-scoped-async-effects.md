---
name: Account-scoped async effects
description: Avoid losing legitimate asynchronous results while preventing stale account results from reaching the UI.
---

Cancel account-bound asynchronous work when its account or underlying record changes, not merely because the parent supplies a new callback reference. Use the latest callback for valid result delivery, and release deduplication markers when an operation is invalidated.

**Why:** Inline parent callbacks can change during unrelated rerenders. Cancelling their pending work while retaining a “already synced” marker can permanently discard valid UI results even though storage and notification updates succeeded.

**How to apply:** When adding shared-device account-switch guards, test a delayed result after both a same-account callback change and a different-account transition. Also verify that an invalidated operation does not suppress replacement work.