---
name: Stale @workspace/db types
description: Phantom "no exported member" TS errors from lib/db mean the composite build output is stale.
---
Rule: `@workspace/db` type errors that contradict the schema source mean stale declaration output — rebuild the composite project before assuming a schema regression.

**Why:** consumers resolve lib/db's built declarations, which lag behind schema changes merged by parallel tasks.

**How to apply:** rebuild lib/db, then re-check; only investigate the schema if errors persist.
