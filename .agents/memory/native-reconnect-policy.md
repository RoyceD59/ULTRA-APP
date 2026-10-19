---
name: Native reconnect safety
description: Companion reconnect recovery must never queue writes or hide offline page errors.
---

Keep native reconnect recovery read-only. Writes should fail once rather than wait for connectivity, and offline reads should continue to produce explicit recovery states while retaining cached data.

**Why:** React Query's online manager can resume paused mutations as well as reads; a connectivity integration alone can unintentionally turn an offline action into a later payment or submission. Paused initial reads also stop reporting active loading, which can be mistaken for an empty page.

**How to apply:** Preserve the native fail-explicitly policy when adding queries or mutations. Never override a write to use online-gated queuing or automatic retry. Keep native connectivity imports platform-isolated so browser startup and browser online handling remain unchanged.

Saved rewards QR codes are candidates, not proof that they are still active. Failed or offline verification must hide the code and its Ready state. Creating or replacing a code always requires a deliberate customer action.

**Why:** The owner requested reliable account QR synchronization without reviving revoked codes or rotating credentials during read-only reconnect recovery.

**How to apply:** Keep foreground, reconnect and retry paths read-only. Preserve legacy codes only after server validation; missing or lost credentials must lead to explicit recovery rather than automatic issuance.
