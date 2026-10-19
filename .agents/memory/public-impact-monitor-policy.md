---
name: Public impact monitor approval
description: Owner-approved independent monitoring schedule and notification thresholds.
---

The owner approved an independent public-impact monitor: check both public API
hosts every five minutes with a fifteen-second request timeout; alert after
three consecutive checks showing the same problem and report recovery after
two healthy checks. The owner also approved GitHub Actions with a dedicated
GitHub issue for durable state and warning/recovery comments.

**Why:** The owner explicitly approved this proposal on 2026-10-10. An
independent monitor can operate when the target API is unavailable.

**How to apply:** Preserve these thresholds and the chosen destination unless
the owner changes them. Live activation remains separate opt-in approval.
Probe unavailability is not confirmed downtime, and matching totals do not
attest running API source.
