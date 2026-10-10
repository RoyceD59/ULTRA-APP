---
name: UC admin gate provenance
description: How the shared UC admin gate decides admin — token provenance claim, team-session DB re-verification, and the rules that must not regress
---

**Rule:** The shared UC admin gate is the single authority for UC admin endpoints. The prepared WooCommerce-disconnection source admits two DB-anchored principal kinds, failing closed:
1. **Team sessions** (`type:"team-session"`): admin role is re-verified against the live `team_users` row (active + role admin) on every request — never trusted from JWT claims, so demotions apply immediately. The legacy passcode token (`id:"team"`, no DB row) is rejected by design.
2. **DB-anchored customer accounts**: a live, non-deleted customer row supplies the admin flag or the allowlisted email. Legacy `src:"woo"` tokens receive no independent email-claim privilege.

**Why:** The owner approved retiring WooCommerce identity authority completely. Old synthetic/provider principals must not bypass live account deletion or acquire administration from an email claim. Older retained published packages may still implement the historical provenance exception; source preparation does not activate this change in production.

**How to apply:**
- Never add an admin acceptance path based only on JWT email, role or retired provider provenance; recheck the live account.
- Route files must import the shared gate, not grow local copies (uc.ts and uc-water-chat.ts previously had drifted duplicates that trusted team-session role claims).
- `checkAdminAuth` in uc-water-chat.ts remains exported only for unit tests.
- ProjectHub Impact page auto-uses the team session for admins and falls back to the UC-credentials form when the server rejects it (`teamDenied` state — never clears the ProjectHub session itself).
