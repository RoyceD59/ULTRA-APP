-- Explicit cash-on-delivery collection state. Kept independent of order status
-- so fulfilment and cash handling cannot accidentally be conflated.
ALTER TABLE uc_orders
  ADD COLUMN IF NOT EXISTS cod_collection_status text,
  ADD COLUMN IF NOT EXISTS cod_collected_by text,
  ADD COLUMN IF NOT EXISTS cod_collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS cod_wc_sync_status text,
  ADD COLUMN IF NOT EXISTS cod_wc_sync_error text,
  ADD COLUMN IF NOT EXISTS cod_wc_sync_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cod_wc_sync_attempt_count integer NOT NULL DEFAULT 0;

UPDATE uc_orders
SET cod_collection_status = 'awaiting_collection'
WHERE payment_method = 'cod' AND cod_collection_status IS NULL;

CREATE TABLE IF NOT EXISTS uc_cod_collection_events (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES uc_orders(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  actor text NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_cod_collection_events_order_unique UNIQUE (order_id),
  CONSTRAINT uc_cod_collection_events_order_idempotency_unique UNIQUE (order_id, idempotency_key)
);