-- Tracks which store products the team has already been emailed about for a
-- missing filter_lifespan_days meta (daily lifespan-audit scheduler job).
CREATE TABLE IF NOT EXISTS uc_lifespan_alerts (
  product_id integer PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  sku text NOT NULL DEFAULT '',
  alerted_at timestamp with time zone NOT NULL DEFAULT now()
);
