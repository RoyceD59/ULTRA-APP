ALTER TABLE uc_referral_codes
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_referrals integer,
  ADD COLUMN IF NOT EXISTS first_order_discount_percent integer NOT NULL DEFAULT 10;