ALTER TABLE uc_users
  ADD COLUMN IF NOT EXISTS rewards_qr_hash text,
  ADD COLUMN IF NOT EXISTS rewards_qr_revoked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uc_users_rewards_qr_hash_idx
  ON uc_users (rewards_qr_hash) WHERE rewards_qr_hash IS NOT NULL;

ALTER TABLE uc_orders
  ADD COLUMN IF NOT EXISTS customer_stage text,
  ADD COLUMN IF NOT EXISTS customer_stage_updated_at timestamptz;
ALTER TABLE uc_water_tests
  ADD COLUMN IF NOT EXISTS customer_stage text,
  ADD COLUMN IF NOT EXISTS customer_stage_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS uc_registered_filters (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES uc_users(id),
  product_id integer NOT NULL,
  product_name text NOT NULL,
  rated_capacity_litres integer NOT NULL,
  activated_at timestamptz NOT NULL,
  source_order_id integer,
  source text NOT NULL DEFAULT 'legacy',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_registered_filters_source_order_product_idx
  ON uc_registered_filters (source, source_order_id, product_id)
  WHERE source_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS uc_registered_filters_user_active_idx
  ON uc_registered_filters (user_id, active);

CREATE TABLE IF NOT EXISTS uc_water_impact_ledger (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES uc_users(id),
  registered_filter_id integer NOT NULL REFERENCES uc_registered_filters(id),
  litres integer NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_water_impact_idempotency_idx
  ON uc_water_impact_ledger (user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS uc_water_impact_user_created_idx
  ON uc_water_impact_ledger (user_id, created_at);
CREATE INDEX IF NOT EXISTS uc_water_impact_filter_idx
  ON uc_water_impact_ledger (registered_filter_id, created_at);

CREATE TABLE IF NOT EXISTS uc_reward_conversion (
  id text PRIMARY KEY DEFAULT 'singleton',
  mode text NOT NULL DEFAULT 'kes',
  value numeric(12,2) NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO uc_reward_conversion (id) VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;