---
name: Customer identity concurrency
description: How duplicate email and phone protection must coexist with legacy and system records.
---

Customer-facing registration, profile updates, and recovery must normalize identities and use transaction-scoped advisory locks plus active-account checks. Do not impose a database-wide unique phone constraint.

**Why:** Historical imports and internal test/system records can legitimately reuse placeholder phone numbers. A global unique index blocks those paths and would force destructive reconciliation of legitimate legacy data.

**How to apply:** Keep canonical international phone handling at public write boundaries, serialize writes on normalized email and phone keys, and treat a conflict with a non-deleted customer as a clear 409/staff-review outcome. Historical duplicates remain untouched.