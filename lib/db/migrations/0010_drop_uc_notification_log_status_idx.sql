-- Migration: drop redundant single-column status index on uc_notification_log
-- The composite index uc_notification_log_status_sent_at_idx (status, sent_at)
-- covers all queries that filter on status alone via its leading column, making
-- uc_notification_log_status_idx redundant. Removing it reduces write overhead
-- on every SMS/email log insert.
-- Safe to run multiple times (IF EXISTS guard).

DROP INDEX IF EXISTS uc_notification_log_status_idx;
