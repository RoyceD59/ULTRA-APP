---
name: UC social sign-in (Google/Apple via Clerk)
description: Architecture and security rules for Clerk-based social sign-in bridging to uc_users accounts.
---

# Social sign-in architecture

Clerk (Replit-managed) is the social-identity layer only. The app's own account system
(`uc_users` + HS256 JWT) stays the single source of truth. The mobile app completes
OAuth via `useSSO().startSSOFlow`, activates the Clerk session, and exchanges the Clerk
session token at `POST /api/uc/auth/social` for a normal uc JWT.

**Why:** keeps the app footprint small; existing password accounts are untouched;
everything downstream (orders, reminders, prefs) is unchanged.

## Security rules (must not regress)

- Only VERIFIED emails from Clerk may be used for account linking.
- A Clerk identity whose email matches an existing `uc_users` row links to it and sets
  `clerk_user_id`. If the row already has a *different* `clerk_user_id`, return 409 —
  never silently re-link (account takeover risk).
- `password_hash` for social-only accounts is stored as the sentinel
  `!social-login-no-password`; `bcrypt.compare()` can never return true for it.
- Facebook was explicitly descoped (managed Clerk doesn't support it).
