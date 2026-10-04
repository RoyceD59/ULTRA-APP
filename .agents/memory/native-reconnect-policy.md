---
name: Native reconnect safety
description: Companion reconnect recovery must never queue writes or hide offline page errors.
---

Keep native reconnect recovery read-only. Writes should fail once rather than wait for connectivity, and offline reads should continue to produce explicit recovery states while retaining cached data.

**Why:** React Query's online manager can resume paused mutations as well as reads; a connectivity integration alone can unintentionally turn an offline action into a later payment or submission. Paused initial reads also stop reporting active loading, which can be mistaken for an empty page.

**How to apply:** Preserve the native fail-explicitly policy when adding queries or mutations. Never override a write to use online-gated queuing or automatic retry. Keep native connectivity imports platform-isolated so browser startup and browser online handling remain unchanged.

In Node tests, import React Query from the same module format as the helper being tested when testing shared managers.

**Why:** CJS and ESM exports can instantiate separate singleton managers; an observer then never sees connectivity changes sent to the other instance, despite correct app behavior.

**How to apply:** Match the helper's package instance in the test harness rather than adding workarounds to production recovery.