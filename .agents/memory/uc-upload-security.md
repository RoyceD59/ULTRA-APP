---
name: UC upload/media security model
description: Enforcement contract for presigned object-storage uploads and admin access in the UC Companion API
---

## Attach-time verification is the enforcement point

Presigned PUT URLs cannot bind size or content-type, so upload caps are enforced when an object URL is **attached** to a record (reviews, tickets, water tests, admin product media), by reading the stored object's GCS metadata (size + contentType vs declared photo/video kind).

**Why:** a review round found authenticated users could bypass the request-url caps by PUTting anything to the presigned URL; the sink-side metadata check is what actually enforces limits.

**How to apply:** any NEW endpoint that accepts media URLs must run the sanitize (URL whitelist) + verify (metadata) helpers already in the UC routes before persisting. Never persist raw client-supplied URL arrays.

## Public serving is scoped to uploads/<uuid>

Only objects minted by the upload endpoint (`uploads/<uuid>` inside the private object dir) are publicly servable, with `X-Content-Type-Options: nosniff` and inline rendering only for image/* and video/* (everything else forced to octet-stream attachment). Anything else under PRIVATE_OBJECT_DIR must remain unreachable from public routes.

## Assessment evidence is always private

Water-test and other assessment evidence must use an assessment-bound private namespace, never `uploads/<uuid>`. Access requires the attached customer owner or a live team user with the relevant permission.

**Why:** public upload serving is suitable for customer-facing media, but assessment evidence can contain household and location context. Presigned-request metadata is also not proof of the bytes ultimately stored.

**How to apply:** bind the upload to the assessment and principal/action token, keep serving private and non-cacheable, and verify stored metadata plus actual file signatures before attachment. External malware scanning may add another persisted verdict later.

## Admin is DB-anchored; dev login is dev-only

- Admin = registered DB user row with `is_admin` true OR email in `UC_ADMIN_EMAILS`. JWT claims alone NEVER grant admin (tokens with arbitrary emails can be minted via the dev login fallback).
- The mock login fallback (unknown email + any ≥6-char password → ephemeral session) is disabled when `NODE_ENV=production`.
- Profile responses for non-DB-anchored identities always report `isAdmin: false`.

## Principal id ranges (JWT `id` claim)
- Real DB principals: `uc_users` serial ids, always < 1e9. Only these can ever pass the DB-anchored admin check.
- Non-DB principals (ids >= 1e9): WooCommerce logins (stable email-hash id, offset +1e9) and dev-only ephemeral sessions (`Date.now()`). Admin/profile DB lookups skip this range by design.
- **Why:** the Woo JWT plugin response carries no user id; an earlier hardcoded id collapsed all Woo users into one principal and could collide with DB user #1 (privilege escalation). Email-hash ids keep identity stable per user without linking Woo logins to same-email app accounts (account-takeover vector when Woo emails are unverified).
- **How to apply:** any new auth path must mint ids >= 1e9 unless the principal is a real `uc_users` row; covered by api-server regression tests.
