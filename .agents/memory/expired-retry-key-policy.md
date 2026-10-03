---
name: Expired retry key policy
description: How retry-window expiry differs from permanent assessment and delivery identity.
---

Assessment-creation and verification-request keys become reusable after the 30-day retry window, including changed payloads. Verification reuse means a new challenge, not renewed delivery of the old code; expiry does not erase historical challenges, assessments, tickets, or lead deliveries.

**Why:** Treating expiry as permanent key rejection contradicts the retry window. Treating it as record deletion would lose customer history. Verification codes have a much shorter validity than retry records. Secondary lead-delivery deduplication can outlive the retry window, so a new submission needs a distinct delivery identity.

**How to apply:** Keep key retirement transactional and narrowly scoped. Preserve active replay/conflict behavior and rollback safety. When extending this policy to other endpoints, decide what a new submission means for that endpoint's side effects; never assume a reusable request key is a reusable delivery identity.

Persisted rate-limit accounting is an exception to normal rollback on rejection: do not retire expired keys before checks that can commit counters and reject creation.

**Why:** Otherwise a rejected attempt erases the evidence of key reuse; a subsequent successful submission can reuse the old delivery identity and silently lose its lead notification.

**How to apply:** Run rejection checks that intentionally commit before any key retirement, and test rejection followed by successful reuse with an existing delivery.

Physical-test retry keys remain bound to the original payload after expiry. An authorized identical retry reports the existing ticket's current state and renews the retry window; it never resubmits or overwrites the ticket.

**Why:** Physical requests act on a ticket already created with the assessment. Treating expiry as a fresh submission could reopen completed service or erase staff-corrected service details and evidence. This differs intentionally from assessment-creation key reuse.

**How to apply:** Preserve active response replay and payload conflicts. For expired physical retries, read the current ticket state under lock and renew only the retry record transactionally; missing tickets and failed renewals must leave the old record intact.