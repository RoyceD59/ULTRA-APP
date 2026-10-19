CREATE TABLE IF NOT EXISTS uc_location_review_alerts (
  location_id text PRIMARY KEY REFERENCES uc_locations(id) ON DELETE CASCADE,
  review_key text NOT NULL,
  notified_at timestamptz
);