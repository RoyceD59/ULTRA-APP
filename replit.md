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
- **WhatsApp session**: Baileys-based persistent session with QR pairing; managed via `GET/POST /api/whatsapp/status|connect|disconnect|send` (team-auth required). Session credentials are stored OUTSIDE the repo (default `~/.uc-whatsapp-session`, override with `WHATSAPP_SESSION_DIR`); production mirrors them to Object Storage. **Security note:** old session files still exist in git history because history rewriting was declined. The production session was disconnected, re-linked, and confirmed connected on September 13, 2026, so those historical credentials are invalid. Current session files must remain outside the repo and ignored.
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
   - **SHA-1 certificate fingerprint**: the debug fingerprint for development builds, **plus** — for production — the **Google Play app-signing certificate** SHA-1 (Play Console → Setup → App signing). Production ships as an AAB with Play App Signing, so devices receive builds signed by Google's app-signing certificate, **not** the EAS upload keystore.
5. Save.

**Maintenance note — signing-key changes**: if the Play app-signing key is ever upgraded/reset (or, separately, the EAS upload keystore is replaced), the restriction must be re-verified immediately, otherwise production Maps requests will be rejected. Guard: `artifacts/uc-companion/scripts/check-maps-key-fingerprint.mjs` compares current SHA-1s against the record in `artifacts/uc-companion/security/maps-key-fingerprints.json` and fails until the Play app-signing fingerprint matches **and** the Google Cloud restriction is confirmed (`--confirm-restriction`). On rotation, run it with `--update` and follow the printed steps. Full procedure (incl. migration overlap and lost/compromised-key API-key rotation): `artifacts/uc-companion/docs/maps-key-rotation-runbook.md`.

## Pre-release checklist (Android — Play Store)

Before submitting the **first production build** to the Play Store, confirm each item below:

- [ ] **Review photo/video uploads verified on physical devices** — Test both camera capture and library selection for photos and videos through upload, attach, review submission, reopening, and playback. Do not deploy while either source fails.
- [ ] **Maps key Android restriction verified** — In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), the `GOOGLE_MAPS_ANDROID_KEY` has an **Android apps** application restriction configured with package name `com.ultraclean.companion` and the SHA-1 of the **Google Play app-signing certificate** (Play Console → Setup → App signing) — not the EAS upload keystore. If the restriction is absent or uses only the debug fingerprint, rotate the key before uploading the AAB.
- [ ] **Signing fingerprint guard passes** — `node artifacts/uc-companion/scripts/check-maps-key-fingerprint.mjs --fingerprint <Play app-signing SHA-1>` exits 0 (fingerprint recorded and GCP restriction confirmed). Also record the upload keystore: `--identity upload --fingerprint <SHA-1 from eas credentials> --update`. See `artifacts/uc-companion/docs/maps-key-rotation-runbook.md`.
- [ ] EAS project initialised and `app.json` `updates.url` set to the live EAS project URL (replace `REPLACE_AFTER_EAS_PROJECT_INIT`).
- [ ] Release keystore backed up securely (loss means the app can never be updated on the Play Store under the same listing).
- [ ] `GOOGLE_MAPS_ANDROID_KEY` confirmed not committed to version control (it is injected at build time via EAS secrets / environment variables).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
