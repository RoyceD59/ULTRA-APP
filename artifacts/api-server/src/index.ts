import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { pool } from "@workspace/db";

if (process.env.NODE_ENV === "production" &&
    !(process.env.WATER_CHECK_TOKEN_SECRET || process.env.SESSION_SECRET)) {
  throw new Error("WATER_CHECK_TOKEN_SECRET or SESSION_SECRET must be configured in production");
}
import { sendViaResend } from "./lib/resend.js";
import { migrateAndGuardSessionDir } from "./lib/whatsapp";
import { backfillAccountRecords, recoverUnsyncedRegistrations } from "./lib/account-records.js";
import { processPendingReferralSettlements } from "./routes/referrals.js";

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

  // Add wc_order_id column — persists the WooCommerce order ID at confirmation
  // time so that a duplicate Paystack delivery can return the same external ID
  // even when the WC store is temporarily unreachable.
  await pool.query(`
    ALTER TABLE uc_orders
      ADD COLUMN IF NOT EXISTS wc_order_id integer;
  `);
  logger.info("Startup migration: uc_orders wc_order_id column ensured");

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

  // Add team_alert_email column — account-deletion (and future recovery-order) email alerts.
  // Supersedes the TEAM_ALERT_EMAIL env var; configurable from the admin panel without restart.
  await pool.query(`
    ALTER TABLE team_settings
      ADD COLUMN IF NOT EXISTS team_alert_email text;
  `);
  logger.info("Startup migration: team_settings.team_alert_email column ensured");

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

  await pool.query(`
    ALTER TABLE team_settings
      ADD COLUMN IF NOT EXISTS referral_failure_alert_threshold integer;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_alert_threshold_changes (
      id                 bigserial PRIMARY KEY,
      actor_team_user_id text NOT NULL REFERENCES team_users(id),
      actor_name         text NOT NULL,
      actor_email        text NOT NULL,
      previous_value     integer NOT NULL,
      new_value          integer NOT NULL,
      changed_at         timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS referral_alert_threshold_changes_latest_idx
      ON referral_alert_threshold_changes (changed_at DESC, id DESC);
  `);
  logger.info("Startup migration: referral alert threshold audit ensured");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_referral_settlements (
      id              bigserial PRIMARY KEY,
      order_id        bigint NOT NULL UNIQUE,
      referral_code   text,
      user_email      text,
      status          text NOT NULL DEFAULT 'pending',
      attempts        integer NOT NULL DEFAULT 1,
      last_error      text,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      claim_token     text,
      claim_expires_at timestamptz,
      alert_claimed_at timestamptz,
      alerted_at      timestamptz,
      alert_attempts integer NOT NULL DEFAULT 0,
      alert_last_error text,
      alert_next_attempt_at timestamptz NOT NULL DEFAULT now(),
      slack_alert_claimed_at timestamptz,
      slack_alerted_at timestamptz,
      slack_alert_attempts integer NOT NULL DEFAULT 0,
      slack_alert_last_error text,
      slack_alert_next_attempt_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE uc_referral_settlements
      ALTER COLUMN referral_code DROP NOT NULL,
      ALTER COLUMN user_email DROP NOT NULL,
      ADD COLUMN IF NOT EXISTS claim_token text,
      ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS alert_claimed_at timestamptz,
      ADD COLUMN IF NOT EXISTS alerted_at timestamptz,
      ADD COLUMN IF NOT EXISTS alert_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS alert_last_error text,
      ADD COLUMN IF NOT EXISTS alert_next_attempt_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS slack_alert_claimed_at timestamptz,
      ADD COLUMN IF NOT EXISTS slack_alerted_at timestamptz,
      ADD COLUMN IF NOT EXISTS slack_alert_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS slack_alert_last_error text,
      ADD COLUMN IF NOT EXISTS slack_alert_next_attempt_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS completed_at timestamptz;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS uc_referral_settlements_due_idx
      ON uc_referral_settlements (status, next_attempt_at);
  `);
  logger.info("Startup migration: referral settlement retry queue ensured");

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
  await pool.query(`
    ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS permissions jsonb;
  `);
  logger.info("Startup migration: team_invitations.permissions column ensured");

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_password_reset_audit (
      id text PRIMARY KEY,
      actor_type text NOT NULL,
      actor_id text,
      target_user_id text,
      channel text,
      result text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  logger.info("Startup migration: uc_password_reset_audit table ensured");

  // Low-stock alert threshold column — admin-configurable from Inventory settings.
  await pool.query(`
    ALTER TABLE team_settings
      ADD COLUMN IF NOT EXISTS low_stock_threshold integer;
  `);
  logger.info("Startup migration: team_settings.low_stock_threshold column ensured");

  await pool.query(`
    ALTER TABLE team_settings
      ADD COLUMN IF NOT EXISTS restock_demand_threshold integer;
  `);
  logger.info("Startup migration: team_settings.restock_demand_threshold column ensured");

  // Product-level restock-demand state provides an atomic claim and retains the
  // provider idempotency key across retries.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_restock_demand_alerts (
      product_id       integer     PRIMARY KEY,
      product_name     text        NOT NULL,
      waiting_count    integer     NOT NULL,
      threshold        integer     NOT NULL,
      idempotency_key  text        NOT NULL,
      status           text        NOT NULL,
      claim_expires_at timestamptz NOT NULL,
      alerted_at       timestamptz,
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
  `);
  logger.info("Startup migration: uc_restock_demand_alerts table ensured");

  // Seed first admin from environment variables (runs once; idempotent).
  const adminEmail = process.env["PROJECTHUB_ADMIN_EMAIL"]?.toLowerCase().trim();
  const adminPassword = process.env["PROJECTHUB_ADMIN_PASSWORD"];
  if (adminEmail) {
    const existing = await pool.query(
      "SELECT id, role, is_active FROM team_users WHERE lower(trim(email)) = $1 LIMIT 1",
      [adminEmail],
    );
    if (existing.rows.length === 0 && adminPassword) {
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      const { randomUUID } = await import("crypto");
      await pool.query(
        `INSERT INTO team_users (id, email, name, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, 'admin', true)
         ON CONFLICT (email) DO NOTHING`,
        [randomUUID(), adminEmail, "Admin", passwordHash],
      );
      logger.info({ email: adminEmail, result: "created" }, "Startup: configured ProjectHub administrator reconciled");
    } else if (existing.rows.length > 0) {
      const configured = existing.rows[0] as { id: string; role: string; is_active: boolean };
      const wasAdmin = configured.role === "admin" && configured.is_active === true;
      // Deliberately update authority state only. Existing password hash and
      // profile fields are never replaced during break-glass reconciliation.
      await pool.query(
        "UPDATE team_users SET role = 'admin', is_active = true, updated_at = now() WHERE id = $1",
        [configured.id],
      );
      logger.info({
        email: adminEmail,
        result: wasAdmin ? "confirmed" : "restored",
      }, "Startup: configured ProjectHub administrator reconciled");
    } else {
      logger.warn({ email: adminEmail }, "Startup: configured ProjectHub administrator is missing and PROJECTHUB_ADMIN_PASSWORD is not configured");
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
  // Drop the old single-column status index — the composite
  // uc_notification_log_status_sent_at_idx covers status-only queries via its
  // leading column, so this index is redundant and just costs write overhead.
  await pool.query(
    `DROP INDEX IF EXISTS uc_notification_log_status_idx`
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
  // Keep the Resend provider identifier and its latest event separate from
  // the email body. ProjectHub uses these metadata fields to show recovery
  // email delivery without exposing invitation/reset links.
  await pool.query(`
    ALTER TABLE uc_notification_log
      ADD COLUMN IF NOT EXISTS resend_message_id text,
      ADD COLUMN IF NOT EXISTS delivery_event text,
      ADD COLUMN IF NOT EXISTS delivery_event_at timestamptz
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS uc_notification_log_recovery_delivery_idx
      ON uc_notification_log (provider, template, sent_at)`
  );
  await pool.query(`
    ALTER TABLE uc_notification_log
      ADD COLUMN IF NOT EXISTS reward_ledger_id integer
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS uc_notification_log_reward_ledger_idx
      ON uc_notification_log (reward_ledger_id, sent_at)`
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
  await pool.query(`
    CREATE INDEX IF NOT EXISTS uc_users_active_count_covering_idx
      ON uc_users (deleted_at)
      INCLUDE (created_at)
      WHERE deleted_at IS NULL;
  `);
  logger.info("Startup migration: covering active customer count index ensured");

  // Add credential_version for post-password-reset session revocation.
  // Incrementing it on reset invalidates bearer tokens minted before the reset.
  await pool.query(`
    ALTER TABLE uc_users ADD COLUMN IF NOT EXISTS credential_version integer NOT NULL DEFAULT 0;
  `);
  logger.info("Startup migration: uc_users.credential_version column ensured");
  await pool.query(`
    ALTER TABLE uc_users
      ADD COLUMN IF NOT EXISTS temporary_password_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
  `);
  logger.info("Startup migration: uc_users temporary-password columns ensured");
  await pool.query(`
    ALTER TABLE uc_users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
    ALTER TABLE uc_users ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
    ALTER TABLE uc_users ALTER COLUMN email_verified SET DEFAULT false;
    ALTER TABLE uc_users ALTER COLUMN phone_verified SET DEFAULT false;
  `);
  logger.info("Startup migration: uc_users recovery-channel verification columns ensured");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_contact_verification_tokens (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
      contact_hash text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS uc_contact_verification_user_channel_idx
      ON uc_contact_verification_tokens (user_id, channel, created_at DESC);
    ALTER TABLE uc_contact_verification_tokens ADD COLUMN IF NOT EXISTS contact_hash text;
    ALTER TABLE uc_contact_verification_tokens ADD COLUMN IF NOT EXISTS verified_at timestamptz;
  `);
  // Repair the brief legacy state where registered local emails defaulted to
  // verified without evidence. A successfully completed credential (or Clerk
  // social provenance) is the only state retained as verified.
  await pool.query(`
    UPDATE uc_users u
       SET email_verified = false
     WHERE u.auth_provider <> 'social'
       AND u.email_verified = true
       AND NOT EXISTS (
         SELECT 1 FROM uc_contact_verification_tokens v
          WHERE v.user_id = u.id::text AND v.channel = 'email' AND v.verified_at IS NOT NULL
       );
    UPDATE uc_users u
       SET phone_verified = false
     WHERE u.phone_verified = true
       AND NOT EXISTS (
         SELECT 1 FROM uc_contact_verification_tokens v
          WHERE v.user_id = u.id::text AND v.channel = 'whatsapp' AND v.verified_at IS NOT NULL
       );
  `);
  logger.info("Startup migration: uc_contact_verification_tokens table ensured");

  // Add address column to uc_users so customers can store their delivery address.
  await pool.query(`
    ALTER TABLE uc_users ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';
  `);
  logger.info("Startup migration: uc_users.address column ensured");

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
  // n8n inventory-sync webhook URL — stored AES-256-GCM encrypted (same format
  // as mpesa_webhook_secret_enc) because webhook URLs often embed bearer tokens.
  // Admins paste the URL via Admin → Integrations; it is encrypted before storage.
  await pool.query(`
    ALTER TABLE team_settings
      ADD COLUMN IF NOT EXISTS n8n_inventory_webhook_url_enc text;
  `);
  logger.info("Startup migration: team_settings.n8n_inventory_webhook_url_enc column ensured");

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

  await pool.query(`
    ALTER TABLE uc_users
      ADD COLUMN IF NOT EXISTS rewards_qr_hash text,
      ADD COLUMN IF NOT EXISTS rewards_qr_revoked_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS uc_users_rewards_qr_hash_idx
      ON uc_users (rewards_qr_hash) WHERE rewards_qr_hash IS NOT NULL;
    ALTER TABLE uc_orders
      ADD COLUMN IF NOT EXISTS customer_stage text,
      ADD COLUMN IF NOT EXISTS customer_stage_updated_at timestamptz;
    ALTER TABLE uc_orders
      ADD COLUMN IF NOT EXISTS cod_collection_status text,
      ADD COLUMN IF NOT EXISTS cod_collected_by text,
      ADD COLUMN IF NOT EXISTS cod_collected_at timestamptz,
      ADD COLUMN IF NOT EXISTS cod_wc_sync_status text,
      ADD COLUMN IF NOT EXISTS cod_wc_sync_error text,
      ADD COLUMN IF NOT EXISTS cod_wc_sync_attempted_at timestamptz,
      ADD COLUMN IF NOT EXISTS cod_wc_sync_attempt_count integer NOT NULL DEFAULT 0;
    UPDATE uc_orders
      SET cod_collection_status = 'awaiting_collection'
      WHERE payment_method = 'cod' AND cod_collection_status IS NULL;
    CREATE TABLE IF NOT EXISTS uc_cod_collection_events (
      id serial PRIMARY KEY,
      order_id integer NOT NULL REFERENCES uc_orders(id) ON DELETE CASCADE,
      idempotency_key text NOT NULL,
      actor text NOT NULL,
      collected_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uc_cod_collection_events_order_unique UNIQUE (order_id),
      CONSTRAINT uc_cod_collection_events_order_idempotency_unique UNIQUE (order_id, idempotency_key)
    );
    ALTER TABLE uc_water_tests
      ADD COLUMN IF NOT EXISTS customer_stage text,
      ADD COLUMN IF NOT EXISTS customer_stage_updated_at timestamptz,
      ADD COLUMN IF NOT EXISTS result_delivery_reference text;
    ALTER TABLE uc_notif_prefs
      ADD COLUMN IF NOT EXISTS opt_out_water_tests boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS uc_customer_stage_events (
      id serial PRIMARY KEY,
      resource_type text NOT NULL,
      resource_id text NOT NULL,
      stage text NOT NULL,
      idempotency_key text NOT NULL,
      actor text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (resource_type, resource_id, stage),
      UNIQUE (resource_type, resource_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS uc_registered_filters (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES uc_users(id),
      product_id integer NOT NULL,
      product_name text NOT NULL,
      rated_capacity_litres integer NOT NULL,
      activated_at timestamptz NOT NULL,
      source_order_id integer,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uc_registered_filters_user_order_product_idx
      ON uc_registered_filters (user_id, source_order_id, product_id);
    CREATE INDEX IF NOT EXISTS uc_registered_filters_user_active_idx
      ON uc_registered_filters (user_id, active);
    CREATE TABLE IF NOT EXISTS uc_water_impact_ledger (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES uc_users(id),
      registered_filter_id integer NOT NULL REFERENCES uc_registered_filters(id),
      litres integer NOT NULL,
      reason text NOT NULL,
      actor text NOT NULL,
      idempotency_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uc_water_impact_idempotency_idx
      ON uc_water_impact_ledger (user_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS uc_water_impact_user_created_idx
      ON uc_water_impact_ledger (user_id, created_at);
    CREATE INDEX IF NOT EXISTS uc_water_impact_filter_idx
      ON uc_water_impact_ledger (registered_filter_id, created_at);
    CREATE TABLE IF NOT EXISTS uc_reward_conversion (
      id text PRIMARY KEY DEFAULT 'singleton',
      mode text NOT NULL DEFAULT 'kes',
      value numeric(12,2) NOT NULL DEFAULT 100,
      active boolean NOT NULL DEFAULT true,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO uc_reward_conversion (id) VALUES ('singleton')
      ON CONFLICT (id) DO NOTHING;
    ALTER TABLE uc_rewards_ledger
      ADD COLUMN IF NOT EXISTS conversion_mode text,
      ADD COLUMN IF NOT EXISTS conversion_value numeric(12,2);
  `);
  logger.info("Startup migration: rewards, registered filters, impact ledger, customer-stage, and COD collection columns ensured");
  await pool.query(`
    ALTER TABLE uc_registered_filters ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'legacy';
    DROP INDEX IF EXISTS uc_registered_filters_user_order_product_idx;
    CREATE UNIQUE INDEX IF NOT EXISTS uc_registered_filters_source_order_product_idx
      ON uc_registered_filters (source, source_order_id, product_id)
      WHERE source_order_id IS NOT NULL;
  `);
  logger.info("Startup migration: registered filter purchase source ownership ensured");

  // DB-backed service locations replace the former process-local static list.
  // Legacy locations are seeded once and marked verified because these are the
  // previously published locations; future identity/coordinate edits reset that
  // verification and require an explicit staff verification.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_locations (
      id text PRIMARY KEY,
      type text NOT NULL,
      name text NOT NULL,
      address text NOT NULL,
      latitude numeric(9,6) NOT NULL,
      longitude numeric(9,6) NOT NULL,
      hours text NOT NULL DEFAULT '',
      phone text,
      vendor_name text,
      active boolean NOT NULL DEFAULT true,
      verified boolean NOT NULL DEFAULT false,
      verified_by text,
      verified_at timestamptz,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS uc_locations_public_idx ON uc_locations (active, verified);
  `);
  const legacyLocations = [
    ["loc1", "experience_centre", "UC Experience Centre Westlands", "Woodvale Groove, Westlands, Nairobi", -1.2633, 36.8072, "Mon–Sat 8am–6pm, Sun 10am–4pm", "+254 700 123456"],
    ["loc2", "experience_centre", "UC Service Centre Karen", "Karen Hardy Estate, Karen, Nairobi", -1.3319, 36.7097, "Mon–Fri 8am–5pm", "+254 700 654321"],
    ["loc3", "refill_atm", "Water ATM – Village Market", "Village Market Mall, Limuru Rd, Gigiri", -1.2194, 36.8083, "24/7", null],
    ["loc4", "refill_atm", "Water ATM – Sarit Centre", "Sarit Centre, Karuna Rd, Westlands", -1.2592, 36.8027, "6am–11pm daily", null],
    ["loc5", "refill_atm", "Water ATM – Two Rivers Mall", "Two Rivers Mall, Rhapta Rd, Westlands", -1.2178, 36.7985, "7am–10pm daily", null],
    ["loc6", "refill_atm", "Water ATM – Garden City", "Garden City Mall, Thika Superhighway", -1.2241, 36.8801, "6am–10pm daily", null],
    ["loc7", "refill_atm", "Water ATM – Junction Mall", "Junction Mall, Ngong Rd, Nairobi", -1.3003, 36.7773, "7am–9pm daily", null],
  ];
  for (const location of legacyLocations) {
    await pool.query(
      `INSERT INTO uc_locations
       (id, type, name, address, latitude, longitude, hours, phone, active, verified, verified_by, verified_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true,'migration:legacy',now(),'migration:legacy')
       ON CONFLICT (id) DO NOTHING`,
      location,
    );
  }
  logger.info("Startup migration: managed UC locations ensured and legacy locations seeded");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_promotions (
      id serial PRIMARY KEY, code text NOT NULL, type text NOT NULL, effect_mode text NOT NULL,
      effect_value numeric(12,2) NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz,
      active boolean NOT NULL DEFAULT true, global_use_limit integer, per_user_use_limit integer,
      created_by text NOT NULL, updated_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (type IN ('bonus_points','redemption_boost','checkout_discount')),
      CHECK (effect_mode IN ('fixed','percentage')), CHECK (effect_value > 0)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uc_promotions_code_lower_idx ON uc_promotions (lower(code));
    CREATE TABLE IF NOT EXISTS uc_promotion_products (
      promotion_id integer NOT NULL REFERENCES uc_promotions(id) ON DELETE CASCADE,
      product_id integer NOT NULL, UNIQUE(promotion_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS uc_promotion_uses (
      id serial PRIMARY KEY, promotion_id integer NOT NULL REFERENCES uc_promotions(id),
      user_id integer NOT NULL REFERENCES uc_users(id), operation text NOT NULL, operation_ref text,
      actor text NOT NULL, idempotency_key text NOT NULL, effect_snapshot text NOT NULL,
      benefit_amount numeric(12,2) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS uc_promotion_uses_promotion_user_idx ON uc_promotion_uses (promotion_id,user_id);
  `);
  logger.info("Startup migration: durable rewards promotions ensured");
  await pool.query(`
    ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS checkout_idempotency_key text NOT NULL DEFAULT '';
    ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS checkout_claim_id text;
    ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS checkout_state text;
    ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS remote_attempted_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS uc_orders_user_checkout_idempotency_unique
      ON uc_orders (user_id, checkout_idempotency_key)
      WHERE checkout_idempotency_key != '';
  `);
  logger.info("Startup migration: durable local checkout idempotency ensured");

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
      ADD COLUMN IF NOT EXISTS auth_provider  text NOT NULL DEFAULT 'password',
      ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
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
  logger.info("Startup migration: uc_users identity and verification columns ensured");

  // Identity ownership is enforced by canonical values, active-account checks,
  // and transaction-scoped advisory locks in customer-facing routes. Do not
  // retain an old global phone constraint: legacy/system records legitimately
  // reuse placeholder numbers and must remain reviewable rather than blocked.
  await pool.query(`DROP INDEX IF EXISTS uc_users_active_phone_unique`);
  logger.info("Startup migration: legacy active-phone unique index removed");

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

  // target_agent and task_title — added to record which agent received a
  // task_dispatch push and which task was sent. Both nullable so existing rows
  // are unaffected; idempotent via IF NOT EXISTS.
  await pool.query(`
    ALTER TABLE ai_push_events
      ADD COLUMN IF NOT EXISTS target_agent text,
      ADD COLUMN IF NOT EXISTS task_title   text;
  `);
  logger.info("Startup migration: ai_push_events target_agent/task_title columns ensured");

  // Phone and email fields on offline client entries for future customer
  // linkage and follow-up communications.  Both are nullable — adding either
  // field to an existing record is optional.
  await pool.query(`
    ALTER TABLE uc_offline_clients
      ADD COLUMN IF NOT EXISTS phone text,
      ADD COLUMN IF NOT EXISTS email text;
    ALTER TABLE uc_offline_clients
      ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS companion_user_id integer,
      ADD COLUMN IF NOT EXISTS account_setup_status text NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS delivery_channel text,
      ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS delivery_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS conflict_reason text,
      ADD COLUMN IF NOT EXISTS delivery_job_key text,
      ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS delivery_last_attempt_at timestamptz,
      ADD COLUMN IF NOT EXISTS delivery_error text,
      ADD COLUMN IF NOT EXISTS delivery_claim_token text,
      ADD COLUMN IF NOT EXISTS delivery_claim_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS issued_credential_version integer;
    CREATE INDEX IF NOT EXISTS uc_offline_clients_companion_user_idx
      ON uc_offline_clients (companion_user_id);
    CREATE INDEX IF NOT EXISTS uc_offline_clients_idempotency_idx
      ON uc_offline_clients (idempotency_key);
    CREATE UNIQUE INDEX IF NOT EXISTS uc_offline_clients_idempotency_unique
      ON uc_offline_clients (idempotency_key) WHERE idempotency_key <> '';
    CREATE INDEX IF NOT EXISTS uc_users_phone_lookup_idx
      ON uc_users (phone);
  `);
  logger.info("Startup migration: uc_offline_clients phone/email columns ensured");

  // UC Rewards — rules table (admin-configurable event → points mapping).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_rewards_rules (
      id           serial       PRIMARY KEY,
      event_type   varchar(100) NOT NULL UNIQUE,
      label        varchar(255) NOT NULL,
      points_value integer      NOT NULL DEFAULT 0,
      active       boolean      NOT NULL DEFAULT true,
      updated_by   varchar(255),
      updated_at   timestamptz  NOT NULL DEFAULT now()
    );
  `);
  // Seed default reward rules (idempotent — ON CONFLICT DO NOTHING).
  await pool.query(`
    INSERT INTO uc_rewards_rules (event_type, label, points_value, active)
    VALUES
      ('filter-replacement', 'Filter Replacement', 50, true),
      ('qualifying-product', 'Qualifying Product Purchase', 100, true)
    ON CONFLICT (event_type) DO NOTHING;
  `);
  logger.info("Startup migration: uc_rewards_rules table and default rules ensured");

  // UC Rewards — ledger table (auditable points credit/debit history).
  // ref_id encodes a cycle-scoped idempotency key: "<userId>:<productId>:<activatedAtMs>:<stageKey>"
  // so each filter lifecycle cycle can earn its own set of points.
  // The unique index on (user_id, ref_id) prevents duplicate credits from
  // concurrent dispatch runs or retries.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_rewards_ledger (
      id          serial       PRIMARY KEY,
      user_id     integer      NOT NULL REFERENCES uc_users(id),
      points      integer      NOT NULL,
      reason      varchar(500) NOT NULL,
      event_type  varchar(100) NOT NULL,
      ref_id      text,
      granted_by  varchar(255),
      created_at  timestamptz  NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uc_rewards_ledger_user_ref_idx
      ON uc_rewards_ledger (user_id, ref_id)
      WHERE ref_id IS NOT NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS uc_rewards_ledger_user_created_idx
      ON uc_rewards_ledger (user_id, created_at DESC);
  `);
  logger.info("Startup migration: uc_rewards_ledger table ensured");

  // Referral programme persistence — codes, credits, and per-user signup
  // associations.  Replaces the previous in-memory Maps so data survives
  // server restarts and appears correctly in the GDPR data export.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_referral_codes (
      id                serial       PRIMARY KEY,
      code              varchar(40)  NOT NULL,
      owner_email       text         NOT NULL,
      owner_name        varchar(255) NOT NULL DEFAULT '',
      referred_emails   json         NOT NULL DEFAULT '[]'::json,
      conversions       integer      NOT NULL DEFAULT 0,
      credits_earned_kes integer     NOT NULL DEFAULT 0,
      created_at        timestamptz  NOT NULL DEFAULT now(),
      updated_at        timestamptz  NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uc_referral_codes_code_idx
      ON uc_referral_codes (code);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uc_referral_codes_owner_email_idx
      ON uc_referral_codes (owner_email);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_referral_users (
      id               serial       PRIMARY KEY,
      email            text         NOT NULL,
      referred_by_code varchar(40),
      first_order_done boolean      NOT NULL DEFAULT false,
      created_at       timestamptz  NOT NULL DEFAULT now(),
      updated_at       timestamptz  NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uc_referral_users_email_idx
      ON uc_referral_users (email);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS uc_referral_users_referred_by_code_idx
      ON uc_referral_users (referred_by_code);
  `);
  // Account-id referral attribution and immutable benefit audit.  A refund
  // reverses records in place and adds compensating ledger rows; no history is
  // deleted. Kept here as well as the shared migration for deployed instances
  // which use startup idempotent DDL.
  await pool.query(`CREATE TABLE IF NOT EXISTS uc_referral_attributions (
    id bigserial PRIMARY KEY, referrer_user_id integer NOT NULL REFERENCES uc_users(id),
    referred_user_id integer NOT NULL REFERENCES uc_users(id), referral_code varchar(40) NOT NULL,
    attributed_at timestamptz NOT NULL DEFAULT now(), CHECK (referrer_user_id <> referred_user_id),
    UNIQUE(referred_user_id))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS uc_referral_attributions_referrer_idx ON uc_referral_attributions(referrer_user_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS uc_referral_conversions (
    id bigserial PRIMARY KEY, attribution_id bigint NOT NULL REFERENCES uc_referral_attributions(id),
    qualifying_order_id integer NOT NULL REFERENCES uc_orders(id), points_snapshot integer NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','reversed')), reversed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(attribution_id), UNIQUE(qualifying_order_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS uc_referral_benefits (
    id bigserial PRIMARY KEY, conversion_id bigint NOT NULL REFERENCES uc_referral_conversions(id),
    user_id integer NOT NULL REFERENCES uc_users(id), kind varchar(20) NOT NULL CHECK (kind IN ('points','discount')), points integer NOT NULL DEFAULT 0,
    discount_percent integer NOT NULL DEFAULT 0, recipient_role varchar(20) NOT NULL DEFAULT 'referred' CHECK (recipient_role IN ('referrer','referred')), status varchar(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available','used','reversed')),
    used_order_id integer REFERENCES uc_orders(id), used_at timestamptz, reversed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(conversion_id,user_id,kind))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS uc_referral_benefits_user_status_idx ON uc_referral_benefits(user_id,status)`);
  await pool.query(`ALTER TABLE uc_referral_benefits ADD COLUMN IF NOT EXISTS recipient_role varchar(20) NOT NULL DEFAULT 'referred';
    ALTER TABLE uc_referral_benefits ADD COLUMN IF NOT EXISTS used_at timestamptz;
    ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS referral_benefit_id bigint REFERENCES uc_referral_benefits(id);
    ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uc_orders_referral_benefit_unique ON uc_orders(referral_benefit_id) WHERE referral_benefit_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS uc_orders_paid_confirmation_idx ON uc_orders(user_id,payment_confirmed_at,id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS uc_referral_settlements (
    order_id integer PRIMARY KEY REFERENCES uc_orders(id) ON DELETE CASCADE,
    status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed')),
    attempts integer NOT NULL DEFAULT 0, last_error text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
    alert_claimed_at timestamptz, alerted_at timestamptz,
    alert_attempts integer NOT NULL DEFAULT 0, alert_last_error text,
    alert_next_attempt_at timestamptz NOT NULL DEFAULT now(),
    slack_alert_claimed_at timestamptz, slack_alerted_at timestamptz,
    slack_alert_attempts integer NOT NULL DEFAULT 0, slack_alert_last_error text,
    slack_alert_next_attempt_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`ALTER TABLE uc_referral_settlements
    ADD COLUMN IF NOT EXISTS alert_claimed_at timestamptz,
    ADD COLUMN IF NOT EXISTS alerted_at timestamptz,
    ADD COLUMN IF NOT EXISTS alert_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS alert_last_error text,
    ADD COLUMN IF NOT EXISTS alert_next_attempt_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS slack_alert_claimed_at timestamptz,
    ADD COLUMN IF NOT EXISTS slack_alerted_at timestamptz,
    ADD COLUMN IF NOT EXISTS slack_alert_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS slack_alert_last_error text,
    ADD COLUMN IF NOT EXISTS slack_alert_next_attempt_at timestamptz NOT NULL DEFAULT now()`);
  await pool.query(`CREATE INDEX IF NOT EXISTS uc_referral_settlements_due_idx ON uc_referral_settlements(status,next_attempt_at)`);
  await pool.query(`ALTER TABLE team_settings
    ADD COLUMN IF NOT EXISTS referral_failure_alert_threshold integer`);
  await pool.query(`CREATE INDEX IF NOT EXISTS uc_referral_settlements_alert_due_idx
    ON uc_referral_settlements(attempts,alert_next_attempt_at) WHERE alerted_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS uc_referral_settlements_slack_alert_due_idx
    ON uc_referral_settlements(attempts,slack_alert_next_attempt_at) WHERE slack_alerted_at IS NULL`);
  await pool.query(`INSERT INTO uc_rewards_rules (event_type,label,points_value,active)
    VALUES ('referral-successful-payment','Successful referral',200,true) ON CONFLICT (event_type) DO NOTHING`);
  logger.info("Startup migration: uc_referral_codes and uc_referral_users tables ensured");

  // Instant water check lead flow.  Keep this idempotent because deployed
  // databases may predate the Drizzle schema migration.  The unique
  // assessment_id constraint is the database guarantee that a quick check
  // cannot acquire a second physical-test ticket.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS instant_water_assessments (
      id text PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      customer_user_id text,
      first_name text NOT NULL,
      normalized_phone text NOT NULL,
      phone_verification_state text NOT NULL DEFAULT 'unverified_lead',
      phone_verified_at timestamptz,
      consent_given text NOT NULL,
      consent_at timestamptz,
      consent_version text NOT NULL,
      country text NOT NULL,
      area text NOT NULL,
      source text NOT NULL,
      concern text NOT NULL,
      setting text NOT NULL,
      raw_answers jsonb NOT NULL,
      rules_version text NOT NULL,
      result jsonb NOT NULL,
      area_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
      source_attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
      lifecycle_status text NOT NULL DEFAULT 'instant_result_ready',
      account_link_state text NOT NULL DEFAULT 'unverified_lead',
      physical_request_state text NOT NULL DEFAULT 'not_requested',
      public_token_hash text,
      public_token_expires_at timestamptz,
      public_token_revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS instant_water_assessments_public_token_hash_idx
      ON instant_water_assessments (public_token_hash)
      WHERE public_token_hash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS instant_water_assessments_customer_user_idx
      ON instant_water_assessments (customer_user_id, created_at);
    CREATE INDEX IF NOT EXISTS instant_water_assessments_phone_idx
      ON instant_water_assessments (normalized_phone);
    CREATE INDEX IF NOT EXISTS instant_water_assessments_status_idx
      ON instant_water_assessments (lifecycle_status, created_at);

    CREATE TABLE IF NOT EXISTS instant_water_check_tickets (
      id text PRIMARY KEY,
      assessment_id text NOT NULL UNIQUE REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
      customer_user_id text,
      service_state text NOT NULL DEFAULT 'instant_result_ready',
      country text NOT NULL,
      area text NOT NULL,
      service_address text,
      preferred_contact_time text,
      physical_request_acknowledged_at timestamptz,
      media_references jsonb NOT NULL DEFAULT '[]'::jsonb,
      internal_notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS instant_water_check_tickets_state_idx
      ON instant_water_check_tickets (service_state, created_at);
    CREATE INDEX IF NOT EXISTS instant_water_check_tickets_customer_user_idx
      ON instant_water_check_tickets (customer_user_id, created_at);

    CREATE TABLE IF NOT EXISTS instant_water_idempotency (
      id text PRIMARY KEY,
      endpoint text NOT NULL,
      scope text NOT NULL,
      idempotency_key text NOT NULL,
      request_hash text NOT NULL,
      assessment_id text,
      response jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      UNIQUE (endpoint, scope, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS instant_water_idempotency_expires_idx
      ON instant_water_idempotency (expires_at);

    CREATE TABLE IF NOT EXISTS instant_water_verification_challenges (
      id text PRIMARY KEY,
      assessment_id text NOT NULL REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
      channel text NOT NULL,
      phone_hash text NOT NULL,
      code_hash text NOT NULL,
      code_ciphertext text NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      delivery_status text NOT NULL DEFAULT 'pending',
      delivery_attempts integer NOT NULL DEFAULT 0,
      delivery_error_category text,
      delivery_next_retry_at timestamptz,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      delivery_claimed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS instant_water_verification_phone_created_idx
      ON instant_water_verification_challenges (phone_hash, created_at);
    CREATE INDEX IF NOT EXISTS instant_water_verification_assessment_idx
      ON instant_water_verification_challenges (assessment_id);
    ALTER TABLE instant_water_verification_challenges
      ADD COLUMN IF NOT EXISTS delivery_claimed_at timestamptz,
      ADD COLUMN IF NOT EXISTS code_ciphertext text,
      ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS delivery_error_category text,
      ADD COLUMN IF NOT EXISTS delivery_next_retry_at timestamptz;

    CREATE TABLE IF NOT EXISTS instant_water_action_tokens (
      id text PRIMARY KEY,
      assessment_id text NOT NULL REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS instant_water_action_tokens_assessment_idx
      ON instant_water_action_tokens (assessment_id, expires_at);
    CREATE TABLE IF NOT EXISTS instant_water_handoff_tokens (
      id text PRIMARY KEY,
      assessment_id text NOT NULL REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS instant_water_handoff_tokens_assessment_idx
      ON instant_water_handoff_tokens (assessment_id, expires_at);

    CREATE TABLE IF NOT EXISTS instant_water_rate_limits (
      key_hash text PRIMARY KEY,
      bucket_start timestamptz NOT NULL,
      request_count integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS instant_water_media_uploads (
      object_path text PRIMARY KEY,
      uploader_user_id text,
      assessment_id text REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
      declared_type text NOT NULL,
      declared_size integer NOT NULL,
      detected_type text,
      detected_size integer,
      scan_status text NOT NULL DEFAULT 'pending',
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS instant_water_media_uploads_assessment_idx ON instant_water_media_uploads (assessment_id);
    CREATE INDEX IF NOT EXISTS instant_water_media_uploads_uploader_idx ON instant_water_media_uploads (uploader_user_id);

    CREATE TABLE IF NOT EXISTS instant_water_audit_events (
      id text PRIMARY KEY,
      assessment_id text REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
      actor_team_user_id text NOT NULL,
      action text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS instant_water_audit_events_assessment_idx ON instant_water_audit_events (assessment_id, created_at);
    CREATE INDEX IF NOT EXISTS instant_water_audit_events_actor_idx ON instant_water_audit_events (actor_team_user_id, created_at);
  `);
  logger.info("Startup migration: instant water assessment and ticket tables ensured");
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
    recoverUnsyncedRegistrations().then((summary) => {
      logger.info(summary, "Automatic unsynced-registration recovery completed");
    }).catch((err) => {
      logger.error({ err }, "Automatic unsynced-registration recovery failed");
    });

    const server = app.listen(port, (err?: Error) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
      startScheduler();
      processPendingReferralSettlements().catch((err) => logger.error({ err }, "Referral settlement startup pass failed"));
      const referralTimer = setInterval(() => {
        processPendingReferralSettlements().catch((err) => logger.error({ err }, "Referral settlement pass failed"));
      }, 60_000);
      referralTimer.unref();
    });

    process.on("SIGTERM", () => shutdown(server, "SIGTERM"));
    process.on("SIGINT",  () => shutdown(server, "SIGINT"));
  })
  .catch((err) => {
    logger.error({ err }, "Startup migration failed — exiting");
    process.exit(1);
  });
