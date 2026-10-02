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
import { readFile } from "node:fs/promises";
import { ensureReviewAnalysisSchema } from "../lib/review-analysis-schema.js";

await ensureReviewAnalysisSchema();

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
await pool.query(`
  ALTER TABLE uc_orders
    ADD COLUMN IF NOT EXISTS customer_stage text,
    ADD COLUMN IF NOT EXISTS customer_stage_updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS woo_status_modified_at timestamptz,
    ADD COLUMN IF NOT EXISTS woo_status_version text;
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
await pool.query(`
  ALTER TABLE uc_offline_clients
    ADD COLUMN IF NOT EXISTS phone text,
    ADD COLUMN IF NOT EXISTS email text,
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

// uc_low_stock_alerts
await pool.query(`
  CREATE TABLE IF NOT EXISTS uc_low_stock_alerts (
    product_id integer     PRIMARY KEY,
    alerted_at timestamptz NOT NULL DEFAULT now()
  );
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

await pool.query(`
  CREATE TABLE IF NOT EXISTS instant_water_assessments (
    id text PRIMARY KEY, reference text NOT NULL UNIQUE, customer_user_id text,
    first_name text NOT NULL, normalized_phone text NOT NULL,
    phone_verification_state text NOT NULL DEFAULT 'unverified_lead',
    phone_verified_at timestamptz, consent_given text NOT NULL,
    consent_at timestamptz, consent_version text NOT NULL, country text NOT NULL,
    area text NOT NULL, source text NOT NULL, concern text NOT NULL,
    setting text NOT NULL, raw_answers jsonb NOT NULL, rules_version text NOT NULL,
    result jsonb NOT NULL, area_flags jsonb NOT NULL DEFAULT '{}',
    source_attribution jsonb NOT NULL DEFAULT '{}',
    lifecycle_status text NOT NULL DEFAULT 'instant_result_ready',
    account_link_state text NOT NULL DEFAULT 'unverified_lead',
    physical_request_state text NOT NULL DEFAULT 'not_requested',
    public_token_hash text, public_token_expires_at timestamptz,
    public_token_revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS instant_water_check_tickets (
    id text PRIMARY KEY, assessment_id text NOT NULL UNIQUE REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
    customer_user_id text, service_state text NOT NULL DEFAULT 'instant_result_ready',
    country text NOT NULL, area text NOT NULL, service_address text,
    preferred_contact_time text, physical_request_acknowledged_at timestamptz,
    media_references jsonb NOT NULL DEFAULT '[]', internal_notes text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS instant_water_idempotency (
    id text PRIMARY KEY, endpoint text NOT NULL, scope text NOT NULL,
    idempotency_key text NOT NULL, request_hash text NOT NULL, assessment_id text,
    response jsonb, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
    UNIQUE (endpoint, scope, idempotency_key)
  );
  CREATE TABLE IF NOT EXISTS instant_water_verification_challenges (
    id text PRIMARY KEY, assessment_id text NOT NULL REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
    channel text NOT NULL, phone_hash text NOT NULL, code_hash text NOT NULL,
    code_ciphertext text NOT NULL,
    attempts integer NOT NULL DEFAULT 0, delivery_status text NOT NULL DEFAULT 'pending',
    delivery_attempts integer NOT NULL DEFAULT 0, delivery_error_category text,
    delivery_next_retry_at timestamptz, expires_at timestamptz NOT NULL, used_at timestamptz,
    delivery_claimed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS instant_water_action_tokens (
    id text PRIMARY KEY, assessment_id text NOT NULL REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
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
  ALTER TABLE instant_water_verification_challenges
    ADD COLUMN IF NOT EXISTS code_ciphertext text,
    ADD COLUMN IF NOT EXISTS delivery_claimed_at timestamptz,
    ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delivery_error_category text,
    ADD COLUMN IF NOT EXISTS delivery_next_retry_at timestamptz;
  CREATE TABLE IF NOT EXISTS instant_water_rate_limits (
    key_hash text PRIMARY KEY, bucket_start timestamptz NOT NULL,
    request_count integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS instant_water_media_uploads (
    object_path text PRIMARY KEY, uploader_user_id text,
    assessment_id text REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
    declared_type text NOT NULL, declared_size integer NOT NULL, detected_type text,
    detected_size integer, scan_status text NOT NULL DEFAULT 'pending',
    expires_at timestamptz NOT NULL, consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS instant_water_audit_events (
    id text PRIMARY KEY, assessment_id text REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
    actor_team_user_id text NOT NULL, action text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
  );
`);

// Durable customer order-status transition ledger and notification outbox.
await pool.query(`
  CREATE TABLE IF NOT EXISTS uc_customer_stage_events (
    id serial PRIMARY KEY,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    stage text NOT NULL,
    status text,
    source_modified_at timestamptz,
    source_version text,
    idempotency_key text NOT NULL,
    actor text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE uc_customer_stage_events
    ADD COLUMN IF NOT EXISTS status text,
    ADD COLUMN IF NOT EXISTS source_modified_at timestamptz,
    ADD COLUMN IF NOT EXISTS source_version text;
  ALTER TABLE uc_customer_stage_events
    DROP CONSTRAINT IF EXISTS uc_customer_stage_events_resource_type_resource_id_stage_key;
  DROP INDEX IF EXISTS uc_customer_stage_events_resource_type_resource_id_stage_idx;
  CREATE UNIQUE INDEX IF NOT EXISTS uc_customer_stage_events_resource_key_unique
    ON uc_customer_stage_events (resource_type, resource_id, idempotency_key);
  CREATE INDEX IF NOT EXISTS uc_customer_stage_events_resource_created_idx
    ON uc_customer_stage_events (resource_type, resource_id, created_at);
  CREATE TABLE IF NOT EXISTS uc_order_notification_outbox (
    id serial PRIMARY KEY,
    event_key text NOT NULL,
    order_id integer NOT NULL REFERENCES uc_orders(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    stage text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    attempt_count integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz,
    claim_token text,
    lease_expires_at timestamptz,
    last_error text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE uc_order_notification_outbox
    ADD COLUMN IF NOT EXISTS claim_token text,
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
  CREATE UNIQUE INDEX IF NOT EXISTS uc_order_notification_outbox_event_key_unique
    ON uc_order_notification_outbox (event_key);
  CREATE INDEX IF NOT EXISTS uc_order_notification_outbox_pending_idx
    ON uc_order_notification_outbox (status, next_attempt_at);
`);

await pool.query(`
  ALTER TABLE team_settings
    ADD COLUMN IF NOT EXISTS care_overview_preview boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS refill_governance_preview boolean NOT NULL DEFAULT false;
`);
for (const migrationPath of [
  "../../../../lib/db/migrations/0054_uc_refill_governance.sql",
  "../../../../lib/db/migrations/0055_refill_preview_flags.sql",
]) {
  const migration = await readFile(new URL(migrationPath, import.meta.url), "utf8");
  await pool.query(migration);
}

console.log("[test-setup] all startup migrations applied");
