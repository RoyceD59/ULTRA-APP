-- Durable customer order-status projection, transition ledger, and push outbox.
-- This migration is intentionally self-contained: it works on both databases
-- which predate customer stages and clean databases created from the schema.

ALTER TABLE uc_orders
  ADD COLUMN IF NOT EXISTS customer_stage text,
  ADD COLUMN IF NOT EXISTS customer_stage_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS woo_status_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS woo_status_version text;

CREATE TABLE IF NOT EXISTS uc_customer_stage_events (
  id serial PRIMARY KEY,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  stage text NOT NULL,
  status text,
  source_modified_at timestamptz,
  source_version text,
  idempotency_key text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Older releases incorrectly made stage unique, preventing two Woo statuses
-- from mapping to one customer stage. Remove that legacy constraint/index.
ALTER TABLE uc_customer_stage_events
  DROP CONSTRAINT IF EXISTS uc_customer_stage_events_resource_type_resource_id_stage_key;
DROP INDEX IF EXISTS uc_customer_stage_events_resource_type_resource_id_stage_idx;

CREATE UNIQUE INDEX IF NOT EXISTS uc_customer_stage_events_resource_key_unique
  ON uc_customer_stage_events (resource_type, resource_id, idempotency_key);
CREATE INDEX IF NOT EXISTS uc_customer_stage_events_resource_created_idx
  ON uc_customer_stage_events (resource_type, resource_id, created_at);

ALTER TABLE uc_customer_stage_events
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS source_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_version text;

CREATE TABLE IF NOT EXISTS uc_order_notification_outbox (
  id serial PRIMARY KEY,
  event_key text NOT NULL,
  order_id integer NOT NULL REFERENCES uc_orders(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  stage text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  claim_token text,
  lease_expires_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE uc_order_notification_outbox
  ADD COLUMN IF NOT EXISTS claim_token text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uc_order_notification_outbox_event_key_unique
  ON uc_order_notification_outbox (event_key);
CREATE INDEX IF NOT EXISTS uc_order_notification_outbox_pending_idx
  ON uc_order_notification_outbox (status, next_attempt_at);