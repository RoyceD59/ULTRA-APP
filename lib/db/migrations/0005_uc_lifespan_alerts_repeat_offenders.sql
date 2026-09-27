-- Repeat-offender tracking for the daily lifespan-audit alert email.
-- Rows are now kept (resolved_at set) instead of deleted when a product's
-- filter_lifespan_days meta is fixed, so a later regression re-alerts with
-- the prior alert count ("regressed — alerted N times before").
ALTER TABLE uc_lifespan_alerts
  ADD COLUMN IF NOT EXISTS alert_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS resolved_at timestamp with time zone;
