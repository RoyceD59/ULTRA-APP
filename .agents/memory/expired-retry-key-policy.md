---
name: Expired retry key policy
description: How retry-window expiry differs from permanent assessment and delivery identity.
---

Assessment-creation and verification-request keys become reusable after the 30-day retry window, including changed payloads. Verification reuse means a new challenge, not renewed delivery of the old code; expiry does not erase historical challenges, assessments, tickets, or lead deliveries.

**Why:** Treating expiry as permanent key rejection contradicts the retry window. Treating it as record deletion would lose customer history. Verification codes have a much shorter validity than retry records. Secondary lead-delivery deduplication can outlive the retry window, so a new submission needs a distinct delivery identity.

**How to apply:** Keep key retirement transactional and narrowly scoped. Preserve active replay/conflict behavior and rollback safety. When extending this policy to other endpoints, decide what a new submission means for that endpoint's side effects; never assume a reusable request key is a reusable delivery identity.

An active verification-request key stays bound to its original challenge even after the code expires or is consumed. Reject that replay explicitly rather than silently issuing a replacement; a new code requires a new request key and the normal consent and rate-limit checks.

**Why:** The 30-day retry window is for request deduplication, not an authorization to extend a 10-minute code or reuse a completed verification.

**How to apply:** Check challenge usability when claiming a retry, including stale delivery-lease recovery and previously sent responses. Never treat a delivery success as proof that its code is still usable.

Persisted rate-limit accounting is an exception to normal rollback on rejection: do not retire expired keys before checks that can commit counters and reject creation.

**Why:** Otherwise a rejected attempt erases the evidence of key reuse; a subsequent successful submission can reuse the old delivery identity and silently lose its lead notification.

**How to apply:** Run rejection checks that intentionally commit before any key retirement, and test rejection followed by successful reuse with an existing delivery.

Physical-test retry keys remain bound to the original payload after expiry. An authorized identical retry reports the existing ticket's current state and renews the retry window; it never resubmits or overwrites the ticket.

**Why:** Physical requests act on a ticket already created with the assessment. Treating expiry as a fresh submission could reopen completed service or erase staff-corrected service details and evidence. This differs intentionally from assessment-creation key reuse.

**How to apply:** Preserve active response replay and payload conflicts. For expired physical retries, read the current ticket state under lock and renew only the retry record transactionally; missing tickets and failed renewals must leave the old record intact.

A new physical-test request key is not a customer edit mechanism. Customer submission is permitted only before acknowledgement while the ticket remains result-ready; submitted and staff-managed requests are immutable through this endpoint.

**Why:** Staff can take responsibility for a ticket without a customer acknowledgement timestamp, and a state reset alone must not erase a prior submission. Neither changing keys nor a missing legacy timestamp establishes permission to replace service details, evidence or benefits.

**How to apply:** Keep customer changes separate from staff-managed service updates. Both the ticket state and acknowledgement must be checked under the ticket lock before any submission side effects; preserve original-key retry semantics.