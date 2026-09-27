ALTER TABLE uc_users
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;

ALTER TABLE uc_users ALTER COLUMN email_verified SET DEFAULT false;
ALTER TABLE uc_users ALTER COLUMN phone_verified SET DEFAULT false;

-- Only social accounts have durable provider provenance proving that Clerk
-- supplied a verified primary email. Local registration alone is not proof.
UPDATE uc_users SET email_verified = (auth_provider = 'social');
UPDATE uc_users SET phone_verified = false;

CREATE TABLE IF NOT EXISTS uc_password_reset_audit (
  id text PRIMARY KEY,
  actor_type text NOT NULL,
  actor_id text,
  target_user_id text,
  channel text,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uc_contact_verification_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  contact_hash text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uc_contact_verification_user_channel_idx
  ON uc_contact_verification_tokens (user_id, channel, created_at DESC);