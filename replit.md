# ProjectHub

A project management app for a small B2B SaaS team: track tasks, assign owners, set deadlines, and see progress across every project from one dashboard.

## Product

- **Dashboard** (`/`): cross-project totals, active/overdue/due-this-week counts, global status breakdown, recent activity feed.
- **Projects** (`/projects`, `/projects/:id`): project cards with progress bars; detail view shows task list, status/priority breakdown, overdue count.
- **Tasks** (`/tasks`): all tasks across projects, filterable by project/assignee/status, with inline status/assignee/due-date editing.
- **Team** (`/team`): member directory with create/edit/delete.
- Entities: Member, Project (status: planning/active/on_hold/completed), Task (status: todo/in_progress/in_review/done; priority: low/medium/high/urgent).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Optional integrations (set env vars to activate)

| Service | Env vars | Purpose |
|---------|----------|---------|
| Africa's Talking (SMS) | `AT_API_KEY`, `AT_USERNAME` | Order, ticket, and water-test SMS confirmations. Sandbox: username=`sandbox`, key from AT dashboard. No-op when absent. |
| SendGrid (email) | `SENDGRID_API_KEY` | HTML order receipt emails. No-op when absent. |
| SMTP relay (email) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Alternative to SendGrid (e.g. smtp2go, Gmail SMTP). Used only when SendGrid key absent. Requires `nodemailer` installed. |
| Email from address | `EMAIL_FROM` | Sender display name + address (default: `Ultra Clear <noreply@ucfilters.co.ke>`). |
| WooCommerce | `WC_BASE_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` | Live product catalogue and orders (falls back to mock when absent). |
| M-Pesa | `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` | Payment verification for M-Pesa orders. |

## Team Horizon features (merged from AI-Team repos)

- **Contacts** (`/contacts`): stakeholder/partner directory with email, WhatsApp, and SMS contact methods per person.
- **Notifications** (`/notifications`): dispatch templated notifications (STAKEHOLDER_UPDATE / OWNER_ALERT / RESOURCE_REQ) to contacts via email or WhatsApp; delivery-receipt ticks for WhatsApp.
- **System Status** (`/system`): watchdog dashboard for connected platforms (Team AI Embedded, etc.); manual heartbeat pings.
- **Webhook Tester** (`/webhook`): send test payloads to `POST /api/webhook/ingest` to simulate external orchestration events.
- **WhatsApp session**: Baileys-based persistent session with QR pairing; managed via `GET/POST /api/whatsapp/status|connect|disconnect|send` (team-auth required).
- **Team auth**: `POST /api/auth/token` — exchange `SESSION_SECRET` for an 8-hour JWT used by WhatsApp routes.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live (Team Horizon additions)

- Contacts schema: `lib/db/src/schema/contacts.ts`, `contact-methods.ts`
- Notification log schema: `lib/db/src/schema/notification-logs.ts`
- System status schema: `lib/db/src/schema/system-status.ts`
- Task orchestration fields: `sourcePlatform`, `resourceRequired`, `deliveryFormat`, `notifyVia` added to `lib/db/src/schema/tasks.ts`
- Notification dispatch lib: `artifacts/api-server/src/lib/notifications.ts` (email + WhatsApp fallback)
- WhatsApp session lib: `artifacts/api-server/src/lib/whatsapp.ts` (Baileys)
- Team auth: `artifacts/projecthub/src/lib/team-auth.ts` + `artifacts/api-server/src/routes/auth.ts`

## Where things live

- UC Companion media uploads: presigned-URL flow in `artifacts/api-server/src/routes/storage.ts`; attach-time size/type verification + reviews/product-media/admin endpoints in `artifacts/api-server/src/routes/uc.ts`.
- Ultra Clear brand assets: hi-res cropped logo lock-ups in `attached_assets/brand/`; the app renders them via `artifacts/uc-companion/components/BrandLogo.tsx`.
- UC DB schema: `lib/db/src/schema/uc-*.ts` (users, tickets, water tests, reviews, product media).

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After changing `lib/db` schema: run `pnpm --filter @workspace/db run push` **and** `pnpm exec tsc -b lib/db` (the package has no build script; project references need the manual rebuild) before typechecking/starting the API.
- UC admin access is DB-anchored: a registered `uc_users` row with `is_admin=true`, or a registered user whose email is in the `UC_ADMIN_EMAILS` env var. The dev-only mock login (unknown email + any 6+ char password) is disabled in production.

## Google Maps Android key — app restriction (IMPORTANT)

The `GOOGLE_MAPS_ANDROID_KEY` is embedded in every Android build and can be extracted from the APK/AAB. To prevent unauthorised billable usage, the key **must** have an Android-app application restriction set in Google Cloud Console:

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Click the Maps key used by the UC Companion app.
3. Under **Application restrictions**, select **Android apps**.
4. Add a restriction entry with:
   - **Package name**: `com.ultraclean.companion`
   - **SHA-1 certificate fingerprint**: the debug fingerprint for development builds, **plus** the release fingerprint for production builds (generated from the release keystore).
5. Save.

**Maintenance note — keystore changes**: if the Android release keystore is ever rotated or replaced, the SHA-1 fingerprint in this restriction must be updated immediately, otherwise production Maps requests will be rejected. Obtain the new fingerprint with:

```bash
keytool -list -v -keystore release.keystore -alias <alias>
```

then update the restriction in Google Cloud Console before shipping the new build.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
