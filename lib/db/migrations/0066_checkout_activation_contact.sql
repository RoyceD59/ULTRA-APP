ALTER TABLE uc_registered_filters ADD COLUMN IF NOT EXISTS source_unit_id text;
DROP INDEX IF EXISTS uc_registered_filters_source_order_product_idx;
CREATE UNIQUE INDEX IF NOT EXISTS uc_registered_filters_source_order_product_idx
  ON uc_registered_filters(source,source_order_id,product_id) WHERE source_unit_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uc_registered_filters_source_unit_unique ON uc_registered_filters(source_unit_id);
ALTER TABLE uc_tickets ADD COLUMN IF NOT EXISTS contact_details json;