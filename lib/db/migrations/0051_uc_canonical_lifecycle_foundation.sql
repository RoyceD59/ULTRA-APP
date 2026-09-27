-- Canonical customer lifecycle foundation. Additive and safe for existing
-- Companion orders, registered filters, and legacy impact rows.
CREATE TABLE IF NOT EXISTS uc_lifecycle_schema_versions (
  component text PRIMARY KEY,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uc_canonical_purchases (
  id bigserial PRIMARY KEY,
  customer_id integer REFERENCES uc_users(id),
  companion_order_id integer REFERENCES uc_orders(id),
  woocommerce_order_id integer,
  payment_provider text,
  payment_reference text,
  receipt_number text,
  currency text NOT NULL DEFAULT 'KES',
  subtotal_minor integer,
  tax_minor integer,
  delivery_minor integer,
  discount_minor integer,
  total_minor integer NOT NULL CHECK (total_minor >= 0),
  payment_status text NOT NULL DEFAULT 'pending',
  fulfilment_status text NOT NULL DEFAULT 'pending',
  identity_snapshot jsonb,
  correlation_id text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE uc_canonical_purchases
  ADD COLUMN IF NOT EXISTS total text,
  ADD COLUMN IF NOT EXISTS total_minor integer;
UPDATE uc_canonical_purchases
SET total_minor = round(total::numeric * 100)::integer
WHERE total_minor IS NULL AND NULLIF(btrim(total), '') IS NOT NULL
  AND btrim(total) ~ '^-?[0-9]+([.][0-9]{1,2})?$';
CREATE UNIQUE INDEX IF NOT EXISTS uc_canonical_purchases_companion_order_unique
  ON uc_canonical_purchases(companion_order_id) WHERE companion_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uc_canonical_purchases_woocommerce_order_unique
  ON uc_canonical_purchases(woocommerce_order_id) WHERE woocommerce_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uc_canonical_purchases_provider_reference_unique
  ON uc_canonical_purchases(payment_provider, payment_reference)
  WHERE payment_reference IS NOT NULL AND payment_reference <> '';
CREATE INDEX IF NOT EXISTS uc_canonical_purchases_customer_created_idx
  ON uc_canonical_purchases(customer_id, created_at);
CREATE INDEX IF NOT EXISTS uc_canonical_purchases_correlation_idx
  ON uc_canonical_purchases(correlation_id);

CREATE TABLE IF NOT EXISTS uc_canonical_purchase_lines (
  id bigserial PRIMARY KEY,
  purchase_id bigint NOT NULL REFERENCES uc_canonical_purchases(id) ON DELETE CASCADE,
  source_order_item_id integer REFERENCES uc_order_items(id),
  product_id integer NOT NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_total_minor integer,
  line_total_minor integer NOT NULL CHECK (line_total_minor >= 0),
  product_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE uc_canonical_purchase_lines
  ADD COLUMN IF NOT EXISTS line_total text,
  ADD COLUMN IF NOT EXISTS line_total_minor integer;
UPDATE uc_canonical_purchase_lines
SET line_total_minor = round(line_total::numeric * 100)::integer
WHERE line_total_minor IS NULL AND NULLIF(btrim(line_total), '') IS NOT NULL
  AND btrim(line_total) ~ '^-?[0-9]+([.][0-9]{1,2})?$';
CREATE UNIQUE INDEX IF NOT EXISTS uc_canonical_purchase_lines_source_item_unique
  ON uc_canonical_purchase_lines(source_order_item_id)
  WHERE source_order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS uc_canonical_purchase_lines_purchase_idx
  ON uc_canonical_purchase_lines(purchase_id);
CREATE INDEX IF NOT EXISTS uc_canonical_purchase_lines_product_idx
  ON uc_canonical_purchase_lines(product_id);

CREATE TABLE IF NOT EXISTS uc_identity_conflicts (
  id bigserial PRIMARY KEY,
  principal_type text NOT NULL,
  principal_reference text NOT NULL,
  candidate_customer_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_review','resolved')),
  resolved_customer_id integer REFERENCES uc_users(id),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uc_identity_conflicts_queue_idx
  ON uc_identity_conflicts(status, created_at);
CREATE INDEX IF NOT EXISTS uc_identity_conflicts_principal_idx
  ON uc_identity_conflicts(principal_type, principal_reference);

CREATE TABLE IF NOT EXISTS uc_reconciliation_conflicts (
  id bigserial PRIMARY KEY,
  conflict_type text NOT NULL,
  canonical_purchase_id bigint REFERENCES uc_canonical_purchases(id),
  purchase_line_id bigint REFERENCES uc_canonical_purchase_lines(id),
  source text NOT NULL,
  source_reference text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_review','resolved')),
  priority integer NOT NULL DEFAULT 0,
  assigned_to text,
  resolution text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_reconciliation_conflicts_open_source_unique
  ON uc_reconciliation_conflicts(source, source_reference, reason)
  WHERE status IN ('open','in_review');
CREATE INDEX IF NOT EXISTS uc_reconciliation_conflicts_queue_idx
  ON uc_reconciliation_conflicts(status, priority, created_at);
CREATE INDEX IF NOT EXISTS uc_reconciliation_conflicts_purchase_idx
  ON uc_reconciliation_conflicts(canonical_purchase_id);

CREATE TABLE IF NOT EXISTS uc_legacy_registration_reviews (
  id bigserial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES uc_users(id),
  product_id integer NOT NULL,
  product_name text NOT NULL,
  approximate_purchase_date date,
  installation_date date,
  receipt_reference text,
  serial_or_qr_reference text,
  seller_channel text,
  evidence_object_path text,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','rejected','correction_requested')),
  customer_message text,
  decision_reason text,
  canonical_purchase_id bigint REFERENCES uc_canonical_purchases(id),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE uc_legacy_registration_reviews
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE uc_legacy_registration_reviews SET request_fingerprint = 'legacy:' || id::text
WHERE NULLIF(request_fingerprint, '') IS NULL;
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'uc_legacy_registration_reviews' AND column_name = 'approximate_purchase_date') = 'timestamp with time zone' THEN
    ALTER TABLE uc_legacy_registration_reviews ALTER COLUMN approximate_purchase_date TYPE date USING approximate_purchase_date::date;
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'uc_legacy_registration_reviews' AND column_name = 'installation_date') = 'timestamp with time zone' THEN
    ALTER TABLE uc_legacy_registration_reviews ALTER COLUMN installation_date TYPE date USING installation_date::date;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS uc_legacy_registration_reviews_queue_idx
  ON uc_legacy_registration_reviews(status, created_at);
CREATE INDEX IF NOT EXISTS uc_legacy_registration_reviews_customer_idx
  ON uc_legacy_registration_reviews(customer_id, created_at);

CREATE TABLE IF NOT EXISTS uc_legacy_registration_decisions (
  id bigserial PRIMARY KEY,
  review_id bigint NOT NULL REFERENCES uc_legacy_registration_reviews(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved','rejected','correction_requested','merged')),
  reason text NOT NULL,
  actor text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE uc_legacy_registration_decisions
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE uc_legacy_registration_decisions SET request_fingerprint = 'legacy:' || id::text
WHERE NULLIF(request_fingerprint, '') IS NULL;
CREATE INDEX IF NOT EXISTS uc_legacy_registration_decisions_review_idx
  ON uc_legacy_registration_decisions(review_id, created_at);

CREATE TABLE IF NOT EXISTS uc_audit_events (
  id bigserial PRIMARY KEY,
  actor text NOT NULL,
  actor_type text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  reason text,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_value jsonb,
  new_value jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE uc_audit_events
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE uc_audit_events
SET idempotency_key = 'legacy:' || id::text,
    request_fingerprint = 'legacy:' || id::text
WHERE NULLIF(idempotency_key, '') IS NULL OR NULLIF(request_fingerprint, '') IS NULL;
CREATE INDEX IF NOT EXISTS uc_audit_events_resource_idx
  ON uc_audit_events(resource_type, resource_id, created_at);
CREATE INDEX IF NOT EXISTS uc_audit_events_actor_idx
  ON uc_audit_events(actor, created_at);
CREATE INDEX IF NOT EXISTS uc_audit_events_correlation_idx
  ON uc_audit_events(correlation_id);

CREATE TABLE IF NOT EXISTS uc_lifecycle_impact_events (
  id bigserial PRIMARY KEY,
  customer_id integer REFERENCES uc_users(id),
  registered_filter_id integer REFERENCES uc_registered_filters(id),
  canonical_purchase_line_id bigint REFERENCES uc_canonical_purchase_lines(id),
  event_type text NOT NULL,
  source text NOT NULL,
  value integer NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'litres',
  eligible boolean NOT NULL DEFAULT false,
  actor text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  correction_of_event_id bigint REFERENCES uc_lifecycle_impact_events(id),
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE uc_lifecycle_impact_events
  ADD COLUMN IF NOT EXISTS canonical_purchase_line_id bigint REFERENCES uc_canonical_purchase_lines(id),
  ADD COLUMN IF NOT EXISTS correction_of_event_id bigint REFERENCES uc_lifecycle_impact_events(id);
ALTER TABLE uc_lifecycle_impact_events
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE uc_lifecycle_impact_events SET request_fingerprint = 'legacy:' || id::text
WHERE NULLIF(request_fingerprint, '') IS NULL;
ALTER TABLE uc_lifecycle_impact_events
  DROP CONSTRAINT IF EXISTS uc_lifecycle_impact_events_idempotency_key_key;
DROP INDEX IF EXISTS uc_lifecycle_impact_events_idempotency_key_key;
DROP INDEX IF EXISTS uc_lifecycle_impact_events_idempotency_unique;
DO $$
BEGIN
  UPDATE uc_identity_conflicts SET status = 'resolved' WHERE status IN ('rejected','dismissed');
  UPDATE uc_reconciliation_conflicts SET status = 'resolved' WHERE status IN ('rejected','dismissed');
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uc_lifecycle_impact_events_type_check') THEN
    ALTER TABLE uc_lifecycle_impact_events ADD CONSTRAINT uc_lifecycle_impact_events_type_check
      CHECK (event_type IN ('registration','activation','deactivation','maintenance','replacement','referral_conversion','correction'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uc_lifecycle_impact_events_unit_check') THEN
    ALTER TABLE uc_lifecycle_impact_events ADD CONSTRAINT uc_lifecycle_impact_events_unit_check
      CHECK (unit IN ('litres','count','event'));
  END IF;
  ALTER TABLE uc_lifecycle_impact_events DROP CONSTRAINT IF EXISTS uc_lifecycle_impact_events_eligible_ownership_check;
  ALTER TABLE uc_lifecycle_impact_events ADD CONSTRAINT uc_lifecycle_impact_events_eligible_ownership_check
    CHECK (NOT eligible OR (customer_id IS NOT NULL AND registered_filter_id IS NOT NULL) OR (customer_id IS NULL AND registered_filter_id IS NULL AND source = 'approved_organizational'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uc_lifecycle_impact_events_correction_self_check') THEN
    ALTER TABLE uc_lifecycle_impact_events ADD CONSTRAINT uc_lifecycle_impact_events_correction_self_check
      CHECK (correction_of_event_id IS NULL OR correction_of_event_id <> id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uc_lifecycle_impact_events_correction_pair_check') THEN
    ALTER TABLE uc_lifecycle_impact_events ADD CONSTRAINT uc_lifecycle_impact_events_correction_pair_check
      CHECK ((event_type = 'correction') = (correction_of_event_id IS NOT NULL));
  END IF;
  ALTER TABLE uc_identity_conflicts DROP CONSTRAINT IF EXISTS uc_identity_conflicts_status_check;
  ALTER TABLE uc_identity_conflicts ADD CONSTRAINT uc_identity_conflicts_status_check
    CHECK (status IN ('open','in_review','resolved'));
  ALTER TABLE uc_reconciliation_conflicts DROP CONSTRAINT IF EXISTS uc_reconciliation_conflicts_status_check;
  ALTER TABLE uc_reconciliation_conflicts ADD CONSTRAINT uc_reconciliation_conflicts_status_check
    CHECK (status IN ('open','in_review','resolved'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uc_legacy_registration_reviews_status_check') THEN
    ALTER TABLE uc_legacy_registration_reviews ADD CONSTRAINT uc_legacy_registration_reviews_status_check
      CHECK (status IN ('pending_review','approved','rejected','correction_requested'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uc_legacy_registration_decisions_decision_check') THEN
    ALTER TABLE uc_legacy_registration_decisions ADD CONSTRAINT uc_legacy_registration_decisions_decision_check
      CHECK (decision IN ('approved','rejected','correction_requested','merged'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS uc_lifecycle_impact_events_customer_created_idx
  ON uc_lifecycle_impact_events(customer_id, created_at);
CREATE INDEX IF NOT EXISTS uc_lifecycle_impact_events_filter_created_idx
  ON uc_lifecycle_impact_events(registered_filter_id, created_at);
CREATE INDEX IF NOT EXISTS uc_lifecycle_impact_events_eligible_idx
  ON uc_lifecycle_impact_events(eligible, created_at);
CREATE INDEX IF NOT EXISTS uc_lifecycle_impact_events_correction_idx
  ON uc_lifecycle_impact_events(correction_of_event_id);

-- Existing deployments may have the original text/timestamp shape from an
-- earlier draft of this foundation. Add the final shape without rewriting data.
ALTER TABLE uc_canonical_purchases
  ADD COLUMN IF NOT EXISTS total text,
  ADD COLUMN IF NOT EXISTS subtotal_minor integer,
  ADD COLUMN IF NOT EXISTS tax_minor integer,
  ADD COLUMN IF NOT EXISTS delivery_minor integer,
  ADD COLUMN IF NOT EXISTS discount_minor integer,
  ADD COLUMN IF NOT EXISTS total_minor integer;
ALTER TABLE uc_canonical_purchase_lines
  ADD COLUMN IF NOT EXISTS line_total text,
  ADD COLUMN IF NOT EXISTS unit_total_minor integer,
  ADD COLUMN IF NOT EXISTS line_total_minor integer;
UPDATE uc_canonical_purchases
SET total_minor = CASE
  WHEN NULLIF(btrim(total), '') IS NULL THEN NULL
  WHEN btrim(total) ~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN round(total::numeric * 100)::integer
  ELSE NULL
END
WHERE total_minor IS NULL AND NULLIF(btrim(total), '') IS NOT NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM uc_canonical_purchases WHERE NULLIF(btrim(total), '') IS NOT NULL AND total_minor IS NULL) THEN
    RAISE EXCEPTION 'Cannot derive total_minor safely from existing canonical purchase totals';
  END IF;
END $$;
UPDATE uc_canonical_purchase_lines
SET line_total_minor = CASE
  WHEN NULLIF(btrim(line_total), '') IS NULL THEN NULL
  WHEN btrim(line_total) ~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN round(line_total::numeric * 100)::integer
  ELSE NULL
END
WHERE line_total_minor IS NULL AND NULLIF(btrim(line_total), '') IS NOT NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM uc_canonical_purchase_lines WHERE NULLIF(btrim(line_total), '') IS NOT NULL AND line_total_minor IS NULL) THEN
    RAISE EXCEPTION 'Cannot derive line_total_minor safely from existing canonical purchase line totals';
  END IF;
END $$;
ALTER TABLE uc_legacy_registration_reviews
  ADD COLUMN IF NOT EXISTS approximate_purchase_date date,
  ADD COLUMN IF NOT EXISTS installation_date date;
DO $$
DECLARE purchase_date_type text;
DECLARE installation_date_type text;
BEGIN
  SELECT data_type INTO purchase_date_type FROM information_schema.columns
    WHERE table_name = 'uc_legacy_registration_reviews' AND column_name = 'approximate_purchase_date';
  IF purchase_date_type = 'timestamp with time zone' THEN
    ALTER TABLE uc_legacy_registration_reviews ALTER COLUMN approximate_purchase_date TYPE date USING approximate_purchase_date::date;
  ELSIF purchase_date_type = 'text' THEN
    ALTER TABLE uc_legacy_registration_reviews ALTER COLUMN approximate_purchase_date TYPE date USING NULLIF(btrim(approximate_purchase_date), '')::date;
  END IF;
  SELECT data_type INTO installation_date_type FROM information_schema.columns
    WHERE table_name = 'uc_legacy_registration_reviews' AND column_name = 'installation_date';
  IF installation_date_type = 'timestamp with time zone' THEN
    ALTER TABLE uc_legacy_registration_reviews ALTER COLUMN installation_date TYPE date USING installation_date::date;
  ELSIF installation_date_type = 'text' THEN
    ALTER TABLE uc_legacy_registration_reviews ALTER COLUMN installation_date TYPE date USING NULLIF(btrim(installation_date), '')::date;
  END IF;
END $$;
ALTER TABLE uc_legacy_registration_decisions
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE uc_legacy_registration_reviews
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE uc_lifecycle_impact_events
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE uc_audit_events
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE uc_legacy_registration_decisions SET idempotency_key = 'legacy:' || id::text WHERE NULLIF(idempotency_key, '') IS NULL;
UPDATE uc_legacy_registration_decisions SET request_fingerprint = 'legacy:' || id::text WHERE NULLIF(request_fingerprint, '') IS NULL;
UPDATE uc_legacy_registration_reviews SET request_fingerprint = 'legacy:' || id::text WHERE NULLIF(request_fingerprint, '') IS NULL;
UPDATE uc_lifecycle_impact_events SET request_fingerprint = 'legacy:' || id::text WHERE NULLIF(request_fingerprint, '') IS NULL;
UPDATE uc_audit_events SET idempotency_key = 'legacy:' || id::text WHERE NULLIF(idempotency_key, '') IS NULL;
UPDATE uc_audit_events SET request_fingerprint = 'legacy:' || id::text WHERE NULLIF(request_fingerprint, '') IS NULL;
ALTER TABLE uc_canonical_purchases ALTER COLUMN total_minor SET NOT NULL;
ALTER TABLE uc_canonical_purchase_lines ALTER COLUMN line_total_minor SET NOT NULL;
ALTER TABLE uc_legacy_registration_decisions
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_fingerprint SET NOT NULL;
ALTER TABLE uc_legacy_registration_reviews
  ALTER COLUMN request_fingerprint SET NOT NULL;
ALTER TABLE uc_lifecycle_impact_events ALTER COLUMN request_fingerprint SET NOT NULL;
ALTER TABLE uc_audit_events
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_fingerprint SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uc_legacy_registration_decisions_review_actor_key_unique
  ON uc_legacy_registration_decisions(review_id, actor, idempotency_key);
ALTER TABLE uc_legacy_registration_reviews
  DROP CONSTRAINT IF EXISTS uc_legacy_registration_reviews_customer_idempotency_key,
  DROP CONSTRAINT IF EXISTS uc_legacy_registration_reviews_customer_idempotency_key_key;
DROP INDEX IF EXISTS uc_legacy_registration_reviews_idempotency_unique;
DROP INDEX IF EXISTS uc_legacy_registration_reviews_customer_idempotency_key;
DROP INDEX IF EXISTS uc_legacy_registration_reviews_customer_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS uc_legacy_registration_reviews_customer_idempotency_unique
  ON uc_legacy_registration_reviews(customer_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uc_audit_events_actor_idempotency_unique
  ON uc_audit_events(actor, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uc_lifecycle_impact_events_actor_idempotency_unique
  ON uc_lifecycle_impact_events(actor, idempotency_key);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM uc_lifecycle_impact_events
    WHERE eligible AND NOT (
      (customer_id IS NOT NULL AND registered_filter_id IS NOT NULL)
      OR (customer_id IS NULL AND registered_filter_id IS NULL AND source = 'approved_organizational')
    )
  ) THEN
    RAISE EXCEPTION 'Cannot converge lifecycle eligibility: existing eligible event lacks approved ownership';
  END IF;
END $$;
ALTER TABLE uc_lifecycle_impact_events
  ALTER COLUMN eligible SET DEFAULT false,
  ALTER COLUMN eligible SET NOT NULL;
DROP INDEX IF EXISTS uc_canonical_purchases_receipt_unique;

ALTER TABLE uc_registered_filters
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS canonical_purchase_line_id bigint REFERENCES uc_canonical_purchase_lines(id),
  ADD COLUMN IF NOT EXISTS legacy_review_id bigint REFERENCES uc_legacy_registration_reviews(id),
  ADD COLUMN IF NOT EXISTS maintenance_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
DO $$
DECLARE had_lifecycle_status boolean; current_version integer;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uc_registered_filters' AND column_name = 'lifecycle_status') INTO had_lifecycle_status;
  SELECT version INTO current_version FROM uc_lifecycle_schema_versions WHERE component = 'customer_lifecycle_foundation';
  ALTER TABLE uc_registered_filters ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';
  IF NOT had_lifecycle_status OR COALESCE(current_version, 0) < 3 THEN
    UPDATE uc_registered_filters SET lifecycle_status = CASE WHEN active THEN 'active' ELSE 'inactive' END;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uc_registered_filters_verification_status_check') THEN
    ALTER TABLE uc_registered_filters ADD CONSTRAINT uc_registered_filters_verification_status_check
      CHECK (verification_status IN ('pending_review','approved','rejected','correction_requested'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uc_registered_filters_lifecycle_status_check') THEN
    ALTER TABLE uc_registered_filters ADD CONSTRAINT uc_registered_filters_lifecycle_status_check
      CHECK (lifecycle_status IN ('active','inactive'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uc_registered_filters_verified_purchase_line_unique
  ON uc_registered_filters(canonical_purchase_line_id)
  WHERE verification_status = 'approved' AND canonical_purchase_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS uc_registered_filters_user_status_idx
  ON uc_registered_filters(user_id, verification_status, lifecycle_status);
DO $$
BEGIN
  ALTER TABLE uc_canonical_purchases DROP CONSTRAINT IF EXISTS uc_canonical_purchases_amounts_check;
  ALTER TABLE uc_canonical_purchases ADD CONSTRAINT uc_canonical_purchases_amounts_check
    CHECK (total_minor >= 0 AND (subtotal_minor IS NULL OR subtotal_minor >= 0) AND (tax_minor IS NULL OR tax_minor >= 0) AND (delivery_minor IS NULL OR delivery_minor >= 0) AND (discount_minor IS NULL OR discount_minor >= 0));
  ALTER TABLE uc_canonical_purchase_lines DROP CONSTRAINT IF EXISTS uc_canonical_purchase_lines_quantity_check;
  ALTER TABLE uc_canonical_purchase_lines ADD CONSTRAINT uc_canonical_purchase_lines_quantity_check
    CHECK (quantity > 0 AND (unit_total_minor IS NULL OR unit_total_minor >= 0));
  ALTER TABLE uc_canonical_purchase_lines DROP CONSTRAINT IF EXISTS uc_canonical_purchase_lines_line_total_minor_check;
  ALTER TABLE uc_canonical_purchase_lines ADD CONSTRAINT uc_canonical_purchase_lines_line_total_minor_check
    CHECK (line_total_minor >= 0);
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM uc_lifecycle_impact_events e
    WHERE e.eligible AND e.customer_id IS NOT NULL
      AND (e.registered_filter_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM uc_registered_filters f
        WHERE f.id = e.registered_filter_id
          AND f.user_id = e.customer_id AND f.verification_status = 'approved'
      ))
  ) OR EXISTS (
    SELECT 1 FROM uc_lifecycle_impact_events
    WHERE source = 'approved_organizational' AND (customer_id IS NOT NULL OR registered_filter_id IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM uc_lifecycle_impact_events e
    LEFT JOIN uc_lifecycle_impact_events t ON t.id = e.correction_of_event_id
    WHERE (e.event_type = 'correction' AND (
      t.id IS NULL OR t.correction_of_event_id IS NOT NULL OR t.id = e.id
      OR t.customer_id IS DISTINCT FROM e.customer_id
      OR t.registered_filter_id IS DISTINCT FROM e.registered_filter_id
      OR t.unit IS DISTINCT FROM e.unit
      OR t.eligible IS DISTINCT FROM e.eligible
      OR e.value = 0 OR t.value = 0 OR (e.value > 0) = (t.value > 0)
    )) OR (e.event_type <> 'correction' AND e.correction_of_event_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Cannot converge existing lifecycle rows: eligibility or correction invariant violation';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION uc_validate_lifecycle_impact_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE filter_customer integer; filter_status text; target uc_lifecycle_impact_events%ROWTYPE;
BEGIN
  IF NEW.source = 'approved_organizational' AND (NEW.customer_id IS NOT NULL OR NEW.registered_filter_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Approved organizational impact cannot have customer or filter ownership';
  END IF;
  IF NEW.eligible THEN
    IF NEW.customer_id IS NULL OR NEW.registered_filter_id IS NULL THEN
      IF NEW.customer_id IS NOT NULL OR NEW.registered_filter_id IS NOT NULL OR NEW.source <> 'approved_organizational' THEN
        RAISE EXCEPTION 'Eligible impact requires an approved organizational source or customer filter ownership';
      END IF;
    ELSE
      -- Lock order: event writes take the filter row lock before validating;
      -- filter writes already own that row lock before reverse-scanning events.
      SELECT user_id, verification_status INTO filter_customer, filter_status
      FROM uc_registered_filters WHERE id = NEW.registered_filter_id FOR SHARE;
      IF filter_customer IS NULL OR filter_customer <> NEW.customer_id OR filter_status <> 'approved' THEN
        RAISE EXCEPTION 'Eligible impact filter is not approved and owned by the customer';
      END IF;
    END IF;
  END IF;
  IF NEW.event_type = 'correction' THEN
    -- Lock order: filter row first, then correction target row; reverse filter
    -- validation takes the filter row before scanning lifecycle event rows.
    SELECT * INTO target FROM uc_lifecycle_impact_events
    WHERE id = NEW.correction_of_event_id FOR SHARE;
    IF NOT FOUND OR target.correction_of_event_id IS NOT NULL OR target.id = NEW.id
       OR target.customer_id IS DISTINCT FROM NEW.customer_id
       OR target.registered_filter_id IS DISTINCT FROM NEW.registered_filter_id
       OR target.unit IS DISTINCT FROM NEW.unit
       OR target.eligible IS DISTINCT FROM NEW.eligible
       OR NEW.value = 0 OR target.value = 0 OR (NEW.value > 0) = (target.value > 0) THEN
      RAISE EXCEPTION 'Invalid lifecycle correction target or opposite-sign value';
    END IF;
  ELSIF NEW.correction_of_event_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only correction events may reference correction_of_event_id';
  END IF;
  IF EXISTS (
    SELECT 1 FROM uc_lifecycle_impact_events c
    WHERE c.correction_of_event_id = NEW.id
      AND (c.customer_id IS DISTINCT FROM NEW.customer_id
        OR c.registered_filter_id IS DISTINCT FROM NEW.registered_filter_id
        OR c.unit IS DISTINCT FROM NEW.unit
        OR c.eligible IS DISTINCT FROM NEW.eligible
        OR c.value = 0 OR NEW.value = 0
        OR (c.value > 0) = (NEW.value > 0)
        OR NEW.correction_of_event_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Lifecycle correction invariant would be broken by target update';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS uc_validate_lifecycle_impact_event_trigger ON uc_lifecycle_impact_events;
CREATE TRIGGER uc_validate_lifecycle_impact_event_trigger
  BEFORE INSERT OR UPDATE ON uc_lifecycle_impact_events
  FOR EACH ROW EXECUTE FUNCTION uc_validate_lifecycle_impact_event();
CREATE OR REPLACE FUNCTION uc_validate_registered_filter_lifecycle_events()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM uc_lifecycle_impact_events WHERE eligible AND registered_filter_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot delete a registered filter referenced by eligible lifecycle events';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM uc_lifecycle_impact_events
    WHERE eligible AND registered_filter_id = NEW.id
      AND (customer_id IS DISTINCT FROM NEW.user_id OR NEW.verification_status <> 'approved')
  ) THEN
    RAISE EXCEPTION 'Cannot invalidate ownership or approval of an eligible lifecycle filter';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS uc_validate_registered_filter_lifecycle_events_trigger ON uc_registered_filters;
CREATE CONSTRAINT TRIGGER uc_validate_registered_filter_lifecycle_events_trigger
  AFTER UPDATE OR DELETE ON uc_registered_filters
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION uc_validate_registered_filter_lifecycle_events();
INSERT INTO uc_lifecycle_schema_versions(component, version)
VALUES ('customer_lifecycle_foundation', 3)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();