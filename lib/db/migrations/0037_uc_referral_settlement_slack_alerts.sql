ALTER TABLE uc_referral_settlements
  ADD COLUMN IF NOT EXISTS slack_alert_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS slack_alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS slack_alert_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slack_alert_last_error text,
  ADD COLUMN IF NOT EXISTS slack_alert_next_attempt_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS uc_referral_settlements_slack_alert_due_idx
  ON uc_referral_settlements(attempts, slack_alert_next_attempt_at)
  WHERE slack_alerted_at IS NULL;