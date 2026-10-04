---
name: Schedule-update deduplication
description: Meaning of a repeated catalogue lifespan correction versus a legitimate new correction.
---

Deduplicate schedule-update notices against the currently applied activation, not a permanent history of previously seen lifespan values. A later correction back to an earlier lifespan is still a new change and must be applied.

**Why:** The requested behavior suppresses repeated notices for the same already-applied change across remounts, not future catalogue corrections. A separate notice marker must not diverge from the actual saved reminder schedule.

**How to apply:** Treat the persisted rated lifespan as the applied value, and keep its comparison and rescheduling within one per-account operation. Component product-list references are only an optimization, not durable proof that a correction was applied.