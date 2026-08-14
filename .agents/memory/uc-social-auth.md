---
name: UC social sign-in (Google/Apple via Clerk)
description: How social sign-in bridges to the app's own uc_users accounts, and the security rules that must not regress.
---

# Social sign-in architecture

Clerk (Replit-managed) is used ONLY as the social-identity layer. The app's own
account system (uc_users + HS256 uc JWT) stays the single source of truth: the
mobile app completes OAuth via `useSSO().startSSOFlow`, activates the Clerk
session, and exchanges the Clerk session token at `POST /api/uc/auth/social`
for a normal uc JWT. Everything downstream (orders, reminders, prefs) is
unchanged. Facebook was explicitly descoped (user chose Google + Apple only —
managed Clerk doesn't support Facebook).

**Why:** keeps app memory/footprint small, no migration of existing accounts,
password login untouched.

## Security rules (must not regress)

- **Verified email only.** Only a Clerk email with `verification.status ===
  "verified"` may be used to link/create. Unverified emails → 403. Otherwise an
  attacker could claim an existing account by adding someone's email to their
  Clerk profile.
- **Never re-link.** If a uc_users row already has a different `clerk_user_id`,
  reject with 409 — no silent overwrite. Linking update is conditional
  (`WHERE clerk_user_id IS NULL`), with a re-read on race loss.
- **Sentinel password.** Social-created accounts store a non-bcrypt sentinel in
  password_hash; bcrypt.compare can never match it, so password login on
  social-only accounts always fails safely.

## Resilience decision

`ClerkLoaded` must NOT gate the whole app in `_layout.tsx` — only the social
buttons component wraps itself in it. **Why:** a Clerk outage/offline start
would otherwise block already-signed-in password users from using the app.

## How to apply / quirks

- Global `clerkMiddleware` in app.ts tolerates non-Clerk Bearer tokens (marks
  signed-out, calls next) — uc JWTs pass through unharmed; full API test suite
  confirms.
- Server-side e2e without OAuth: mint a real session via Clerk backend API
  (`POST /v1/sessions {user_id}` then `POST /v1/sessions/{id}/tokens`) and hit
  the exchange endpoint. Note: admin-created email addresses come back
  ALREADY "verified" — they don't exercise the unverified gate.
- Prod proxy env wiring (`CLERK_PROXY_URL` → build.js) is platform-managed at
  publish; do not invent env vars for it (skill rule).
