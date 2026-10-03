---
name: Expired retry key policy
description: How retry-window expiry differs from permanent assessment and delivery identity.
---

Assessment-creation keys become reusable after the 30-day retry window; expiry does not erase the original assessment, ticket, or lead delivery.

**Why:** Treating expiry as permanent key rejection contradicts the retry window. Treating it as record deletion would lose customer history. Secondary lead-delivery deduplication can outlive the retry window, so a new submission needs a distinct delivery identity.

**How to apply:** Keep key retirement transactional and narrowly scoped. Preserve active replay/conflict behavior and rollback safety. When extending this policy to other endpoints, decide what a new submission means for that endpoint's side effects; never assume a reusable request key is a reusable delivery identity.

Persisted rate-limit accounting is an exception to normal rollback on rejection: do not retire expired keys before checks that can commit counters and reject creation.

**Why:** Otherwise a rejected attempt erases the evidence of key reuse; a subsequent successful submission can reuse the old delivery identity and silently lose its lead notification.

**How to apply:** Run rejection checks that intentionally commit before any key retirement, and test rejection followed by successful reuse with an existing delivery.