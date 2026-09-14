---
name: ProjectHub auth rewrite
description: Individual email/password accounts replacing shared passcode; key decisions and gotchas.
---

## What was built

Replaced the shared passcode login with individual email/password accounts, invite-only signup, admin/member roles, and self-service + admin password reset.

## Key decisions

**JWT type stays `"team-session"`**
All existing `requireTeamAuth` guards (in `routes/index.ts`, `contacts-sync.ts`, `whatsapp.ts`) keep working unchanged. Only the JWT payload was extended to also carry `role` and `name`.

**Why:** Avoids touching every protected route during the auth migration.

**`requireTeamAdmin` (not `requireAdmin`)**
The admin guard for new auth routes is exported from `routes/auth.ts` as `requireTeamAdmin`. The existing UC-user admin guard in `adminAuth.ts` is `requireAdmin`. Names must not collide.

**Why:** Both coexist in the same server; separate names prevent accidental privilege mix-ups.

**`getAuthHeaders()` must stay exported from `team-auth.ts`**
Many components (`whatsapp-qr-card.tsx`, `ConnectSheetDialog.tsx`, `contacts.tsx`, `notifications.tsx`) call `getAuthHeaders()` directly for raw fetch calls. This was present in the old file and must remain.

**Why:** These components use fetch directly, not the generated Orval API client.

**Admin seed via env vars**
The configured email is the break-glass administrator. Startup creates it when missing or restores its admin/active authority when demoted or deactivated, without replacing an existing password or profile.

**Why:** Insert-only seeding allowed the sole configured administrator to lose authority permanently after an accidental role or active-state change.

**How to apply:** Normalize the configured email, reconcile role and active state every startup, and preserve existing credential/profile fields.

**Admin authorization uses live database state**
Destructive or sensitive team-admin routes must re-read `team_users` and require the account to remain active with the admin role. JWT role claims are not sufficient.

**Why:** An eight-hour token can retain a stale admin claim after the user is demoted or deactivated.

**How to apply:** Use the database-reverified team-admin guard and record the verified team-user ID for audit fields.

**Resend email is graceful**
Invite and reset URLs are always returned in the API response body so admins can copy them manually when email isn't delivered.

## Tables added

- `team_users` — individual accounts with `role` (admin/member) and `is_active`
- `team_invitations` — 7-day invite tokens, single-use (accepted_at stamped on use)
- `password_reset_tokens` — 1-hour (self-service) / 24-hour (admin) reset tokens, single-use

Tables are created via inline SQL in `applyStartupMigrations()` in `api-server/src/index.ts` (same pattern as existing tables).

## New routes

All under `/api/auth/`. See `artifacts/api-server/src/routes/auth.ts` for full details. Legacy `/auth/token` and `/auth/change-passcode` kept for WhatsApp compat.

## New frontend pages

`/login`, `/register?token=`, `/forgot-password`, `/reset-password?token=`, `/admin/users` — all in `artifacts/projecthub/src/pages/`.

`/register`, `/forgot-password`, `/reset-password` are public (outside `AuthGuard`). `/admin/users` is behind both `AuthGuard` and `AdminGuard`.

## Two parallel auth systems — don't mix their login endpoints
- Team/admin accounts live in `team_users` and log in via `POST /api/auth/login` → JWT with `type:"team-session"` + `role`. Admin-gated UC routes accept team-session role:"admin" directly.
- `POST /api/uc/auth/login` is the **customer** (companion app) login backed by `uc_users`, with a dev fallback that can mint tokens for arbitrary emails — those tokens correctly fail the DB-anchored admin check (403).
- **How to apply:** when smoke-testing admin endpoints, always authenticate via `/api/auth/login`; a 403 after a "successful" `/api/uc/auth/login` is the fail-closed design working, not a bug.
