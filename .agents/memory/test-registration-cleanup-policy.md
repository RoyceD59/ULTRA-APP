---
name: Test registration cleanup scope
description: User-approved distinction between clearing test recovery records and deleting customer accounts.
---

The user selected “Selected test registration records only” when asked whether
cleanup should also delete actual customer accounts. Allow explicit selected
test records to be cleared in resolved or unresolved states; do not turn this
into customer-account deletion or automatic classification of customers as
tests.

**Why:** The user requested cleanup of synced/resolved and unresolved test
records, and explicitly chose the record-only option after the destructive
account-deletion distinction was explained.

**How to apply:** Keep actual customer accounts, assignments, orders, payments
and customer history outside this action. Warn that an unresolved record may
be the only remaining failed-signup evidence and clearing it ends its recovery.
An empty recovery queue is not proof that every registration synced.
