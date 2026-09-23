CREATE TABLE IF NOT EXISTS uc_low_stock_alerts (
  product_id integer     PRIMARY KEY,
  alerted_at timestamptz NOT NULL DEFAULT now()
);