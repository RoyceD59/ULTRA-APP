ALTER TABLE uc_product_editorial ADD COLUMN IF NOT EXISTS content_import_revision integer NOT NULL DEFAULT 0;
