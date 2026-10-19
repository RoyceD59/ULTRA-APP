---
name: Resend connector email delivery
description: How UC email delivery is routed and the domain-verification constraint on the user's Resend account.
---
Email delivery order: Resend (Replit connector via `@replit/connectors-sdk` proxy; direct API only when `RESEND_API_KEY`/`RESEND_BASE_URL` set — tests use the latter as a stub) → SendGrid/SMTP chain fallback.

**Constraint:** ProjectHub sends from `noreply@contacts.ucfilters.com`. The exact `contacts.ucfilters.com` Resend domain was verified in `us-east-1` on 2026-08-21 after its DKIM/SPF records were published in public DNS. The older `team.ucfilters.com` entry was `partially_failed` and was left untouched.

**Why:** Resend rejects from-addresses on domains that are not verified for that account. A similarly named but partially verified domain does not authorize the configured `contacts.ucfilters.com` sender.

**How to apply:** before testing ProjectHub invitations or resets, check Resend domain status via connector proxy `GET /domains` and make sure the exact configured sender domain is verified. Never log Resend response bodies (they can echo PII); log status + error name only.
