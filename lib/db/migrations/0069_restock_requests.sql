CREATE TABLE IF NOT EXISTS uc_restock_requests (
  id serial PRIMARY KEY,
  customer_id integer REFERENCES uc_users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('guest', 'customer')),
  name text, phone text, location text,
  product_code text NOT NULL, product_name text NOT NULL,
  product_slug text NOT NULL, parent_sku text NOT NULL,
  variant_sku text, variant_label text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'resolved')),
  request_key text NOT NULL, demand_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_restock_requests_retry_uniq ON uc_restock_requests(request_key);
CREATE UNIQUE INDEX IF NOT EXISTS uc_restock_requests_open_uniq ON uc_restock_requests(demand_key)
  WHERE status IN ('pending', 'contacted');
CREATE INDEX IF NOT EXISTS uc_restock_requests_status_created_idx ON uc_restock_requests(status, created_at);
CREATE INDEX IF NOT EXISTS uc_restock_requests_customer_idx ON uc_restock_requests(customer_id);

-- Both hard deletion and existing soft deletion erase the retained contact
-- snapshot. Keep only anonymous product-demand history, never inferred ownership.
CREATE OR REPLACE FUNCTION erase_customer_restock_contacts() RETURNS trigger AS $$
BEGIN
  UPDATE uc_restock_requests SET customer_id = NULL, name = NULL, phone = NULL,
    location = NULL, demand_key = 'erased:' || id, request_key = 'erased:' || id,
    status = 'resolved', resolved_at = now(), updated_at = now()
    WHERE customer_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS uc_restock_customer_delete ON uc_users;
CREATE TRIGGER uc_restock_customer_delete BEFORE DELETE ON uc_users
  FOR EACH ROW EXECUTE FUNCTION erase_customer_restock_contacts();
DROP TRIGGER IF EXISTS uc_restock_customer_soft_delete ON uc_users;
CREATE TRIGGER uc_restock_customer_soft_delete AFTER UPDATE OF deleted_at ON uc_users
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION erase_customer_restock_contacts();
