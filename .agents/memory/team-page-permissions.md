---
name: ProjectHub page permissions are client-side by default
description: How page-level permissions work for team users and what a new page/endpoint must do to enforce them server-side.
---

ProjectHub page-level permissions ("none"/"view"/"edit" per PageSlug) are enforced **client-side only** by default: `PAGES` in projecthub `lib/team-auth.ts` + `PageGuard` in App.tsx + nav filtering in AppLayout. The team-session JWT carries only `{id, email, name, role}` — **no permissions** — so `requireTeamAuth` on the API can't check page access.

**Why:** A member with a page set to "none" is hidden from that page in the UI but can still call its API endpoints directly unless the server re-checks. This was flagged in review for the monitoring endpoint.

**How to apply:** When adding a page whose data shouldn't leak to unauthorized members, mirror the permission server-side: admins pass on `role === "admin"`; for members, look up `teamUsersTable.permissions` by user id and require view/edit on the slug (see the monitoring route for the pattern). Adding a slug to `PAGES` automatically surfaces it in the admin Users permission editor; members default to "none".
