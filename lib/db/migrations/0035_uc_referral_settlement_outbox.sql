CREATE TABLE IF NOT EXISTS uc_referral_settlements (
  order_id integer PRIMARY KEY REFERENCES uc_orders(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uc_referral_settlements_due_idx
  ON uc_referral_settlements(status,next_attempt_at);