ALTER TABLE team_settings
  ADD COLUMN IF NOT EXISTS referral_failure_alert_threshold integer;

CREATE TABLE IF NOT EXISTS referral_alert_threshold_changes (
  id bigserial PRIMARY KEY,
  actor_team_user_id text NOT NULL REFERENCES team_users(id),
  actor_name text NOT NULL,
  actor_email text NOT NULL,
  previous_value integer NOT NULL,
  new_value integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_alert_threshold_changes_latest_idx
  ON referral_alert_threshold_changes (changed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS uc_referral_settlements (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL UNIQUE,
  referral_code text NOT NULL,
  user_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 1,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token text,
  claim_expires_at timestamptz,
  alert_claimed_at timestamptz,
  alerted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uc_referral_settlements_due_idx
  ON uc_referral_settlements (status, next_attempt_at);

ALTER TABLE uc_referral_settlements
  ADD COLUMN IF NOT EXISTS claim_token text,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS alert_claimed_at timestamptz;