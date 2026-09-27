ALTER TABLE uc_locations
  ADD COLUMN IF NOT EXISTS last_field_verified_on date,
  ADD COLUMN IF NOT EXISTS next_review_on date;

ALTER TABLE uc_locations
  DROP CONSTRAINT IF EXISTS uc_locations_review_order_check;

ALTER TABLE uc_locations
  ADD CONSTRAINT uc_locations_review_order_check CHECK (
    next_review_on IS NULL
    OR last_field_verified_on IS NULL
    OR next_review_on >= last_field_verified_on
  );