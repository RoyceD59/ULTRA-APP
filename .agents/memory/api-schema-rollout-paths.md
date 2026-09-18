---
name: API schema rollout paths
description: How database schema changes reach tests and existing deployed API databases.
---

Database schema additions for the API must be represented in the shared SQL
migration directory **and** in the API's idempotent startup migration guard
when they need to reach already-running deployed databases.

**Why:** The test harness applies the SQL migration files, while the deployed
API's rollout path uses explicit startup DDL rather than automatically running
the migration directory. A SQL migration alone can pass tests but leave an
existing deployment without the needed columns.

**How to apply:** When adding a column or index used by an API route, update the
Drizzle schema, add the idempotent SQL migration, mirror that DDL in the
startup migration guard, and restart the API to verify the deployment path.
Exercise both a fresh database and a partially upgraded database. When replacing
legacy uniqueness, drop any owning table constraint before attempting to drop
its backing index; PostgreSQL will not drop a constraint-owned index directly.