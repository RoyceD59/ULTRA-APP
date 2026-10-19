---
name: Database pool ownership
description: Avoid pool starvation when helpers acquire their own connections.
---

Never hold a transaction connection while awaiting an independent helper that
acquires from the same shared pool. Resolve independent reads before acquiring
the transaction client, or pass that client through all transactional helpers.

**Why:** At pool-capacity concurrency, every request can hold one connection
while waiting for another; no connection is available to let any request finish.

**How to apply:** Exercise at least pool-capacity concurrent callers with bounded
deadlines, and assert that unrelated pool queries still progress. Sub-capacity
concurrency alone cannot establish absence of this failure.
