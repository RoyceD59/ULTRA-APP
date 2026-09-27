-- Add adjusted_replace_offsets to uc_filter_reminders.
-- Stores the day-offsets (from activated_at) for replace30/replace15 as
-- computed by the app at check-in time, so the server dispatcher fires on
-- exactly the same dates as the rescheduled phone notifications.
ALTER TABLE uc_filter_reminders
  ADD COLUMN IF NOT EXISTS adjusted_replace_offsets jsonb;
