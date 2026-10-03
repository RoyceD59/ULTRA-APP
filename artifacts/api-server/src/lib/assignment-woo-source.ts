import { pool } from "@workspace/db";
import { AssignmentError } from "./customer-assignments.js";
import { wcFetchArray, hasWCCredentials } from "../routes/uc.js";

/** Import a read-only snapshot of an EXISTING sale, never create a Woo sale.
 * No status pipeline, provider writes, collection, reward or impact handlers. */
export async function ensureAssignmentWooSource(wooId: number): Promise<void> {
  if (!hasWCCredentials()) throw new AssignmentError("SOURCE_UNAVAILABLE", "WooCommerce lookup is not available.", 503);
  const remote = (await wcFetchArray("/orders", { include: String(wooId) }, AbortSignal.timeout(15000)))?.find(o => Number(o["id"]) === wooId);
  if (!remote) throw new AssignmentError("SOURCE_UNAVAILABLE", "WooCommerce could not supply this existing order.", 503);
  if (remote["payment_method"] !== "cod" || !["processing","completed","on-hold","shipped","delivered"].includes(String(remote["status"])))
    throw new AssignmentError("INELIGIBLE_ORDER", "Only an existing eligible WooCommerce COD purchase can be selected.");
  const items = remote["line_items"] as Array<{ id: number; product_id: number; name: string; quantity: number; total: string }> | undefined;
  const date = String(remote["date_created_gmt"] ?? "");
  if (!Array.isArray(items) || !items.length || !Number.isFinite(Date.parse(`${date}Z`)) ||
      !/^\d+(\.\d+)?$/.test(String(remote["total"])) || !remote["currency"] ||
      items.some(i => !Number.isSafeInteger(i.id) || i.id <= 0 || !Number.isSafeInteger(i.product_id) || i.product_id <= 0 ||
        !Number.isInteger(i.quantity) || i.quantity <= 0 || !i.name || !/^\d+(\.\d+)?$/.test(String(i.total))))
    throw new AssignmentError("SOURCE_CONFLICT", "This source lacks valid purchase lines, date or totals. Staff purchase review is required.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`assignment-woo-source:${wooId}`]);
    const existing = await client.query("SELECT id FROM uc_orders WHERE wc_order_id=$1 FOR UPDATE", [wooId]);
    if (existing.rowCount === 0) {
      const billing = remote["billing"] as { email?: string } | undefined;
      const id = (await client.query<{ id: number }>(`INSERT INTO uc_orders
        (user_id,status,total,currency,payment_method,wc_order_id,date_created,cod_collection_status,payment_reference)
        VALUES($1,$2,$3,$4,'cod',$5,$6,NULL,'') RETURNING id`,
      [String(billing?.email ?? "").trim().toLowerCase() || "guest",remote["status"],remote["total"],remote["currency"],wooId,`${date}Z`])).rows[0]!.id;
      for (const item of items) await client.query(`INSERT INTO uc_order_items(order_id,product_id,name,quantity,total)
        VALUES($1,$2,$3,$4,$5)`, [id,item.product_id,item.name,item.quantity,item.total]);
    } else if (existing.rowCount !== 1) {
      throw new AssignmentError("SOURCE_CONFLICT", "Multiple local records mirror this Woo order; purchase review is required.");
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}