ALTER TABLE uc_locations
  ADD COLUMN IF NOT EXISTS country_iso text NOT NULL DEFAULT 'KE',
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS access_notes text,
  ADD COLUMN IF NOT EXISTS municipal text,
  ADD COLUMN IF NOT EXISTS source_attribution text;
ALTER TABLE uc_locations
  ADD CONSTRAINT uc_locations_country_iso_check CHECK (country_iso ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT uc_locations_metadata_lengths_check CHECK (
    char_length(country_iso) = 2 AND
    (city IS NULL OR char_length(city) <= 120) AND
    (access_notes IS NULL OR char_length(access_notes) <= 1000) AND
    (municipal IS NULL OR char_length(municipal) <= 200) AND
    (source_attribution IS NULL OR char_length(source_attribution) <= 500)
  );
ALTER TABLE uc_location_ratings
  ADD CONSTRAINT uc_location_ratings_location_fk FOREIGN KEY (location_id) REFERENCES uc_locations(id) ON DELETE CASCADE,
  ADD CONSTRAINT uc_location_ratings_user_fk FOREIGN KEY (user_id) REFERENCES uc_users(id) ON DELETE CASCADE;
ALTER TABLE uc_location_rating_reports
  ADD CONSTRAINT uc_location_rating_reports_rating_fk FOREIGN KEY (rating_id) REFERENCES uc_location_ratings(id) ON DELETE CASCADE,
  ADD CONSTRAINT uc_location_rating_reports_user_fk FOREIGN KEY (reporter_user_id) REFERENCES uc_users(id) ON DELETE CASCADE;
ALTER TABLE uc_location_assessments
  ADD CONSTRAINT uc_location_assessments_location_fk FOREIGN KEY (location_id) REFERENCES uc_locations(id) ON DELETE CASCADE;