-- Durable storage for instant-water-check-v1.  The API startup migration
-- mirrors this DDL for deployments that do not run the migration runner.
CREATE TABLE IF NOT EXISTS instant_water_assessments (
  id text PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  customer_user_id text,
  first_name text NOT NULL,
  normalized_phone text NOT NULL,
  phone_verification_state text NOT NULL DEFAULT 'unverified_lead',
  phone_verified_at timestamptz,
  consent_given text NOT NULL,
  consent_at timestamptz,
  consent_version text NOT NULL,
  country text NOT NULL,
  area text NOT NULL,
  source text NOT NULL,
  concern text NOT NULL,
  setting text NOT NULL,
  raw_answers jsonb NOT NULL,
  rules_version text NOT NULL,
  result jsonb NOT NULL,
  area_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  lifecycle_status text NOT NULL DEFAULT 'instant_result_ready',
  account_link_state text NOT NULL DEFAULT 'unverified_lead',
  physical_request_state text NOT NULL DEFAULT 'not_requested',
  public_token_hash text,
  public_token_expires_at timestamptz,
  public_token_revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS instant_water_assessments_public_token_hash_idx
  ON instant_water_assessments (public_token_hash)
  WHERE public_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS instant_water_assessments_customer_user_idx
  ON instant_water_assessments (customer_user_id, created_at);
CREATE INDEX IF NOT EXISTS instant_water_assessments_phone_idx
  ON instant_water_assessments (normalized_phone);
CREATE INDEX IF NOT EXISTS instant_water_assessments_status_idx
  ON instant_water_assessments (lifecycle_status, created_at);

CREATE TABLE IF NOT EXISTS instant_water_check_tickets (
  id text PRIMARY KEY,
  assessment_id text NOT NULL UNIQUE
    REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
  customer_user_id text,
  service_state text NOT NULL DEFAULT 'instant_result_ready',
  country text NOT NULL,
  area text NOT NULL,
  service_address text,
  preferred_contact_time text,
  physical_request_acknowledged_at timestamptz,
  media_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instant_water_check_tickets_state_idx
  ON instant_water_check_tickets (service_state, created_at);
CREATE INDEX IF NOT EXISTS instant_water_check_tickets_customer_user_idx
  ON instant_water_check_tickets (customer_user_id, created_at);

CREATE TABLE IF NOT EXISTS instant_water_idempotency (
  id text PRIMARY KEY,
  endpoint text NOT NULL,
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  assessment_id text,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (endpoint, scope, idempotency_key)
);
CREATE INDEX IF NOT EXISTS instant_water_idempotency_expires_idx
  ON instant_water_idempotency (expires_at);

CREATE TABLE IF NOT EXISTS instant_water_verification_challenges (
  id text PRIMARY KEY,
  assessment_id text NOT NULL
    REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
  channel text NOT NULL,
  phone_hash text NOT NULL,
  code_hash text NOT NULL,
  code_ciphertext text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  delivery_status text NOT NULL DEFAULT 'pending',
  delivery_attempts integer NOT NULL DEFAULT 0,
  delivery_error_category text,
  delivery_next_retry_at timestamptz,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  delivery_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instant_water_verification_phone_created_idx
  ON instant_water_verification_challenges (phone_hash, created_at);
CREATE INDEX IF NOT EXISTS instant_water_verification_assessment_idx
  ON instant_water_verification_challenges (assessment_id);
ALTER TABLE instant_water_verification_challenges
  ADD COLUMN IF NOT EXISTS code_ciphertext text,
  ADD COLUMN IF NOT EXISTS delivery_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_error_category text,
  ADD COLUMN IF NOT EXISTS delivery_next_retry_at timestamptz;

CREATE TABLE IF NOT EXISTS instant_water_action_tokens (
  id text PRIMARY KEY,
  assessment_id text NOT NULL
    REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instant_water_action_tokens_assessment_idx
  ON instant_water_action_tokens (assessment_id, expires_at);

CREATE TABLE IF NOT EXISTS instant_water_handoff_tokens (
  id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instant_water_handoff_tokens_assessment_idx
  ON instant_water_handoff_tokens (assessment_id, expires_at);
CREATE TABLE IF NOT EXISTS instant_water_rate_limits (
  key_hash text PRIMARY KEY,
  bucket_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instant_water_media_uploads (
  object_path text PRIMARY KEY,
  uploader_user_id text,
  assessment_id text REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
  declared_type text NOT NULL,
  declared_size integer NOT NULL,
  detected_type text,
  detected_size integer,
  scan_status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instant_water_media_uploads_assessment_idx ON instant_water_media_uploads (assessment_id);
CREATE INDEX IF NOT EXISTS instant_water_media_uploads_uploader_idx ON instant_water_media_uploads (uploader_user_id);

CREATE TABLE IF NOT EXISTS instant_water_audit_events (
  id text PRIMARY KEY,
  assessment_id text REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
  actor_team_user_id text NOT NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instant_water_audit_events_assessment_idx ON instant_water_audit_events (assessment_id, created_at);
CREATE INDEX IF NOT EXISTS instant_water_audit_events_actor_idx ON instant_water_audit_events (actor_team_user_id, created_at);
