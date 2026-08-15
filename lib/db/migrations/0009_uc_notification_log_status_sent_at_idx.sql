-- Migration: composite index on uc_notification_log (status, sent_at)
-- Applied automatically via the startup migration in artifacts/api-server/src/index.ts.
-- Safe to run multiple times (IF NOT EXISTS guard).
--
-- Purpose: the nightly 03:00 UTC pruning job deletes with
--   WHERE status = 'sent'   AND sent_at < cutoff
--   WHERE status = 'failed' AND sent_at < cutoff
-- and the admin log listing filters by status ordered by sent_at DESC.
-- Without this composite index those queries scan the whole table as rows
-- accumulate. Index-only DDL: no data is modified.

CREATE INDEX IF NOT EXISTS uc_notification_log_status_sent_at_idx
  ON uc_notification_log (status, sent_at);
