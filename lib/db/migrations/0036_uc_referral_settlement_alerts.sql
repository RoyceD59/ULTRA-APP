ALTER TABLE uc_referral_settlements
  ADD COLUMN IF NOT EXISTS alert_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS alert_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alert_last_error text,
  ADD COLUMN IF NOT EXISTS alert_next_attempt_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE team_settings
  ADD COLUMN IF NOT EXISTS referral_failure_alert_threshold integer;

CREATE INDEX IF NOT EXISTS uc_referral_settlements_alert_due_idx
  ON uc_referral_settlements(attempts, alert_next_attempt_at)
  WHERE alerted_at IS NULL;