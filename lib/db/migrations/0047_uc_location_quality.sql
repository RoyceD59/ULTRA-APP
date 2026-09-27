CREATE TABLE IF NOT EXISTS uc_location_ratings (
  id text PRIMARY KEY, location_id text NOT NULL, user_id integer NOT NULL,
  water_quality integer NOT NULL CHECK (water_quality BETWEEN 1 AND 5),
  cleanliness integer NOT NULL CHECK (cleanliness BETWEEN 1 AND 5),
  equipment_condition integer NOT NULL CHECK (equipment_condition BETWEEN 1 AND 5),
  service_reliability integer NOT NULL CHECK (service_reliability BETWEEN 1 AND 5),
  safety_confidence integer NOT NULL CHECK (safety_confidence BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden','removed')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_location_ratings_user_location_unique UNIQUE (user_id, location_id)
);
CREATE INDEX IF NOT EXISTS uc_location_ratings_location_status_idx ON uc_location_ratings(location_id,status);
CREATE TABLE IF NOT EXISTS uc_location_rating_reports (
  id text PRIMARY KEY, rating_id text NOT NULL, reporter_user_id integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('spam','unsafe','inaccurate','offensive','other')),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_location_rating_reports_once UNIQUE (rating_id, reporter_user_id)
);
CREATE TABLE IF NOT EXISTS uc_location_assessments (
  id text PRIMARY KEY, location_id text NOT NULL, assessor_id text NOT NULL,
  water_quality integer NOT NULL CHECK (water_quality BETWEEN 1 AND 5),
  cleanliness integer NOT NULL CHECK (cleanliness BETWEEN 1 AND 5),
  equipment_condition integer NOT NULL CHECK (equipment_condition BETWEEN 1 AND 5),
  service_reliability integer NOT NULL CHECK (service_reliability BETWEEN 1 AND 5),
  safety_confidence integer NOT NULL CHECK (safety_confidence BETWEEN 1 AND 5),
  checks text NOT NULL DEFAULT '{}', notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('draft','verified','superseded')),
  verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_location_assessments_location_unique UNIQUE (location_id)
);
ALTER TABLE uc_locations ADD CONSTRAINT uc_locations_type_check
  CHECK (type IN ('experience_centre','refill_atm','vendor','water_atm','refill_station','city_tap'));