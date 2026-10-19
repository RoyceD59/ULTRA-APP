ALTER TABLE uc_registered_filters ADD COLUMN IF NOT EXISTS offline_sale_id integer;
ALTER TABLE uc_registered_filters ADD COLUMN IF NOT EXISTS offline_unit_id text;
ALTER TABLE uc_registered_filters ADD COLUMN IF NOT EXISTS offline_lifespan_days integer;
CREATE UNIQUE INDEX IF NOT EXISTS uc_registered_filters_offline_unit_unique ON uc_registered_filters(offline_unit_id);