import { createHash } from "node:crypto";
import { pool } from "@workspace/db";

export async function ensureCompanionHistorySchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_commerce_migration (
      key text PRIMARY KEY,state text NOT NULL DEFAULT 'pending_review',
      summary jsonb NOT NULL DEFAULT '{}',reviewed_by text,updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS uc_legacy_order_imports (
      woo_order_id integer PRIMARY KEY,digest text NOT NULL,local_order_id integer,
      state text NOT NULL,snapshot jsonb NOT NULL,reviewed_by text,
      imported_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS uc_legacy_customer_links (
      woo_customer_id integer PRIMARY KEY,user_id integer NOT NULL UNIQUE,
      reviewed_by text NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO uc_commerce_migration(key) VALUES('history') ON CONFLICT DO NOTHING;`);
}

type OwnerMapping = { wooCustomerId: number; userId: number; reviewed: true; reviewedBy: string };
export interface HistoryImportBundle {
  version: 1;
  sourceReviewed: true;
  reviewedBy: string;
  owners: OwnerMapping[];
  orders: Record<string, any>[];
  verifiedPayments?: Array<{ wooOrderId: number; reviewed: true; reviewedBy: string;
    kind: "provider_payment" | "cod_collection"; confirmedAt: string;
    reference: string; amount: string; currency: string }>;
}
function validId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
}
function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
  return Number.isNaN(Date.parse(normalized)) ? null : new Date(normalized).toISOString();
}
function digest(order: unknown): string {
  return createHash("sha256").update(JSON.stringify(order)).digest("hex");
}
export function reviewedImportPayment(bundle: HistoryImportBundle, order: Record<string, any>) {
  const evidence = (bundle.verifiedPayments ?? []).filter(p => p.wooOrderId === order.id);
  if (!evidence.length) return null;
  const p = evidence[0];
  if (evidence.length !== 1 || p.reviewed !== true || !p.reviewedBy?.trim() || !p.reference?.trim() ||
      !isoDate(p.confirmedAt) || !Number.isFinite(Number(p.amount)) ||
      Number(p.amount) !== Number(order.total) || p.currency !== order.currency ||
      p.kind !== (order.payment_method === "cod" ? "cod_collection" : "provider_payment")) {
    throw new Error("Payment evidence does not match this imported order.");
  }
  return { confirmedAt: isoDate(p.confirmedAt), reference: p.reference, kind: p.kind };
}

/** Offline reviewed snapshots only. Never contacts the store or sends mail.
 * Preview is read-only, including for unmatched orders. */
export async function importCompanionHistory(bundle: HistoryImportBundle, apply = false) {
  if (bundle?.version !== 1 || bundle.sourceReviewed !== true ||
      typeof bundle.reviewedBy !== "string" || !bundle.reviewedBy.trim() ||
      !Array.isArray(bundle.owners) || !Array.isArray(bundle.orders) ||
      bundle.orders.length > 20000) throw new Error("A reviewed version-1 export and ownership map are required.");
  const ownerIds = new Set<number>(), localIds = new Set<number>();
  for (const owner of bundle.owners) {
    if (!validId(owner.wooCustomerId) || !validId(owner.userId) || owner.reviewed !== true ||
        !owner.reviewedBy || ownerIds.has(owner.wooCustomerId) || localIds.has(owner.userId)) {
      throw new Error("Ownership mappings must be unique and explicitly reviewed; names/emails are not mappings.");
    }
    ownerIds.add(owner.wooCustomerId); localIds.add(owner.userId);
  }
  const client = await pool.connect();
  const summary = { imported: 0, alreadyImported: 0, unresolved: 0, conflicts: 0, eligible: 0 };
  try {
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    if (apply) await client.query("SELECT pg_advisory_xact_lock(872,1)");
    const active = await client.query("SELECT id FROM uc_users WHERE id=ANY($1::integer[]) AND deleted_at IS NULL", [[...localIds]]);
    const users = new Set(active.rows.map(r => Number(r.id)));
    const trusted = await client.query("SELECT woo_customer_id,user_id FROM uc_legacy_customer_links");
    const oldLinks = new Map(trusted.rows.map(r => [Number(r.woo_customer_id), Number(r.user_id)]));
    for (const owner of bundle.owners) {
      if (!users.has(owner.userId) || (oldLinks.has(owner.wooCustomerId) && oldLinks.get(owner.wooCustomerId) !== owner.userId) ||
          trusted.rows.some(r => Number(r.user_id) === owner.userId && Number(r.woo_customer_id) !== owner.wooCustomerId)) {
        throw new Error("Ownership conflicts or unavailable accounts must be reviewed before import.");
      }
      if (apply) await client.query("INSERT INTO uc_legacy_customer_links(woo_customer_id,user_id,reviewed_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [owner.wooCustomerId, owner.userId, owner.reviewedBy]);
    }
    const seen = new Set<number>();
    for (const raw of bundle.orders) {
      if (!validId(raw?.id) || seen.has(raw.id) || typeof raw.total !== "string" ||
          !Number.isFinite(Number(raw.total)) || Number(raw.total) < 0 ||
          typeof raw.currency !== "string" || !/^[A-Z]{3}$/.test(raw.currency) ||
          typeof raw.payment_method !== "string" || !Array.isArray(raw.line_items) ||
          raw.line_items.some((l: any) => !validId(l.product_id) || !validId(l.quantity) ||
            typeof l.name !== "string" || typeof l.total !== "string" ||
            !Number.isFinite(Number(l.total)) || Number(l.total) < 0) ||
          !isoDate(raw.date_created_gmt)) throw new Error("Invalid or duplicate order snapshot. No import was committed.");
      seen.add(raw.id);
      const hash = digest(raw);
      const prior = (await client.query("SELECT * FROM uc_legacy_order_imports WHERE woo_order_id=$1", [raw.id])).rows[0];
      if (prior?.state === "imported") {
        if (prior.digest !== hash) summary.conflicts++; else summary.alreadyImported++;
        continue;
      }
      if (prior && prior.digest !== hash) { summary.conflicts++; continue; }
      const owner = bundle.owners.find(o => o.wooCustomerId === raw.customer_id);
      const anchor = (await client.query("SELECT id,user_id,checkout_state FROM uc_orders WHERE wc_order_id=$1", [raw.id])).rows;
      // Existing anchors, particularly unknown payment attempts, are never
      // overwritten by an export. They require independent reconciliation.
      if (anchor.length || !owner || !users.has(owner.userId)) {
        summary.unresolved++;
        if (apply) await client.query(`INSERT INTO uc_legacy_order_imports(woo_order_id,digest,state,snapshot,reviewed_by)
          VALUES($1,$2,'pending_review',$3,$4) ON CONFLICT DO NOTHING`, [raw.id, hash, JSON.stringify(raw), bundle.reviewedBy]);
        continue;
      }
      summary.eligible++;
      const payment = reviewedImportPayment(bundle, raw);
      if (!apply) continue;
      const method = raw.payment_method;
      const paid = payment?.confirmedAt ?? null;
      // Neither a source status nor an automatically set Woo paid timestamp
      // proves provider settlement or actual COD cash collection.
      const paidStatus = method === "cod" ? payment ? "collected" : "awaiting_collection" : null;
      const shipping = raw.shipping ?? {}, billing = raw.billing ?? {};
      const collection = Array.isArray(raw.shipping_lines) && raw.shipping_lines.some((l: any) => l.method_id === "local_pickup");
      const address = { firstName: String(shipping.first_name ?? billing.first_name ?? ""),
        lastName: String(shipping.last_name ?? billing.last_name ?? ""),
        address1: String(shipping.address_1 ?? ""), address2: String(shipping.address_2 ?? ""),
        city: String(shipping.city ?? ""), country: String(shipping.country ?? ""),
        phone: String(shipping.phone ?? billing.phone ?? ""), fulfillment: collection ? "collection" : "delivery" };
      const inserted = await client.query(`INSERT INTO uc_orders(user_id,status,total,currency,payment_method,
        shipping_address,date_created,wc_order_id,payment_confirmed_at,cod_collection_status,
        checkout_state,checkout_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'legacy_imported',$11) RETURNING id`,
        [String(owner.userId), String(raw.status ?? "pending"), raw.total, raw.currency, method,
          JSON.stringify(address), isoDate(raw.date_created_gmt), raw.id, paid, paidStatus,
          JSON.stringify({ legacySource: "reviewed_woocommerce_export", digest: hash,
            legacySourcePaidAt: isoDate(raw.date_paid_gmt),
            reviewedPayment: payment,
            transactionId: typeof raw.transaction_id === "string" ? raw.transaction_id : null })]);
      const orderId = inserted.rows[0].id;
      for (const line of raw.line_items) await client.query(`INSERT INTO uc_order_items
        (order_id,product_id,name,quantity,total,variation_id,child_sku)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [orderId, line.product_id, line.name, line.quantity, line.total,
          validId(line.variation_id) ? line.variation_id : null, line.sku || null]);
      await client.query(`INSERT INTO uc_legacy_order_imports(woo_order_id,digest,local_order_id,state,snapshot,reviewed_by)
        VALUES($1,$2,$3,'imported',$4,$5) ON CONFLICT(woo_order_id) DO UPDATE
        SET local_order_id=EXCLUDED.local_order_id,state='imported'`,
        [raw.id, hash, orderId, JSON.stringify(raw), bundle.reviewedBy]);
      summary.imported++;
    }
    if (apply) await client.query(`UPDATE uc_commerce_migration SET state=$1,summary=$2,reviewed_by=$3,updated_at=now() WHERE key='history'`,
      [summary.unresolved || summary.conflicts ? "pending_review" : "snapshot_imported",
        JSON.stringify(summary), bundle.reviewedBy]);
    await client.query("COMMIT");
    return summary;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
