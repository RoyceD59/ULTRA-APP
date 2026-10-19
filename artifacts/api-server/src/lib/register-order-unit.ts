import { pool } from "@workspace/db";
import { activationEligibility } from "./activation-eligibility.js";

/** Serialized, idempotent installation. Never changes an existing cycle. */
export async function registerOrderUnit(input: {
  accountId: number; source: "app" | "store"; orderId: number; productId: number; lineId: number;
  unitId: string; productName: string; capacityLitres: number; activatedAt: Date;
}) {
  const expectedPrefix = `${input.source}:${input.orderId}:${input.lineId}:`;
  if (!input.unitId.startsWith(expectedPrefix) || !/^\d+$/.test(input.unitId.slice(expectedPrefix.length)) ||
      Number(input.unitId.slice(expectedPrefix.length)) < 1) throw new Error("Invalid purchase unit.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`filter-unit:${input.source}:${input.orderId}:${input.productId}`]);
    if (input.source === "app") {
      const order = (await client.query("SELECT * FROM uc_orders WHERE id=$1 FOR UPDATE", [input.orderId])).rows[0];
      if (!order || order.user_id !== String(input.accountId) || !activationEligibility({
        status: order.status, paymentMethod: order.payment_method, checkoutState: order.checkout_state,
        paymentConfirmedAt: order.payment_confirmed_at, codCollectionStatus: order.cod_collection_status, customerStage: order.customer_stage,
      }, "app").eligible) throw new Error("Purchase acceptance changed. Refresh your purchases before activation.");
      const line = (await client.query("SELECT * FROM uc_order_items WHERE id=$1 AND order_id=$2 AND product_id=$3",
        [input.lineId, input.orderId, input.productId])).rows[0];
      const ordinal = Number(input.unitId.split(":").at(-1));
      if (!line || ordinal < 1 || ordinal > line.quantity) throw new Error("Purchase unit changed. Refresh before activation.");
      if (order.wc_order_id) {
        const mirror = await client.query("SELECT id FROM uc_registered_filters WHERE source='store' AND source_order_id=$1 AND product_id=$2",
          [order.wc_order_id, input.productId]);
        if (mirror.rows.length) throw new Error("This purchase was previously activated using its store receipt. Contact support to review remaining units.");
      }
    }
    const existing = (await client.query("SELECT * FROM uc_registered_filters WHERE source_unit_id=$1", [input.unitId])).rows[0];
    if (existing) {
      if (existing.user_id !== input.accountId || new Date(existing.activated_at).getTime() !== input.activatedAt.getTime())
        throw new Error("This unit is already activated. Its original installation and history cannot be overwritten.");
      await client.query("COMMIT");
      return { registration: project(existing), repeated: true };
    }
    const legacy = await client.query("SELECT id FROM uc_registered_filters WHERE source=$1 AND source_order_id=$2 AND product_id=$3 AND source_unit_id IS NULL",
      [input.source, input.orderId, input.productId]);
    if (legacy.rows.length) throw new Error("This receipt already has an older registration. Contact support to review its remaining units.");
    const row = (await client.query(`INSERT INTO uc_registered_filters
      (user_id,product_id,product_name,rated_capacity_litres,activated_at,source,source_order_id,source_unit_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [input.accountId, input.productId, input.productName, input.capacityLitres, input.activatedAt, input.source, input.orderId, input.unitId])).rows[0];
    await client.query("COMMIT");
    return { registration: project(row), repeated: false };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
function project(row: Record<string, any>) {
  return { id: row.id, userId: row.user_id, productId: row.product_id, productName: row.product_name,
    ratedCapacityLitres: row.rated_capacity_litres, activatedAt: new Date(row.activated_at).toISOString(),
    sourceOrderId: row.source_order_id, sourceUnitId: row.source_unit_id, maintenanceCount: row.maintenance_count };
}