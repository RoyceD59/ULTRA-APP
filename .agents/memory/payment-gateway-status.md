---
name: Payment gateway activation status
description: Which UC Companion payment providers are live vs deactivated/demo, and the switches that control them.
---

# Payment gateway activation status (as of Aug 2026)

- **WooCommerce (ucfilters.com):** LIVE — real catalogue + orders flow into the store dashboard.
- **Paystack:** LIVE (recommended method).
- **Stripe:** DEACTIVATED at the owner's request until their Stripe account is connected to WooCommerce. Controlled by `STRIPE_ENABLED` env var (`false` = session endpoint returns 503 and the app hides the card option). Re-enable by setting it to `true` **and** verifying `STRIPE_SECRET_KEY` is valid (the key on file returned "Invalid API Key" from Stripe).
- **M-Pesa:** LIVE as of 14 Aug 2026 — the monitoring readiness check (numeric shortcode + passkey + consumer key/secret all present) reports "live"; the placeholder-era mock STK fallback remains in place for environments with bad creds. Verify `MPESA_ENV` before assuming production Daraja.

**Why:** owner said "Stripe is not connected to WooCommerce so deactivate; M-Pesa still temporary placeholder keys" (Aug 2026).

**How to apply:** the app's checkout method list is server-driven via `GET /api/payments/config` — hide/show providers there, not by hardcoding the client picker.
