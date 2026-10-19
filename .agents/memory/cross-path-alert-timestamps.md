---
name: Cross-path alert timestamps
description: Rules for shared dedupe timestamps updated by manual and scheduled notification paths.
---

When manual and scheduled notification paths update the same per-entity dedupe timestamp, persist only after successful delivery and use a monotonic update that cannot replace a newer timestamp with an older one.

**Why:** A scheduled run may capture its time before a later manual alert succeeds, then finish afterward. An unconditional scheduled upsert would shorten the dedupe window by overwriting the newer manual timestamp.

**How to apply:** Use the delivery-completion time and an update equivalent to `GREATEST(existing, incoming)` in every path that writes the shared alert history.