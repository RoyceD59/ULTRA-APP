CREATE TABLE IF NOT EXISTS uc_daily_hydration (
  user_id integer NOT NULL REFERENCES uc_users(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  litres double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date),
  CONSTRAINT uc_daily_hydration_litres_valid CHECK (litres >= 0 AND litres < 'Infinity'::double precision)
);