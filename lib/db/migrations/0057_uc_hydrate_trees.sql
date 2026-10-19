-- Hydrate the Future shared trees. Keep in lockstep with the startup DDL in
-- artifacts/api-server/src/lib/hydrate-tree-schema.ts.
CREATE TABLE IF NOT EXISTS uc_hydrate_trees (
  tree_number integer PRIMARY KEY,
  target_minor integer NOT NULL CONSTRAINT uc_hydrate_trees_target_check CHECK (target_minor > 0),
  established_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uc_hydrate_tree_contributions (
  id bigserial PRIMARY KEY,
  canonical_purchase_id bigint NOT NULL REFERENCES uc_canonical_purchases(id),
  customer_id integer NOT NULL REFERENCES uc_users(id),
  tree_number integer NOT NULL REFERENCES uc_hydrate_trees(tree_number),
  amount_minor integer NOT NULL CONSTRAINT uc_hydrate_tree_contributions_amount_check CHECK (amount_minor > 0),
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_hydrate_tree_contributions_purchase_tree_unique
  ON uc_hydrate_tree_contributions(canonical_purchase_id, tree_number);
CREATE INDEX IF NOT EXISTS uc_hydrate_tree_contributions_customer_idx
  ON uc_hydrate_tree_contributions(customer_id, created_at);
CREATE INDEX IF NOT EXISTS uc_hydrate_tree_contributions_tree_idx
  ON uc_hydrate_tree_contributions(tree_number);