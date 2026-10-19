---
name: Companion build publication boundaries
description: Safe release selection while retaining assets and upgrading legacy native manifests.
---

Treat asset existence, release completeness and release activation as separate
states. Native and browser releases must switch at one explicit publication
boundary; keeping rollback files alone does not guarantee a safe rollout.

**Why:** The legacy pipeline published native manifests independently of browser
selection. Retaining old browser files made that mismatch persist; a failed
first upgrade could expose only one new native platform.

**How to apply:** Exercise both the legacy/no-selection-pointer upgrade and
already-migrated rollout paths. Test failures after one native platform stages,
after both stage, and before activation. Include cold-start selection while a
replacement is present but unpublished. Do not delete rollback assets to make
release discovery work.