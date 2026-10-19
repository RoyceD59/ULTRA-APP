CREATE TABLE IF NOT EXISTS uc_product_editorial (
  code text PRIMARY KEY,
  revision integer NOT NULL DEFAULT 1,
  record jsonb NOT NULL,
  gallery_mapped boolean NOT NULL DEFAULT false,
  price_import_revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE uc_product_editorial ADD COLUMN IF NOT EXISTS gallery_mapped boolean NOT NULL DEFAULT false;
ALTER TABLE uc_product_editorial ADD COLUMN IF NOT EXISTS price_import_revision integer NOT NULL DEFAULT 0;
ALTER TABLE uc_order_items ADD COLUMN IF NOT EXISTS variation_id integer;
ALTER TABLE uc_order_items ADD COLUMN IF NOT EXISTS child_sku text;
ALTER TABLE uc_order_items ADD COLUMN IF NOT EXISTS variant_label text;
