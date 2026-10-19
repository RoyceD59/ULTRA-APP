CREATE TABLE IF NOT EXISTS uc_guest_pay_links (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES uc_orders(id) ON DELETE CASCADE,
  generation text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '72 hours'),
  revoked_at timestamptz,
  opened_at timestamptz,
  paid_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_guest_pay_links_token_hash_unique ON uc_guest_pay_links(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uc_guest_pay_active_order ON uc_guest_pay_links(order_id) WHERE revoked_at IS NULL;
