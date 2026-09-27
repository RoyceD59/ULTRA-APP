# Threat Model

## Project Overview

ProjectHub is a B2B SaaS project-management dashboard for the Ultra-Clear (UC) team, bundled with the Ultra-Clear Companion mobile app that lets customers order water filters, submit support tickets, and request water tests. The system has two distinct user populations sharing one Express 5 API: **team members** (ProjectHub) and **UC customers** (mobile app).

Tech stack: Node.js 24 / TypeScript / Express 5, PostgreSQL + Drizzle ORM, pnpm workspaces, esbuild, deployed on Replit Autoscale behind a custom domain (`https://app.ucfilters.com`). Optional integrations: M-Pesa, Stripe, Paystack, Africa's Talking (SMS), SendGrid/SMTP, Resend, WooCommerce, WhatsApp (Baileys), Expo Push.

## Assets

- **Team JWT tokens** — 8-hour JWTs signed with `SESSION_SECRET`; grant access to all ProjectHub data and UC admin endpoints.
- **UC customer JWTs** — signed with the same `SESSION_SECRET`; grant access to order history, tickets, water tests, and personal profile.
- **UC admin privileges** — DB-anchored `is_admin` flag or `UC_ADMIN_EMAILS` env list; gate all `/uc/admin/*` routes.
- **Customer PII** — names, emails, phone numbers, shipping addresses in `uc_users`, `uc_orders`, `uc_tickets`, `uc_water_tests`.
- **Payment records** — M-Pesa STK push initiations, order totals and statuses, Paystack references, Stripe session IDs.
- **Secrets** — `SESSION_SECRET` (JWT signing + encryption), `MPESA_WEBHOOK_SECRET` (stored encrypted in DB), `PAYSTACK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `SENDGRID_API_KEY`, `RESEND_API_KEY`, `WC_CONSUMER_SECRET`.
- **WhatsApp session credentials** — Baileys persistent session files; compromise allows sending messages as the business number.
- **Notification log** — records of all email/WhatsApp dispatches including recipient identifiers.

## Trust Boundaries

- **Mobile app → API** — all customer requests arrive here; the API must authenticate and authorize every action that touches user data.
- **ProjectHub frontend → API** — team-session JWT required for all ProjectHub routes; admin role required for privileged mutations.
- **External webhook → API** — Safaricom/Paystack/Stripe/custom webhook callbacks arrive unauthenticated and must be HMAC-verified before any state change.
- **API → Database** — Drizzle ORM with parameterized queries; no raw string concatenation identified.
- **API → External services** — M-Pesa, Paystack, Stripe, SendGrid, Resend, Africa's Talking, WooCommerce; secrets must remain server-side.

## Scan Anchors

- **Production entry points**: `artifacts/api-server/src/routes/index.ts` (route aggregator), `artifacts/api-server/src/routes/uc.ts` (largest attack surface — ~4 k lines), `artifacts/api-server/src/routes/payments.ts`, `artifacts/api-server/src/routes/auth.ts`, `artifacts/api-server/src/routes/webhook.ts`.
- **Highest-risk areas**: Payment webhook handlers (Paystack, M-Pesa, Stripe) in `payments.ts`; UC admin routes in `uc.ts`; legacy passcode login in `auth.ts`; WhatsApp session management in `whatsapp.ts`.
- **Public surfaces**: `/uc/auth/login`, `/uc/auth/register`, `/uc/products`, `/payments/*`, `/payments/paystack/webhook`, `/payments/mpesa/callback`, `/webhook/ingest`, `/uc/enquiries`, `/uc/tickets` (POST), `/uc/water-tests` (POST).
- **Authenticated surfaces**: All `/auth/*` routes (team), all `/uc/admin/*` routes, `/whatsapp/*`, `/notifications/*`, `/admin/*`.
- **Dev-only**: Mock login fallback in `uc/auth/login` (guarded by `NODE_ENV !== "production"`); mock STK push / Paystack / Stripe responses when API keys absent.

## Threat Categories

### Spoofing

Team auth uses HMAC-SHA256 JWTs signed with `SESSION_SECRET` and verified on every request via `requireTeamAuth`/`requireTeamAdmin`. The legacy `/auth/token` endpoint (passcode → admin JWT) shares the same signing key and issues a token with `role: "admin"` that is accepted by UC admin route guards — this is intentional but means the passcode is a high-value credential. UC customer tokens use the same `SESSION_SECRET`; the `isAdminRequest()` helper defends against cross-contamination by requiring DB-anchored admin status for numeric UC IDs.

Webhook spoofing is the primary risk: M-Pesa and Paystack webhook handlers skip HMAC verification when the corresponding secret env var is absent, accepting any caller as a legitimate payment processor. `PROJECTHUB_WEBHOOK_SECRET` guards task ingestion similarly.

**Guarantee**: Every payment webhook handler MUST verify an HMAC signature before mutating any order or task record. `PAYSTACK_SECRET_KEY`, `MPESA_WEBHOOK_SECRET` (or DB equivalent), and `PROJECTHUB_WEBHOOK_SECRET` MUST be set in production.

### Tampering

Order totals and payment amounts are calculated server-side. Payment status is verified server-side before order creation (`verifyPaymentOnServer`). M-Pesa amounts are stored at STK-push time and re-checked at callback time. Drizzle ORM parameterizes all queries — no SQL injection surface found.

Media attachments are re-verified at attach time (content-type and size) against the object storage metadata, closing the gap between presigned URL issuance and actual use.

The Paystack webhook recovery path creates an order from webhook-provided amount and email when no matching DB order exists — an unauthenticated attacker (when `PAYSTACK_SECRET_KEY` absent) could set these values arbitrarily.

### Repudiation

Sensitive operations (password resets, admin role changes, M-Pesa push failures) are logged. However, the full password-reset URL (including one-time token) is logged at `info` level, making the token extractable from deployment logs.

### Information Disclosure

UC admin CSV export endpoints (`/uc/admin/orders.csv`, `/uc/admin/tickets.csv`, `/uc/admin/water-tests.csv`) are properly gated by `isAdminRequest()`. Customer order history (`GET /uc/orders`) is scoped to the authenticated user's ID via a DB `WHERE userId = ?` clause — no cross-user leakage.

Static file serving in `serve.js` (Expo build server) includes a `startsWith(STATIC_ROOT)` boundary check that prevents path traversal despite the SAST flag.

The M-Pesa webhook secret is embedded as a query parameter in the `CallBackURL` sent to Safaricom, making it visible in HTTP access logs on intermediate proxies. This is a documented design trade-off (Safaricom does not support custom callback headers).

### Denial of Service

`authLimiter` rate-limits `/uc/auth/login`, `/uc/auth/register`, and `/auth/login`. Payment initiation endpoints use `paymentLimiter`. Unauthenticated `POST /uc/tickets` and `POST /uc/water-tests` have no rate limiting applied — they accept arbitrary anonymous writes.

### Elevation of Privilege

UC admin checks are DB-anchored: numeric IDs ≥ 1 billion (WooCommerce-derived) cannot be DB admins; `claims.id` alone is never trusted for admin elevation. ProjectHub team-session tokens with `role: "admin"` are accepted by UC admin guards, which is intentional since the same team operates both surfaces.

The dev-only mock login (any unknown email + 6-char password → valid JWT) is properly gated by `NODE_ENV !== "production"`.
