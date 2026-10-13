---
name: Persistent browser fixture servers
description: Persistent HTTP fixture lifetime and explicit graceful cleanup.
---

HTTP fixtures used across browser actions need a persistent process lifetime,
not a foreground command limited to one tool call.

**Why:** A foreground fixture returned valid local API-operation results but was
terminated when the worker's command ended; the subsequent browser saw a 503.
This incorrectly looked like a product/checkout defect.

**How to apply:** Use a tracked background process and verify availability across
tool calls before attributing a browser/API failure to application code.

Tracked-tool force-stop does not establish that application signal handlers ran
or that an isolated database was cleaned up. Use explicit graceful shutdown and
verify the owned database and private temporary files are gone.

**Why:** A force-stopped retained fixture left its synthetic database behind
without emitting its cleanup event. Process termination and cleanup completion
are distinct facts; SIGKILL cannot run handlers.

**How to apply:** Keep restricted ownership/control metadata. Before signaling,
verify the supervisor identity so PID reuse cannot stop an unrelated process.
Reclaim only the exact owned database after its supervisor has stopped, never
through a broad stale-prefix sweep. Confirm removal with a read-only query and
record retained health, graceful stop and forced-stop recovery separately.
