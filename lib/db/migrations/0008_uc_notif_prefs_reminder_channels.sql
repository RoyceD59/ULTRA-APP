-- Migration: add filter-reminder opt-in channel columns to uc_notif_prefs
-- Applied automatically via `drizzle-kit push` in the post-merge setup script.
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
--
-- Purpose: three boolean flags that let customers opt in to receiving the
-- 5-stage filter lifecycle reminders through email, SMS, or WhatsApp in
-- addition to the existing in-app push notifications.  All default false
-- (opt-in, not opt-out).

ALTER TABLE uc_notif_prefs
  ADD COLUMN IF NOT EXISTS reminder_email    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_sms      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_whatsapp boolean NOT NULL DEFAULT false;
