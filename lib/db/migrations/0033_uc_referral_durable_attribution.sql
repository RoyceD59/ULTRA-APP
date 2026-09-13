-- Durable referral programme.  Attribution is account-id based; conversion
-- and benefit history are append-only and refunds are compensating reversals.
CREATE TABLE IF NOT EXISTS uc_referral_attributions (
  id bigserial PRIMARY KEY,
  referrer_user_id integer NOT NULL REFERENCES uc_users(id),
  referred_user_id integer NOT NULL REFERENCES uc_users(id),
  referral_code varchar(40) NOT NULL,
  attributed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_user_id <> referred_user_id),
  UNIQUE (referred_user_id)
);
CREATE INDEX IF NOT EXISTS uc_referral_attributions_referrer_idx ON uc_referral_attributions(referrer_user_id);
CREATE TABLE IF NOT EXISTS uc_referral_conversions (
  id bigserial PRIMARY KEY,
  attribution_id bigint NOT NULL REFERENCES uc_referral_attributions(id),
  qualifying_order_id integer NOT NULL REFERENCES uc_orders(id),
  points_snapshot integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','reversed')),
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attribution_id), UNIQUE (qualifying_order_id)
);
CREATE TABLE IF NOT EXISTS uc_referral_benefits (
  id bigserial PRIMARY KEY,
  conversion_id bigint NOT NULL REFERENCES uc_referral_conversions(id),
  user_id integer NOT NULL REFERENCES uc_users(id),
  kind varchar(20) NOT NULL CHECK (kind IN ('points','discount')),
  points integer NOT NULL DEFAULT 0,
  discount_percent integer NOT NULL DEFAULT 0,
  recipient_role varchar(20) NOT NULL DEFAULT 'referred' CHECK (recipient_role IN ('referrer','referred')),
  status varchar(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available','used','reversed')),
  used_order_id integer REFERENCES uc_orders(id),
  used_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversion_id,user_id,kind)
);
CREATE INDEX IF NOT EXISTS uc_referral_benefits_user_status_idx ON uc_referral_benefits(user_id,status);
ALTER TABLE uc_referral_benefits ADD COLUMN IF NOT EXISTS recipient_role varchar(20) NOT NULL DEFAULT 'referred';
ALTER TABLE uc_referral_benefits ADD COLUMN IF NOT EXISTS used_at timestamptz;
ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS referral_benefit_id bigint REFERENCES uc_referral_benefits(id);
CREATE UNIQUE INDEX IF NOT EXISTS uc_orders_referral_benefit_unique ON uc_orders(referral_benefit_id) WHERE referral_benefit_id IS NOT NULL;
INSERT INTO uc_rewards_rules (event_type,label,points_value,active)
VALUES ('referral-successful-payment','Successful referral',200,true)
ON CONFLICT (event_type) DO NOTHING;