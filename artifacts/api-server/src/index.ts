import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { pool } from "@workspace/db";
import { sendViaResend } from "./lib/resend.js";
import { migrateAndGuardSessionDir } from "./lib/whatsapp";
import { backfillAccountRecords } from "./lib/account-records.js";

// ─── Global error guards ──────────────────────────────────────────────────────
// Prevent any unhandled rejection or uncaught exception from silently crashing
// the process. Log the error so it appears in deployment logs, then exit with
// a non-zero code so the platform can restart the container automatically.
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — exiting");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — exiting");
  process.exit(1);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// When the platform sends SIGTERM (during a redeploy or scale-down), finish
// in-flight requests before closing so users don't see dropped connections.
function shutdown(server: ReturnType<typeof app.listen>, signal: string) {
  logger.info({ signal }, "Shutdown signal received — closing server");
  server.close(() => {
    logger.info("All connections drained — exiting cleanly");
    process.exit(0);
  });
  // Hard-kill after 10 s if connections don't drain in time
  setTimeout(() => {
    logger.warn("Graceful shutdown timed out — force exiting");
    process.exit(1);
  }, 10_000).unref();
}

// ─── Startup migration ────────────────────────────────────────────────────────
// Add any new columns to sheet_syncs that may not exist on older deployments.
// Uses IF NOT EXISTS so it is safe to run on every startup.
async function applyStartupMigrations(): Promise<void> {
  await pool.query(`
    ALTER TABLE sheet_syncs
      ADD COLUMN IF NOT EXISTS last_error      text,
      ADD COLUMN IF NOT EXISTS last_error_at   timestamptz;
  `);
  logger.info("Startup migration: sheet_syncs error columns ensured");

  // Create google_oauth_credentials table if it doesn't exist on older deployments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_oauth_credentials (
      id            serial PRIMARY KEY,
      google_email  text NOT NULL,
      access_token  text NOT NULL,
      refresh_token text NOT NULL,
      expires_at    timestamptz NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
  `);
  logger.info("Startup migration: google_oauth_credentials table ensured");

  // Add webhook_recovery column to uc_orders if it doesn't exist on older deployments.
  await pool.query(`
    ALTER TABLE uc_orders
      ADD COLUMN IF NOT EXISTS webhook_recovery boolean NOT NULL DEFAULT false;
  `);
  logger.info("Startup migration: uc_orders webhook_recovery column ensured");

  // Add mpesa_receipt column (M-Pesa confirmation code from the Daraja callback,
  // persisted for bookkeeping/statement reconciliation) on older deployments.
  await pool.query(`
    ALTER TABLE uc_orders
      ADD COLUMN IF NOT EXISTS mpesa_receipt text NOT NULL DEFAULT '';
  `);
  logger.info("Startup migration: uc_orders mpesa_receipt column ensured");

  // Create team_settings table for DB-backed passcode storage.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_settings (
      id            text PRIMARY KEY DEFAULT 'singleton',
      passcode_hash text,
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
  `);
  logger.info("Startup migration: team_settings table ensured");

  // Add mpesa_webhook_secret_enc column (AES-256-GCM encrypted M-Pesa webhook secret).
  // This allows admins to rotate the secret from the admin panel without a server restart.
  await pool.query(`
    ALTER TABLE team_settings
      ADD COLUMN IF NOT EXISTS mpesa_webhook_secret_enc text;
  `);
  logger.info("Startup migration: team_settings.mpesa_webhook_secret_enc column ensured");

  // Add team_alert_phone column (plain text phone number for SMS fallback alerts).
  // Supersedes the TEAM_ALERT_PHONE env var; configurable from the admin panel without restart.
  await pool.query(`
    ALTER TABLE team_settings
      ADD COLUMN IF NOT EXISTS team_alert_phone text;
  `);
  logger.info("Startup migration: team_settings.team_alert_phone column ensured");

  // Partial unique index on payment_reference — prevents duplicate orders for
  // the same Paystack (or other) reference.  Excludes empty strings so COD
  // orders (no reference) are unaffected.
  //
  // Deduplication runs exactly ONCE, guarded by the index existence check.
  // This avoids silently deleting production rows on every restart.
  // If duplicate rows are detected, we log them prominently so operators can
  // review before the index is created.
  await pool.query(`
    DO $$
    BEGIN
      -- Only deduplicate and create the index if it does not yet exist.
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE  indexname = 'uc_orders_payment_reference_unique'
      ) THEN
        -- Log any rows that will be removed (visible in server logs via RAISE).
        PERFORM id, payment_reference
          FROM uc_orders
          WHERE payment_reference != ''
          AND id NOT IN (
            SELECT MIN(id)
            FROM   uc_orders
            WHERE  payment_reference != ''
            GROUP  BY payment_reference
          );

        DELETE FROM uc_orders
        WHERE id NOT IN (
          SELECT MIN(id)
          FROM   uc_orders
          WHERE  payment_reference != ''
          GROUP  BY payment_reference
        )
        AND payment_reference != '';

        CREATE UNIQUE INDEX uc_orders_payment_reference_unique
          ON uc_orders (payment_reference)
          WHERE payment_reference != '';
      END IF;
    END
    $$;
  `);
  logger.info("Startup migration: uc_orders payment_reference unique index ensured");

  // Create team_users table for individual ProjectHub accounts.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_users (
      id           text PRIMARY KEY,
      email        text NOT NULL UNIQUE,
      name         text NOT NULL,
      password_hash text NOT NULL,
      role         text NOT NULL DEFAULT 'member',
      is_active    boolean NOT NULL DEFAULT true,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );
  `);
  logger.info("Startup migration: team_users table ensured");
  // Add permissions column if upgrading from a build before page-permissions
  await pool.query(`
    ALTER TABLE team_users ADD COLUMN IF NOT EXISTS permissions jsonb;
  `);
  logger.info("Startup migration: team_users.permissions column ensured");

  // Create team_invitations table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_invitations (
      id            text PRIMARY KEY,
      email         text NOT NULL,
      token         text NOT NULL UNIQUE,
      invited_by_id text,
      accepted_at   timestamptz,
      expires_at    timestamptz NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
  `);
  logger.info("Startup migration: team_invitations table ensured");

  // Create password_reset_tokens table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         text PRIMARY KEY,
      user_id    text NOT NULL,
      token      text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at    timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  logger.info("Startup migration: password_reset_tokens table ensured");

  // Seed first admin from environment variables (runs once; idempotent).
  const adminEmail = process.env["PROJECTHUB_ADMIN_EMAIL"]?.toLowerCase().trim();
  const adminPassword = process.env["PROJECTHUB_ADMIN_PASSWORD"];
  if (adminEmail && adminPassword) {
    const existing = await pool.query(
      "SELECT id FROM team_users WHERE email = $1 LIMIT 1",
      [adminEmail],
    );
    if (existing.rows.length === 0) {
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      const { randomUUID } = await import("crypto");
      await pool.query(
        `INSERT INTO team_users (id, email, name, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, 'admin', true)
         ON CONFLICT (email) DO NOTHING`,
        [randomUUID(), adminEmail, "Admin", passwordHash],
      );
      logger.info({ email: adminEmail }, "Startup: seeded initial admin user");
    }
  }

  // Create uc_notification_log table for SMS/email send-attempt auditing.
  // Run each DDL statement separately so that ALTER TABLE / CREATE INDEX
  // do not share a single implicit transaction (which would block concurrent
  // DML for the entire batch).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_notification_log (
      id             serial       PRIMARY KEY,
      channel        text         NOT NULL,
      provider       text         NOT NULL DEFAULT '',
      recipient      text         NOT NULL,
      template       text         NOT NULL DEFAULT '',
      message_body   text         NOT NULL DEFAULT '',
      order_id       integer,
      ticket_id      text,
      test_id        text,
      status         text         NOT NULL,
      error_message  text,
      sent_at        timestamptz  NOT NULL DEFAULT now()
    )
  `);
  // Add provider column to tables that predate this migration.
  await pool.query(
    `ALTER TABLE uc_notification_log ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT ''`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS uc_notification_log_status_idx ON uc_notification_log (status)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS uc_notification_log_sent_at_idx ON uc_notification_log (sent_at)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS uc_notification_log_provider_idx ON uc_notification_log (provider)`
  );
  // Composite index so the nightly pruning DELETEs (status + sent_at cutoff)
  // and status-filtered, sent_at-ordered admin listings stay O(log n).
  await pool.query(
    `CREATE INDEX IF NOT EXISTS uc_notification_log_status_sent_at_idx ON uc_notification_log (status, sent_at)`
  );
  logger.info("Startup migration: uc_notification_log table ensured");

  // Create uc_return_requests table for customer return/refund requests.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_return_requests (
      id         serial       PRIMARY KEY,
      order_id   integer      NOT NULL,
      user_id    integer      NOT NULL,
      reason     text         NOT NULL,
      details    text         NOT NULL DEFAULT '',
      status     text         NOT NULL DEFAULT 'pending',
      created_at timestamptz  NOT NULL DEFAULT now(),
      updated_at timestamptz  NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uc_return_requests_order_user_idx ON uc_return_requests (order_id, user_id)`
  );
  logger.info("Startup migration: uc_return_requests table ensured");

  // Add deleted_at column to uc_users for GDPR/PDPA right-to-erasure revocation.
  // When set, any still-valid bearer token for this userId is rejected by
  // DB-anchored customer routes (profile, orders, tickets, water-tests, etc.).
  await pool.query(`
    ALTER TABLE uc_users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  `);
  logger.info("Startup migration: uc_users.deleted_at column ensured");

  // Add notification log retention columns to team_settings so the team can
  // configure pruning windows from the admin panel without a server restart.
  await pool.query(`
    ALTER TABLE team_settings
      ADD COLUMN IF NOT EXISTS notification_log_success_retention_days integer,
      ADD COLUMN IF NOT EXISTS notification_log_failure_retention_days integer;
  `);
  logger.info("Startup migration: team_settings notification log retention columns ensured");

  // Team Library — stores metadata for documents uploaded to GCS via the
  // Library page in ProjectHub. Actual files live in the private object dir;
  // this table holds the normalized GCS path and display metadata.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_library_docs (
      id          text         PRIMARY KEY,
      title       text         NOT NULL,
      file_name   text         NOT NULL,
      file_size   integer      NOT NULL,
      file_type   text         NOT NULL,
      object_path text         NOT NULL,
      uploaded_by text         NOT NULL,
      created_at  timestamptz  NOT NULL DEFAULT now()
    )
  `);
  logger.info("Startup migration: team_library_docs table ensured");

  // Pending upload slots — server-issued records that bind a presigned GCS path
  // to the member who requested it.  POST /library/docs validates the uploadId
  // from this table before promoting the record to team_library_docs.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_library_pending_uploads (
      id            text         PRIMARY KEY,
      object_path   text         NOT NULL,
      uploaded_by   text         NOT NULL,
      consumed      boolean      NOT NULL DEFAULT false,
      created_at    timestamptz  NOT NULL DEFAULT now(),
      expires_at    timestamptz  NOT NULL,
      declared_size integer      NOT NULL,
      declared_type text         NOT NULL
    )
  `);
  logger.info("Startup migration: team_library_pending_uploads table ensured");

  // Team improvement suggestions on Alison feedback entries (max 250 chars,
  // enforced at the API layer).
  await pool.query(`
    ALTER TABLE uc_ai_feedback ADD COLUMN IF NOT EXISTS improvement_note text;
  `);
  await pool.query(`
    ALTER TABLE uc_ai_feedback ADD COLUMN IF NOT EXISTS improvement_note_at timestamptz;
  `);
  logger.info("Startup migration: uc_ai_feedback improvement note columns ensured");

  // Once-per-product alert dedupe for the daily lifespan-audit scheduler job
  // (products missing filter_lifespan_days — see lib/scheduler.ts).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_lifespan_alerts (
      product_id integer     PRIMARY KEY,
      name       text        NOT NULL DEFAULT '',
      sku        text        NOT NULL DEFAULT '',
      alerted_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Repeat-offender tracking: rows are kept (marked resolved) instead of
  // deleted when a product is fixed, so regressions can be flagged with the
  // prior alert count in the alert email.
  await pool.query(`
    ALTER TABLE uc_lifespan_alerts
      ADD COLUMN IF NOT EXISTS alert_count integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS resolved_at timestamptz
  `);
  logger.info("Startup migration: uc_lifespan_alerts table ensured");

  // Per-push callback token for M-Pesa STK initiations.  Embeds a UUID in the
  // CallBackURL as ?token=<callbackToken> to limit blast radius if a token is
  // captured in logs.  Null on existing rows — falls back to shared-secret
  // verification (backward compatible).
  await pool.query(`
    ALTER TABLE mpesa_stk_initiations
      ADD COLUMN IF NOT EXISTS callback_token text;
  `);
  logger.info("Startup migration: mpesa_stk_initiations.callback_token column ensured");

  // Server-side mirror of each customer's registered filter activation.
  // The daily reminder-dispatch job reads this table to deliver 5-stage
  // filter lifecycle messages via email/SMS/WhatsApp for opted-in users.
  // sentStages (jsonb array) enables atomic at-most-once claiming so
  // concurrent dispatch runs can never double-send.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_filter_reminders (
      user_id         text        PRIMARY KEY,
      product_id      integer     NOT NULL,
      product_name    text        NOT NULL,
      lifespan_days   integer     NOT NULL DEFAULT 0,
      activated_at    timestamptz NOT NULL,
      source_order_id integer,
      sent_stages     jsonb       NOT NULL DEFAULT '[]'::jsonb,
      active          boolean     NOT NULL DEFAULT true,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    );
  `);
  logger.info("Startup migration: uc_filter_reminders table ensured");

  // Effective lifespan and adjusted replacement offsets — added by the check-in
  // sync feature so the server-side dispatcher fires on the same dates as the
  // rescheduled phone notifications.  synced_at is the monotonic version token
  // used for atomic stale-write rejection in the upsert WHERE clause.
  await pool.query(`
    ALTER TABLE uc_filter_reminders
      ADD COLUMN IF NOT EXISTS effective_lifespan_days  integer,
      ADD COLUMN IF NOT EXISTS adjusted_replace_offsets jsonb,
      ADD COLUMN IF NOT EXISTS synced_at                timestamptz;
  `);
  logger.info("Startup migration: uc_filter_reminders effective_lifespan / adjusted_replace_offsets / synced_at columns ensured");

  // Opt-in channel flags for filter replacement reminders (email / SMS / WhatsApp).
  // All default false — customers explicitly enable each channel.
  await pool.query(`
    ALTER TABLE uc_notif_prefs
      ADD COLUMN IF NOT EXISTS reminder_email    boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS reminder_sms      boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS reminder_whatsapp boolean NOT NULL DEFAULT false;
  `);
  logger.info("Startup migration: uc_notif_prefs reminder channel columns ensured");

  // Clerk social sign-in columns on uc_users (added by Clerk integration).
  // clerk_user_id links the row to a Clerk identity; auth_provider records
  // which credential was used to create the account ("password" or "clerk").
  await pool.query(`
    ALTER TABLE uc_users
      ADD COLUMN IF NOT EXISTS clerk_user_id text,
      ADD COLUMN IF NOT EXISTS auth_provider  text NOT NULL DEFAULT 'password';
  `);
  // The unique constraint must carry the drizzle-generated name
  // (uc_users_clerk_user_id_unique). An inline "text UNIQUE" would create it
  // as uc_users_clerk_user_id_key, and drizzle push would then try to add a
  // second constraint behind an interactive prompt — breaking post-merge
  // setup. Rename a legacy _key constraint if present, else create it.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'uc_users'::regclass
                   AND conname  = 'uc_users_clerk_user_id_key') THEN
        ALTER TABLE uc_users RENAME CONSTRAINT
          uc_users_clerk_user_id_key TO uc_users_clerk_user_id_unique;
      ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'uc_users'::regclass
                          AND conname  = 'uc_users_clerk_user_id_unique') THEN
        ALTER TABLE uc_users
          ADD CONSTRAINT uc_users_clerk_user_id_unique UNIQUE (clerk_user_id);
      END IF;
    END $$;
  `);
  logger.info("Startup migration: uc_users clerk_user_id / auth_provider columns ensured");

  // AI Monitor durability: persisted AI status reports + orchestrator push
  // history. Reports survive API restarts (no silent regeneration) and every
  // manual/scheduled push is recorded with a UUID the orchestrator references
  // when echoing status updates back to POST /api/ai/echo.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_reports (
      id           serial PRIMARY KEY,
      summary      text NOT NULL,
      highlights   jsonb NOT NULL DEFAULT '[]'::jsonb,
      risks        jsonb NOT NULL DEFAULT '[]'::jsonb,
      generated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  logger.info("Startup migration: ai_reports table ensured");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_push_events (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      payload_type      text NOT NULL,
      trigger           text NOT NULL,
      target            text NOT NULL DEFAULT '',
      sent_at           timestamptz NOT NULL DEFAULT now(),
      outbound_ok       boolean NOT NULL DEFAULT false,
      outbound_message  text NOT NULL DEFAULT '',
      status            text NOT NULL DEFAULT 'pending',
      status_detail     text NOT NULL DEFAULT '',
      status_updated_at timestamptz NOT NULL DEFAULT now(),
      last_echo_at      timestamptz
    );
  `);
  logger.info("Startup migration: ai_push_events table ensured");
}
async function checkProductionSecurityConfig(): Promise<void> {
  if (process.env["NODE_ENV"] !== "production") return;

  // Check env-var first (fast path — no DB hit required)
  const hasEnvSecret = Boolean(process.env["MPESA_WEBHOOK_SECRET"]);
  if (hasEnvSecret) return;

  // Check DB (admin may have set the secret from the admin panel)
  let hasDbSecret = false;
  try {
    const row = await pool.query<{ mpesa_webhook_secret_enc: string | null }>(
      "SELECT mpesa_webhook_secret_enc FROM team_settings WHERE id = 'singleton' LIMIT 1"
    );
    hasDbSecret = Boolean(row.rows[0]?.mpesa_webhook_secret_enc);
  } catch {
    // Table may not exist on a brand-new deployment; the migration above creates it.
    // If the query fails, treat it as "not set" and send the alert anyway.
  }

  if (hasDbSecret) return;

  // Neither env var nor DB secret is configured — alert the team.
  logger.warn(
    "SECURITY WARNING: MPESA_WEBHOOK_SECRET is not set in production. " +
    "Sending alert email to the team inbox."
  );

  sendViaResend({
    from:    "Ultra Clear App <noreply@contacts.ucfilters.com>",
    to:      "info@ucfilters.com",
    subject: "⚠️ Security misconfiguration: M-Pesa webhook secret is missing",
    text: [
      "The Ultra Clear API server has started in production mode without an",
      "M-Pesa webhook secret configured.",
      "",
      "Impact: Any internet client can POST a forged 'paid' callback to",
      "  /api/payments/mpesa/callback",
      "and trigger fraudulent order fulfilment without making a real payment.",
      "",
      "Action required:",
      "  1. Log in to the admin panel (Admin → Payment Settings).",
      "  2. Set the M-Pesa Webhook Secret to a strong random string.",
      "     You can generate one with: openssl rand -hex 32",
      "  3. The new secret takes effect immediately — no server restart needed.",
      "",
      "Alternatively, set the MPESA_WEBHOOK_SECRET environment variable and",
      "redeploy the server.",
      "",
      "This alert fires once per server startup while the secret remains unset.",
    ].join("\n"),
    meta: { template: "security_misconfiguration_alert" },
  }).catch((err) => {
    logger.error({ err }, "Failed to send security misconfiguration alert email");
  });
}
const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

applyStartupMigrations()
  .then(async () => {
    // Fire-and-forget — a failure here must not prevent the server from starting.
    checkProductionSecurityConfig().catch((err) => {
      logger.error({ err }, "Security config check failed");
    });

    // Move any legacy in-repo WhatsApp session files outside the repo and warn
    // loudly if credentials are ever detected inside the working tree.
    migrateAndGuardSessionDir().catch((err) => {
      logger.error({ err }, "WhatsApp session dir check failed");
    });

    // One-time backfill of existing accounts into the durable data folder
    // (marker-guarded; retries on next boot if the DB is unavailable).
    backfillAccountRecords().catch((err) => {
      logger.error({ err }, "Account records backfill failed — will retry on next start");
    });

    const server = app.listen(port, (err?: Error) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
      startScheduler();
    });

    process.on("SIGTERM", () => shutdown(server, "SIGTERM"));
    process.on("SIGINT",  () => shutdown(server, "SIGINT"));
  })
  .catch((err) => {
    logger.error({ err }, "Startup migration failed — exiting");
    process.exit(1);
  });
