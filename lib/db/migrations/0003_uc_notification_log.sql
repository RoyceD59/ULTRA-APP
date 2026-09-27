-- Migration: create uc_notification_log table
-- Applied automatically via the startup migration in artifacts/api-server/src/index.ts.
-- Safe to run multiple times (IF NOT EXISTS guards on every statement).
--
-- Purpose: audit log for every SMS and email send attempt made by the UC Companion
-- backend (sms.ts / email.ts / resend.ts helpers). Written non-blocking; a write
-- failure here never propagates to the parent request.

CREATE TABLE IF NOT EXISTS uc_notification_log (
  id             serial       PRIMARY KEY,
  channel        text         NOT NULL,                      -- 'sms' | 'email'
  provider       text         NOT NULL DEFAULT '',           -- 'africas_talking' | 'resend' | 'sendgrid' | 'smtp' | 'none'
  recipient      text         NOT NULL,                      -- phone or email address
  template       text         NOT NULL DEFAULT '',
  message_body   text         NOT NULL DEFAULT '',           -- SMS text or email plain-text body
  order_id       integer,                                    -- optional FK-ish reference
  ticket_id      text,
  test_id        text,
  status         text         NOT NULL,                      -- 'sent' | 'failed'
  error_message  text,
  sent_at        timestamptz  NOT NULL DEFAULT now()
);

-- Add provider column to tables that predate this migration.
ALTER TABLE uc_notification_log ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS uc_notification_log_status_idx
  ON uc_notification_log (status);

CREATE INDEX IF NOT EXISTS uc_notification_log_sent_at_idx
  ON uc_notification_log (sent_at);

CREATE INDEX IF NOT EXISTS uc_notification_log_provider_idx
  ON uc_notification_log (provider);
