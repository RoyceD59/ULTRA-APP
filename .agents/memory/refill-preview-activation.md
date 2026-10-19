---
name: Refill preview activation boundary
description: Runtime admin switches activate delivered previews, not unfinished financial or dispensing features.
---

Use persisted, off-by-default admin switches for Care Overview and station/campaign governance preview. Do not require client rebuilds for activation. Keep promotional refills, paid refills, money wallets, paid care and automatic collection unavailable until their separate safeguards are implemented.

**Why:** The user asked for ProjectHub admin activation switches when importing the tested external branch. That branch delivered overview and governance definitions only, not the funding, consent, posting or dispenser controls needed to safely activate transactions.

**How to apply:** Treat API capabilities and per-operation server gates as authoritative. A station or campaign approval is an independent review record, not customer credit, funding reconciliation or permission to dispense. Preserve existing customer-account, rewards and order authorities.