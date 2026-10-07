import { pool } from "@workspace/db";
import { activationEligibility, purchaseUnitIds } from "./activation-eligibility.js";

export type ActivationPurchase = {
  source: "app" | "store"; orderId: number; dateCreated: string; phone: string;
  status: string; items: {
    lineId: number; productId: number; name: string; quantity: number;
    lifespanDays: number; capacityLitres: number; availableUnitIds: string[];
    unavailableReason: string | null;
  }[];
};

export async function activationPurchaseOptions(accountId: number, email: string, catalogue: {
  lifespans: Map<number, number> | null; capacities: Map<number, number> | null;
}, remote: { enabled: boolean; fetch: (params: Record<string, string>) => Promise<Record<string, unknown>[] | null> }) {
  const local = (await pool.query("SELECT * FROM uc_orders WHERE user_id=$1 ORDER BY date_created DESC", [String(accountId)])).rows;
  const items = local.length ? (await pool.query("SELECT * FROM uc_order_items WHERE order_id=ANY($1::int[]) ORDER BY id", [local.map(o => o.id)])).rows : [];
  const registered = (await pool.query("SELECT source,source_order_id,product_id,source_unit_id FROM uc_registered_filters WHERE user_id=$1", [accountId])).rows;
  const registeredUnits = new Set(registered.map(r => r.source_unit_id).filter(Boolean));
  const legacy = new Set(registered.filter(r => !r.source_unit_id).map(r => `${r.source}:${r.source_order_id}:${r.product_id}`));
  function project(source: "app" | "store", orderId: number, dateCreated: string, phone: string, status: string,
    evidence: Parameters<typeof activationEligibility>[0], lines: { id: number; productId: number; name: string; quantity: number }[]): ActivationPurchase {
    const eligibility = activationEligibility(evidence, source);
    return { source, orderId, dateCreated, phone, status, items: lines.map(line => {
      const lifespanDays = catalogue.lifespans?.get(line.productId) ?? 0;
      const capacityLitres = catalogue.capacities?.get(line.productId) ?? 0;
      const units = purchaseUnitIds(source, orderId, line.id, line.quantity);
      const mirroredOrder = source === "app" ? local.find(o => o.id === orderId)?.wc_order_id : null;
      const mirrorRegistered = mirroredOrder && registered.some(r => r.source === "store" && r.source_order_id === mirroredOrder && r.product_id === line.productId);
      const unavailableReason = !eligibility.eligible ? eligibility.reason
        : !catalogue.lifespans || !catalogue.capacities ? "Catalogue unavailable. Retry when connected."
        : lifespanDays <= 0 || !Number.isInteger(capacityLitres) || capacityLitres <= 0 ? "This product has no confirmed filter lifespan and capacity."
        : !units.length ? "Purchase quantity requires staff review."
        : mirrorRegistered || legacy.has(`${source}:${orderId}:${line.productId}`) ? "An older or store-receipt registration exists. Contact the team to review remaining units." : null;
      return { lineId: line.id, productId: line.productId, name: line.name, quantity: line.quantity, lifespanDays, capacityLitres,
        unavailableReason, availableUnitIds: unavailableReason || legacy.has(`${source}:${orderId}:${line.productId}`) ? []
          : units.filter(unit => !registeredUnits.has(unit)) };
    }) };
  }
  const purchases = local.map(o => project("app", o.id, new Date(o.date_created).toISOString(), o.shipping_address?.phone ?? "", o.status,
    { status: o.status, paymentMethod: o.payment_method, checkoutState: o.checkout_state, paymentConfirmedAt: o.payment_confirmed_at,
      codCollectionStatus: o.cod_collection_status, customerStage: o.customer_stage },
    items.filter(i => i.order_id === o.id).map(i => ({ id: i.id, productId: i.product_id, name: i.name, quantity: i.quantity }))));
  // Local checkout is the authoritative unit identity for its Woo mirror.
  const mirrored = new Set(local.map(o => o.wc_order_id).filter(Boolean));
  const sourceErrors: { store?: string } = {};
  if (remote.enabled) {
    const mirrorIds = [...mirrored];
    for (let offset = 0; offset < mirrorIds.length; offset += 100) {
      const ids = mirrorIds.slice(offset, offset + 100);
      const rows = await remote.fetch({ include: ids.join(","), per_page: "100" }).catch(() => null);
      if (!rows) sourceErrors.store = "Store confirmation unavailable. Retry when connected.";
      for (const localOrder of local.filter(o => ids.includes(o.wc_order_id))) {
        const current = rows?.find(row => Number(row.id) === localOrder.wc_order_id);
        const evidence = current ? activationEligibility({ status: String(current.status), paymentMethod: localOrder.payment_method,
          checkoutState: localOrder.checkout_state, paymentConfirmedAt: localOrder.payment_confirmed_at,
          codCollectionStatus: localOrder.cod_collection_status, customerStage: localOrder.customer_stage }, "app")
          : { eligible: false, reason: "Store confirmation unavailable. Contact the team before activation." };
        if (!evidence.eligible) {
          for (const item of purchases.find(p => p.source === "app" && p.orderId === localOrder.id)!.items) {
            item.availableUnitIds = []; item.unavailableReason = evidence.reason;
          }
        }
      }
    }
    const storePurchases: ActivationPurchase[] = [];
    let complete = false;
    for (let page = 1; page <= 100; page++) {
      const rows = await remote.fetch({ search: email, per_page: "100", page: String(page), orderby: "date", order: "desc" }).catch(() => null);
      if (!rows) {
        sourceErrors.store = "Store purchases unavailable. Retry when connected. App purchases are shown independently.";
        break;
      }
      for (const o of rows) {
        const billing = (o.billing ?? {}) as Record<string, unknown>, shipping = (o.shipping ?? {}) as Record<string, unknown>;
        if (String(billing.email ?? "").trim().toLowerCase() !== email.trim().toLowerCase() || mirrored.has(Number(o.id))) continue;
        const phone = String(billing.phone || shipping.phone || "");
        storePurchases.push(project("store", Number(o.id), String(o.date_created ?? ""), phone, String(o.status ?? ""),
          { status: String(o.status ?? ""), paymentMethod: String(o.payment_method ?? ""), datePaid: o.date_paid },
          (Array.isArray(o.line_items) ? o.line_items : []).map((i: any) => ({ id: Number(i.id), productId: Number(i.product_id), name: String(i.name ?? ""), quantity: Number(i.quantity) }))));
      }
      if (rows.length < 100) { complete = true; break; }
    }
    if (complete) purchases.push(...storePurchases);
    else sourceErrors.store ??= "Store purchase history is incomplete. Contact support.";
  }
  return { purchases, sourceErrors };
}