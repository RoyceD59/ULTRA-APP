ALTER TABLE uc_offline_clients
  ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS companion_user_id integer,
  ADD COLUMN IF NOT EXISTS account_setup_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_channel text,
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conflict_reason text,
  ADD COLUMN IF NOT EXISTS delivery_job_key text,
  ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_error text,
  ADD COLUMN IF NOT EXISTS delivery_claim_token text,
  ADD COLUMN IF NOT EXISTS delivery_claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS issued_credential_version integer;

CREATE INDEX IF NOT EXISTS uc_offline_clients_companion_user_idx
  ON uc_offline_clients (companion_user_id);
CREATE INDEX IF NOT EXISTS uc_offline_clients_idempotency_idx
  ON uc_offline_clients (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uc_offline_clients_idempotency_unique
  ON uc_offline_clients (idempotency_key) WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS uc_users_phone_lookup_idx
  ON uc_users (phone);