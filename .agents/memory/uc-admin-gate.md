---
name: UC admin gate provenance
description: How the shared UC admin gate decides admin — token provenance claim, team-session DB re-verification, and the rules that must not regress
---

**Rule:** The shared UC admin gate (`api-server/src/lib/adminAuth.ts isAdminRequest`) is the single authority for UC admin endpoints. It admits exactly three principals, all failing closed:
1. **Team sessions** (`type:"team-session"`): admin role is re-verified against the live `team_users` row (active + role admin) on every request — never trusted from JWT claims, so demotions apply immediately. The legacy passcode token (`id:"team"`, no DB row) is rejected by design.
2. **Woo-issued tokens** (`src:"woo"` provenance claim, set only at the WooCommerce login path): email may be checked against `UC_ADMIN_EMAILS` because Woo verified it at issue time.
3. **DB-anchored uc_users** (id < 1e9): `isAdmin` flag or DB-stored email on the allowlist.

**Why:** Woo logins and the dev ephemeral-login fallback both mint synthetic ids ≥ 1e9, and the dev fallback mints *arbitrary* emails — so an email claim is only trustworthy when the token carries issue-time provenance (`src:"woo"`). A blanket ≥ 1e9 rejection locked all Woo admins out of UC Impact; a blanket claims-trust would let dev tokens forge admin.

**How to apply:**
- Never add a new admin acceptance path that trusts JWT claims alone; either anchor to a DB row or a server-set provenance claim.
- Route files must import the shared gate, not grow local copies (uc.ts and uc-water-chat.ts previously had drifted duplicates that trusted team-session role claims).
- `checkAdminAuth` in uc-water-chat.ts remains exported only for unit tests.
- ProjectHub Impact page auto-uses the team session for admins and falls back to the UC-credentials form when the server rejects it (`teamDenied` state — never clears the ProjectHub session itself).
