---
name: Filter maintenance count policy
description: Preserving Ultra-Clear customer cleaning history through filter lifecycle changes.
---

Customer registration, replacement, clearing, and reminder rescheduling must never reduce the filter maintenance (cleaning) count. An account-level count is retained independently of the current activation record, including for customers upgrading from older app versions.

**Why:** A customer can legitimately start a new filter cycle or correct registration details, but those actions must not silently erase the maintenance history used in filter-health guidance.

**How to apply:** Any future activation write must preserve the maximum known count. A staff-facing correction flow may reset it only after an authenticated, explicit admin action; do not add a customer-accessible reset control.