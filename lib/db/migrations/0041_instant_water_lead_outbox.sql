CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS instant_water_lead_outbox (
  id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES instant_water_assessments(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  submission_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','review')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token text,
  delivered_at timestamptz,
  provider_ack text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instant_water_lead_outbox_due_idx
  ON instant_water_lead_outbox(status, next_attempt_at);