-- Add effective_lifespan_days to uc_filter_reminders.
-- Stores the performance-adjusted lifespan (water quality + clean history)
-- synced from the app after a check-in. NULL = no adjustment, use lifespan_days.
ALTER TABLE uc_filter_reminders
  ADD COLUMN IF NOT EXISTS effective_lifespan_days integer;
