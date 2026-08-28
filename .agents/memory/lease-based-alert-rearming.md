---
name: Lease-based alert rearming
description: Concurrency rules for rearming product-level notification claims while provider delivery may still be active.
---

Rearming a notification cycle must never delete a live delivery claim. Mark the
claim as pending rearm, let its owner finish, then clear it. Reconcile the case
where delivery completes between the reset check and pending-state transition.

Provider delivery must have a real abort deadline shorter than the database
claim lease. Merely racing a timeout without cancelling the underlying request
does not make lease expiry safe.

**Why:** A scheduler reset can overlap a request-path send. Deleting the claim
or its idempotency key while that provider request is still active permits a
second key and duplicate notification; missing the completion transition can
instead leave a sent marker suppressing every later cycle.

**How to apply:** For any alert shared by request and scheduled paths, test the
live-claim reset, completion-between-transition, thrown-send retry, and
lease-boundary orderings deterministically.