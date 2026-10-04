---
name: Google Sheets reconnect failures
description: Authorization revocation must not be masked by the public-sheet fallback.
---

Treat Google refresh-token revocation as an actionable reconnect failure, not as an opportunity to retry the sheet anonymously. Keep transient failures and public sheets without credentials distinct.

**Why:** The public-access fallback can replace `invalid_grant` with an unrelated sheet permission error, preventing the team from learning that Google access needs to be restored.

**How to apply:** Preserve the reconnect classification across scheduled and manual sync, saved status, and alerts. Reauthorization should retain the sheet configuration and clear only authorization-related errors.