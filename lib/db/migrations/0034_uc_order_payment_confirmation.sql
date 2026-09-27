ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz;
CREATE INDEX IF NOT EXISTS uc_orders_paid_confirmation_idx
  ON uc_orders(user_id,payment_confirmed_at,id);