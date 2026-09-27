CREATE TABLE IF NOT EXISTS agent_oauth_clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  secret_hash text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_by text NOT NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_oauth_clients_status_idx ON agent_oauth_clients(status);

CREATE TABLE IF NOT EXISTS agent_oauth_tokens (
  id bigserial PRIMARY KEY,
  client_id text NOT NULL REFERENCES agent_oauth_clients(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_oauth_tokens_client_idx ON agent_oauth_tokens(client_id);

CREATE TABLE IF NOT EXISTS agent_oauth_audit (
  id bigserial PRIMARY KEY,
  client_id text,
  actor_id text,
  action text NOT NULL,
  target text,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_oauth_audit_created_idx ON agent_oauth_audit(created_at);

CREATE TABLE IF NOT EXISTS agent_oauth_approvals (
  id text PRIMARY KEY,
  client_id text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  parameters_hash text NOT NULL,
  approved_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);