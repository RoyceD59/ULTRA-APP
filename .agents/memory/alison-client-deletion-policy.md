---
name: Alison client deletion safeguards
description: Approved boundaries for removing unused ProjectHub machine clients.
---

The user approved guarded deletion: an administrator must suspend or revoke a
client first, deletion must reject unexpired unrevoked tokens, and permanent
removal must retain audit history and require UI confirmation. Alison viewer
setup should explicitly grant only `alison.read` rather than requiring users to
guess which permission is needed.

**Why:** The user reported rejected Alison conversation credentials and asked
to delete clients no longer in use, then approved these recommended safeguards.
Unused does not mean an agent's credentials can be removed while still active.

**How to apply:** Preserve these boundaries when simplifying client management.
Do not equate saving a provider/configuration secret with registering a client
in the API environment's OAuth registry. Do not infer that a development
credential test verifies an existing published credential pair.
