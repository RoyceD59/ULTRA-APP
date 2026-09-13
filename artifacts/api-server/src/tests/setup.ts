/**
 * Test-harness startup migrations.
 *
 * This module is imported before any test file via `--import` in the test
 * command. It applies the same idempotent DDL that applyStartupMigrations()
 * runs in the production entrypoint (index.ts), so the test database is
 * always in sync with the current Drizzle schema.
 *
 * Keep this in lock-step with applyStartupMigrations() in src/index.ts:
 * any new CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS block added
 * there should also appear here so tests never fail on a missing relation.
 */

import { pool } from "@workspace/db";

// sheet_syncs error columns
await pool.query(`
  ALTER TABLE sheet_syncs
    ADD COLUMN IF NOT EXISTS last_error      text,
    ADD COLUMN IF NOT EXISTS last_error_at   timestamptz;
`);

// google_oauth_credentials
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

// uc_orders.webhook_recovery
await pool.query(`
  ALTER TABLE uc_orders
    ADD COLUMN IF NOT EXISTS webhook_recovery boolean NOT NULL DEFAULT false;
`);

// uc_orders.wc_order_id — WooCommerce order ID persisted at confirmation time
// so retries return a consistent external ID even when WC is temporarily down.
await pool.query(`
  ALTER TABLE uc_orders
    ADD COLUMN IF NOT EXISTS wc_order_id integer;
`);

// team_settings
await pool.query(`
  CREATE TABLE IF NOT EXISTS team_settings (
    id            text PRIMARY KEY DEFAULT 'singleton',
    passcode_hash text,
    updated_at    timestamptz NOT NULL DEFAULT now()
  );
`);
await pool.query(`
  ALTER TABLE team_settings
    ADD COLUMN IF NOT EXISTS mpesa_webhook_secret_enc text;
`);
await pool.query(`
  ALTER TABLE team_settings
    ADD COLUMN IF NOT EXISTS team_alert_phone text;
`);
await pool.query(`
  ALTER TABLE team_settings
    ADD COLUMN IF NOT EXISTS notification_log_success_retention_days integer,
    ADD COLUMN IF NOT EXISTS notification_log_failure_retention_days integer;
`);
await pool.query(`
  ALTER TABLE team_settings
    ADD COLUMN IF NOT EXISTS n8n_inventory_webhook_url_enc text;
`);
await pool.query(`
  ALTER TABLE team_settings
    ADD COLUMN IF NOT EXISTS team_alert_email text;
`);
await pool.query(`
  ALTER TABLE team_settings
    ADD COLUMN IF NOT EXISTS restock_demand_threshold integer;
`);
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

// uc_orders payment_reference unique index (dedup guard)
await pool.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'uc_orders_payment_reference_unique'
    ) THEN
      DELETE FROM uc_orders
      WHERE id NOT IN (
        SELECT MIN(id) FROM uc_orders WHERE payment_reference != '' GROUP BY payment_reference
      ) AND payment_reference != '';
      CREATE UNIQUE INDEX uc_orders_payment_reference_unique
        ON uc_orders (payment_reference) WHERE payment_reference != '';
    END IF;
  END
  $$;
`);

// team_users
await pool.query(`
  CREATE TABLE IF NOT EXISTS team_users (
    id            text PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    name          text NOT NULL,
    password_hash text NOT NULL,
    role          text NOT NULL DEFAULT 'member',
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
  );
`);
await pool.query(`ALTER TABLE team_users ADD COLUMN IF NOT EXISTS permissions jsonb;`);
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
await pool.query(`
  CREATE TABLE IF NOT EXISTS uc_referral_settlements (
    id              bigserial PRIMARY KEY,
    order_id        bigint NOT NULL UNIQUE,
    referral_code   text NOT NULL,
    user_email      text NOT NULL,
    status          text NOT NULL DEFAULT 'pending',
    attempts        integer NOT NULL DEFAULT 1,
    last_error      text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    claim_token     text,
    claim_expires_at timestamptz,
    alert_claimed_at timestamptz,
    alerted_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
  );
`);
await pool.query(`
  ALTER TABLE uc_referral_settlements
    ADD COLUMN IF NOT EXISTS claim_token text,
    ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS alert_claimed_at timestamptz;
`);
await pool.query(`
  CREATE INDEX IF NOT EXISTS uc_referral_settlements_due_idx
    ON uc_referral_settlements (status, next_attempt_at);
`);

// team_invitations
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
await pool.query(`ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS permissions jsonb;`);

// password_reset_tokens
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

// uc_notification_log
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
  );
`);
await pool.query(`ALTER TABLE uc_notification_log ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT ''`);
// The single-column status index was dropped (composite covers status-only queries via leading column).
await pool.query(`DROP INDEX IF EXISTS uc_notification_log_status_idx`);
await pool.query(`CREATE INDEX IF NOT EXISTS uc_notification_log_sent_at_idx ON uc_notification_log (sent_at)`);
await pool.query(`CREATE INDEX IF NOT EXISTS uc_notification_log_provider_idx ON uc_notification_log (provider)`);
await pool.query(`CREATE INDEX IF NOT EXISTS uc_notification_log_status_sent_at_idx ON uc_notification_log (status, sent_at)`);

// uc_return_requests
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
  );
`);
await pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS uc_return_requests_order_user_idx
    ON uc_return_requests (order_id, user_id);
`);

// uc_users.deleted_at
await pool.query(`ALTER TABLE uc_users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;`);
await pool.query(`
  CREATE INDEX IF NOT EXISTS uc_users_active_count_covering_idx
    ON uc_users (deleted_at)
    INCLUDE (created_at)
    WHERE deleted_at IS NULL;
`);
// Password resets bump this version so JWTs minted before a reset are revoked.
await pool.query(`
  ALTER TABLE uc_users
    ADD COLUMN IF NOT EXISTS credential_version integer NOT NULL DEFAULT 0;
`);

// team_library_docs
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
  );
`);

// team_library_pending_uploads
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
  );
`);

// uc_ai_feedback improvement note
await pool.query(`ALTER TABLE uc_ai_feedback ADD COLUMN IF NOT EXISTS improvement_note    text;`);
await pool.query(`ALTER TABLE uc_ai_feedback ADD COLUMN IF NOT EXISTS improvement_note_at timestamptz;`);

// uc_lifespan_alerts
await pool.query(`
  CREATE TABLE IF NOT EXISTS uc_lifespan_alerts (
    product_id integer     PRIMARY KEY,
    name       text        NOT NULL DEFAULT '',
    sku        text        NOT NULL DEFAULT '',
    alerted_at timestamptz NOT NULL DEFAULT now()
  );
`);
await pool.query(`
  ALTER TABLE uc_lifespan_alerts
    ADD COLUMN IF NOT EXISTS alert_count integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
`);

// mpesa_stk_initiations.callback_token
await pool.query(`
  ALTER TABLE mpesa_stk_initiations
    ADD COLUMN IF NOT EXISTS callback_token text;
`);

// uc_filter_reminders
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

// uc_notif_prefs reminder channel columns
await pool.query(`
  ALTER TABLE uc_notif_prefs
    ADD COLUMN IF NOT EXISTS reminder_email    boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reminder_sms      boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reminder_whatsapp boolean NOT NULL DEFAULT false;
`);

// uc_users Clerk social sign-in columns
await pool.query(`
  ALTER TABLE uc_users
    ADD COLUMN IF NOT EXISTS clerk_user_id text UNIQUE,
    ADD COLUMN IF NOT EXISTS auth_provider  text NOT NULL DEFAULT 'password';
`);

// ai_push_events: target_agent + task_title for task_dispatch rows
await pool.query(`
  ALTER TABLE ai_push_events
    ADD COLUMN IF NOT EXISTS target_agent text,
    ADD COLUMN IF NOT EXISTS task_title   text;
`);

console.log("[test-setup] all startup migrations applied");
