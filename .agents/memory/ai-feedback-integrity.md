---
name: AI feedback integrity
description: Preserve anonymous transcripts while authenticating feedback about exact delivered answers.
---

Bind feedback to a signed, purpose-separated answer receipt rather than adding
customer ownership to the anonymous server transcript.

**Why:** The transcript is intentionally anonymous. Security hardening must
prevent fabricated and duplicate feedback without turning that history into
customer-attributed chat records. Receipts also bind the post-guard answer
actually delivered, which may differ from immutable transcript wording.

**How to apply:** Preserve receipt propagation for normal replies, transport
replays, intentional answer retries, and account-scoped local history. Never
accept legacy receipt-free feedback as a compatibility fallback. Coordinate
API/client rollout; keep historical answers readable even when not rateable.
