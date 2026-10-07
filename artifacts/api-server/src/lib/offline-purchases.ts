import { randomUUID } from "node:crypto";
import { pool, type OfflineProduct } from "@workspace/db";
import type { PoolClient } from "pg";

export class OfflinePurchaseError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export type OfflineCatalogue = { lifespans: Map<number, number> | null; capacities: Map<number, number> | null };

/** Preserve only unchanged source lines; never accept caller-supplied unit identities. */
export function reconcileOfflineProducts(next: OfflineProduct[], previous: OfflineProduct[] = []): OfflineProduct[] {
  const used = new Set<OfflineProduct>();
  return next.map(p => {
    const candidates = previous.filter(old => !used.has(old) &&
      (p.lineId ? old.lineId === p.lineId : true) &&
      old.productId === p.productId && old.productName === p.productName);
    const old = candidates.length === 1 ? candidates[0] : undefined;
    if (old) used.add(old);
    // Retain retired identities too: a quantity reduction must not free a
    // previously registered unit for another registration on this line.
    const unitIds = [...(old?.unitIds ?? [])];
    while (unitIds.length < p.quantity) unitIds.push(randomUUID());
    return { ...p, lineId: old?.lineId ?? randomUUID(), unitIds };
  });
}

type Sale = {
  id: number; companion_user_id: number | null; account_setup_status: string;
  conflict_reason: string | null; products: OfflineProduct[]; sale_date: string;
};
async function account(client: PoolClient, id: number) {
  if (!(await client.query("SELECT id FROM uc_users WHERE id=$1 AND deleted_at IS NULL FOR SHARE", [id])).rowCount)
    throw new OfflinePurchaseError("Authentication required", 401);
}
function owned(sale: Sale | undefined, id: number): sale is Sale {
  return !!sale && sale.companion_user_id === id && !sale.conflict_reason &&
    ["linked-existing", "created", "failed"].includes(sale.account_setup_status);
}
async function hydrate(client: PoolClient, sale: Sale) {
  if (sale.products.some(p => !p.lineId || !p.unitIds || p.unitIds.length < p.quantity)) {
    sale.products = reconcileOfflineProducts(sale.products, sale.products);
    await client.query("UPDATE uc_offline_clients SET products=$2 WHERE id=$1", [sale.id, JSON.stringify(sale.products)]);
  }
}
function metadata(p: OfflineProduct, catalogue: OfflineCatalogue) {
  const lifespanDays = catalogue.lifespans?.get(p.productId ?? 0) ?? 0;
  const capacityLitres = catalogue.capacities?.get(p.productId ?? 0) ?? 0;
  const unavailableReason = !p.productId ? "Custom product: catalogue filter registration is unavailable."
    : !catalogue.lifespans || !catalogue.capacities ? "Catalogue data is unavailable. Retry when connected."
    : lifespanDays <= 0 || !Number.isInteger(capacityLitres) || capacityLitres <= 0
      ? "This product has no confirmed catalogue filter lifespan and capacity." : null;
  return { lifespanDays, capacityLitres, unavailableReason };
}
export async function listOfflinePurchases(id: number, catalogue: OfflineCatalogue) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await account(client, id);
    const sales = (await client.query<Sale>(
      "SELECT * FROM uc_offline_clients WHERE companion_user_id=$1 ORDER BY id DESC FOR UPDATE", [id])).rows;
    const purchases = [];
    for (const sale of sales) {
      if (!owned(sale, id)) continue;
      await hydrate(client, sale);
       const registrations = (await client.query<{ id: number; offline_unit_id: string; activated_at: Date; active: boolean }>(
         "SELECT id, offline_unit_id, activated_at, active FROM uc_registered_filters WHERE offline_sale_id=$1 AND user_id=$2", [sale.id, id])).rows;
       const registered = new Set(registrations.map(r => r.offline_unit_id));
      purchases.push({
        source: "offline" as const, saleId: sale.id, saleDate: sale.sale_date, label: "Offline Sale",
        items: sale.products.map(p => ({
          lineId: p.lineId!, productId: p.productId ?? null, name: p.productName, quantity: p.quantity,
          ...metadata(p, catalogue), availableUnitIds: p.unitIds!.slice(0, p.quantity).filter(unit => !registered.has(unit))
            .slice(0, Math.max(0, p.quantity - p.unitIds!.filter(unit => registered.has(unit)).length)),
           registeredUnits: registrations.filter(r => p.unitIds!.includes(r.offline_unit_id)).map(r => ({
             registeredFilterId: r.id, unitId: r.offline_unit_id, installationDate: new Date(r.activated_at).toISOString().slice(0, 10), active: r.active,
           })),
        })),
      });
    }
    await client.query("COMMIT");
    return { purchases };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function registerOfflinePurchase(id: number, input: { saleId: number; unitId: string; installationDate: string }, catalogue: OfflineCatalogue) {
  const { saleId, unitId, installationDate } = input;
  if (!Number.isSafeInteger(saleId) || saleId <= 0 || typeof unitId !== "string" || unitId.length > 100 ||
    typeof installationDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(installationDate) ||
    !Number.isFinite(Date.parse(installationDate)) ||
    new Date(installationDate).toISOString().slice(0, 10) !== installationDate ||
    installationDate > new Date().toISOString().slice(0, 10))
    throw new OfflinePurchaseError("Choose a valid installation date, not in the future.", 400);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await account(client, id);
    const sale = (await client.query<Sale>("SELECT * FROM uc_offline_clients WHERE id=$1 FOR UPDATE", [saleId])).rows[0];
    if (!owned(sale, id)) throw new OfflinePurchaseError("Linked purchase not found.", 404);
    await hydrate(client, sale);
    const prior = (await client.query("SELECT * FROM uc_registered_filters WHERE offline_unit_id=$1", [unitId])).rows[0];
    if (prior) {
      if (prior.user_id !== id || prior.offline_sale_id !== saleId) throw new OfflinePurchaseError("Linked purchase not found.", 404);
      // Heal a lost response without resetting the original cycle or maintenance.
      await client.query("COMMIT");
      return registration(prior);
    }
    const p = sale.products.find(p => p.unitIds!.includes(unitId));
    if (!p) throw new OfflinePurchaseError("This purchase unit is no longer available.", 409);
    const count = Number((await client.query(
      "SELECT count(*) FROM uc_registered_filters WHERE offline_unit_id=ANY($1::text[])", [p.unitIds])).rows[0].count);
    // Units above the current quantity are retired, not new purchasable units.
    if (count >= p.quantity || !p.unitIds!.slice(0, p.quantity).includes(unitId))
      throw new OfflinePurchaseError("All available units on this line are registered.", 409);
    const meta = metadata(p, catalogue);
    if (meta.unavailableReason) throw new OfflinePurchaseError(meta.unavailableReason, !catalogue.lifespans || !catalogue.capacities ? 503 : 422);
    const row = (await client.query(
      `INSERT INTO uc_registered_filters(user_id,product_id,product_name,rated_capacity_litres,activated_at,source,offline_sale_id,offline_unit_id,offline_lifespan_days)
       VALUES($1,$2,$3,$4,$5,'offline',$6,$7,$8) RETURNING *`,
      [id, p.productId, p.productName, meta.capacityLitres, installationDate, saleId, unitId, meta.lifespanDays])).rows[0];
    await client.query("COMMIT");
    return registration(row, meta.lifespanDays);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
function registration(row: Record<string, any>, lifespanDays?: number) {
  return { registration: {
    id: row.id, userId: row.user_id, productId: row.product_id, productName: row.product_name,
    ratedCapacityLitres: row.rated_capacity_litres, activatedAt: new Date(row.activated_at).toISOString(),
     sourceOrderId: null, offlineUnitId: row.offline_unit_id, lifespanDays: row.offline_lifespan_days ?? lifespanDays,
     maintenanceCount: row.maintenance_count,
  } };
}