---
name: Runtime observability safety policy
description: Operational evidence boundaries and intentional alert delivery tradeoffs.
---

Runtime diagnostics are untrusted operational evidence, never proof of authenticated
customer activity, functional success, recipient delivery or physical-device coverage.
Keep this separate from approved business analytics and customer decisions.

**Why:** The observability assignment explicitly separates privacy-safe diagnostics
from business analytics and rejects claims of native OS crash/device coverage from
JavaScript fixtures. Public collection cannot establish a customer's identity.

**How to apply:** Preserve these boundaries in support tools, diagnostic context
changes, UI wording and runbooks; do not add customer identity or entered content
to make public reports seem authoritative.

Operational transitions intentionally favor at-most-once delivery over automatic
retry after an ambiguous claim/provider outcome.

**Why:** A crash or uncertain provider response must not produce repeated unsolicited
notifications. A possibly missing notification is displayed as uncertain, not
quietly replayed.

**How to apply:** Keep new destinations disabled until explicitly configured,
maintain a no-delivery dry-run, and do not add automatic retries without revisiting
this tradeoff and its durable deduplication requirements.