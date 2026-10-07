---
name: Persistent browser fixture servers
description: Temporary HTTP fixtures must remain alive across the testing worker's browser actions.
---

HTTP fixtures used across browser actions need a persistent process lifetime,
not a foreground command limited to one tool call.

**Why:** A foreground fixture returned valid local API-operation results but was
terminated when the worker's command ended; the subsequent browser saw a 503.
This incorrectly looked like a product/checkout defect.

**How to apply:** Use a tracked background process and verify availability across
tool calls before attributing a browser/API failure to application code.
