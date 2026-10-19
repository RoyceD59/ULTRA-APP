---
name: GitHub development destination
description: Owner-selected repository for development source syncs.
---

Use the ULTRA-APP GitHub repository for this project's development syncs, not Ultra-AI-Team.

**Why:** The owner explicitly selected ULTRA-APP when both repositories were found in the workspace.

**How to apply:** Confirm the current remote still identifies that repository. Preserve existing remote history; do not force-push or replace main to synchronize development. A source push is not app publication or release-readiness approval.

Do not treat a healthy GitHub connection status or a successful remote read as proof that workspace Git can push.

**Why:** In this workspace, connection callbacks reported active/healthy while Git rejected push authentication and the reconnect card reported that the connection was not attached.

**How to apply:** Confirm an actual push succeeds and compare the remote branch's commit with the local commit before reporting a successful sync.
