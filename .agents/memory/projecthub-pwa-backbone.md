---
name: ProjectHub PWA backbone
description: Product and data-safety boundaries for ProjectHub as the operational backbone of Companion.
---

ProjectHub remains one installable PWA and desktop web application rather than splitting into a separate native staff app. It is the operational backbone for Companion and must use the deployed API domain in distributed builds.

ProjectHub may cache its application shell and safe static assets for offline startup, but operational data stays server-authoritative. On reconnect, refresh server-backed records so registrations and updates received while a dashboard client was offline become visible.

Do not queue sensitive staff mutations such as rewards adjustments, account changes, or destructive actions for later replay.

**Why:** A single responsive product avoids divergent staff clients, while replaying privileged writes after an outage risks duplicate or conflicting changes. Companion registrations must continue reaching the deployed backend independently of whether a ProjectHub client is online.

**How to apply:** Preserve mobile and desktop support together. Keep API traffic network-first, show offline state clearly, disable or fail explicit writes while offline, and invalidate/refetch server state after connectivity returns.