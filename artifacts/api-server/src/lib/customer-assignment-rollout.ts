import { pool } from "@workspace/db";

/** Additive startup equivalent of 0058; safe after a partially applied rollout. */
export async function ensureCustomerAssignmentTables(executor: Pick<typeof pool, "query"> = pool) {
  await executor.query(`
    CREATE TABLE IF NOT EXISTS uc_customer_assignments (
      id serial PRIMARY KEY, idempotency_key text NOT NULL, customer_name text NOT NULL,
      email text NOT NULL, phone text NOT NULL, product_id integer NOT NULL,
      product_name text NOT NULL, lifespan_days integer NOT NULL, capacity_litres integer NOT NULL,
      installation_date date NOT NULL, order_id integer NOT NULL REFERENCES uc_orders(id),
      order_item_id integer NOT NULL REFERENCES uc_order_items(id), woo_order_item_id integer,
      target_account_id integer REFERENCES uc_users(id), linked_account_id integer REFERENCES uc_users(id),
      filter_id integer REFERENCES uc_registered_filters(id), status text NOT NULL DEFAULT 'pending',
      review_reason text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      linked_at timestamptz,
      CONSTRAINT uc_customer_assignments_status_check CHECK (status IN ('pending','linked','review'))
    );
    ALTER TABLE uc_customer_assignments ADD COLUMN IF NOT EXISTS woo_order_item_id integer;
    CREATE UNIQUE INDEX IF NOT EXISTS uc_customer_assignments_key_unique ON uc_customer_assignments(idempotency_key);
    CREATE UNIQUE INDEX IF NOT EXISTS uc_customer_assignments_line_unique ON uc_customer_assignments(order_item_id);
    CREATE TABLE IF NOT EXISTS uc_customer_assignment_audit (
      id serial PRIMARY KEY, assignment_id integer NOT NULL REFERENCES uc_customer_assignments(id),
      actor text NOT NULL, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}