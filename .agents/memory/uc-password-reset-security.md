---
name: UC password-reset security
description: Durable security boundaries for Ultra-Clear password-reset links and tokens.
---

Password-reset tokens are bearer credentials. Persist only a SHA-256 hash, then hash the raw
token presented by the customer before the conditional single-use claim. The raw token exists
only in the outbound email and HTTPS request.

**Why:** A database read, backup exposure, support-data export, or SQL-read incident must not
let an attacker reset a customer's password by copying a live token row.

**How to apply:** Keep the `used_at IS NULL` and expiry conditions in the atomic update against
the token hash. Ensure notification/audit logs redact reset URLs and tokens.

Password-reset URLs must be built from an explicit configured public base URL or Replit's public
domain variable. Production configuration with neither must fail delivery without emailing a
localhost link, while retaining the generic successful response that prevents email enumeration.

**Why:** A localhost link is unusable by customers and turns account recovery into a silent
production outage; an error response only for existing emails would also reveal account existence.

**How to apply:** Prefer explicit canonical URL configuration, then `REPLIT_DOMAINS`; use preview
domains only in development. Test that public-domain links are HTTPS and never contain localhost.