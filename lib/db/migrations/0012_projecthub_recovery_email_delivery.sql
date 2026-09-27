-- Migration: retain Resend IDs and latest delivery events for recovery emails.
-- These columns deliberately store provider metadata only, never email bodies
-- or password-reset/invitation links.
-- Safe to run repeatedly on existing deployments.

ALTER TABLE uc_notification_log
  ADD COLUMN IF NOT EXISTS resend_message_id text,
  ADD COLUMN IF NOT EXISTS delivery_event text,
  ADD COLUMN IF NOT EXISTS delivery_event_at timestamptz;

CREATE INDEX IF NOT EXISTS uc_notification_log_recovery_delivery_idx
  ON uc_notification_log (provider, template, sent_at);