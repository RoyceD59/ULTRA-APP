CREATE TABLE IF NOT EXISTS uc_global_impact (
  id text PRIMARY KEY CHECK (id = 'global'),
  litres_offset double precision NOT NULL,
  users_offset double precision NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  last_updated_by text NOT NULL,
  last_updated_at timestamptz,
  legacy_sha256 text
);
CREATE TABLE IF NOT EXISTS uc_global_impact_audit (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  actor text NOT NULL,
  previous jsonb,
  next jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
