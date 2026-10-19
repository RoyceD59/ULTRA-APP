import { pool } from "@workspace/db";

/** Shared migration equivalent for existing deployed databases. */
export async function ensureCheckoutBenefitsSchema() {
  await pool.query(`
    ALTER TABLE uc_orders ADD COLUMN IF NOT EXISTS checkout_snapshot jsonb;
    ALTER TABLE uc_orders ALTER COLUMN discount_amount TYPE numeric(12,2);
    ALTER TABLE uc_orders ALTER COLUMN discount_percent TYPE numeric(12,2);
    ALTER TABLE instant_water_check_tickets ADD COLUMN IF NOT EXISTS promo_code text;
    ALTER TABLE instant_water_check_tickets ADD COLUMN IF NOT EXISTS free_water_test boolean NOT NULL DEFAULT false;
    DO $$
    DECLARE c record;
    BEGIN
      FOR c IN SELECT conname FROM pg_constraint
        WHERE conrelid='uc_promotions'::regclass AND contype='c'
          AND (pg_get_constraintdef(oid) LIKE '%type%' OR pg_get_constraintdef(oid) LIKE '%effect_value%')
      LOOP EXECUTE format('ALTER TABLE uc_promotions DROP CONSTRAINT %I', c.conname); END LOOP;
    END $$;
    ALTER TABLE uc_promotions ADD CONSTRAINT uc_promotions_benefit_type_check
      CHECK (type IN ('bonus_points','redemption_boost','checkout_discount','free_shipping','free_water_test'));
    ALTER TABLE uc_promotions ADD CONSTRAINT uc_promotions_benefit_value_check
      CHECK ((type IN ('free_shipping','free_water_test') AND effect_value=0 AND effect_mode='fixed')
        OR (type NOT IN ('free_shipping','free_water_test') AND effect_value>0));
  `);
}