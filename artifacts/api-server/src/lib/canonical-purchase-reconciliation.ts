import type { PoolClient } from "pg";
import { pool } from "@workspace/db";

export const RECONCILIATION_REASONS = {
  CROSS_CUSTOMER: "cross_customer",
  KEY_COLLISION: "key_collision",
  AMOUNT_MISMATCH: "amount_mismatch",
  CURRENCY_MISMATCH: "currency_mismatch",
  PRODUCT_MISMATCH: "product_mismatch",
  WEAK_RECEIPT_MATCH: "weak_receipt_match",
  AMBIGUOUS_RECEIPT: "ambiguous_receipt",
  UNKNOWN_SOURCE_OWNER: "unknown_source_owner",
} as const;
export type ReconciliationReason =
  (typeof RECONCILIATION_REASONS)[keyof typeof RECONCILIATION_REASONS];

export type CanonicalPurchaseReconciliationInput = {
  orderId: number;
  correlationId?: string | null;
  /** Existing transaction client; the caller retains BEGIN/COMMIT/ROLLBACK. */
  client?: PoolClient;
};
export type CanonicalPurchaseReconciliationResult = {
  canonicalPurchaseId: number;
  created: boolean;
  repeated: boolean;
  conflictReasons: ReconciliationReason[];
};

type Order = {
  id: number; user_id: string; status: string; total: string; currency: string;
  payment_method: string; payment_reference: string | null; mpesa_receipt: string;
  discount_amount: number; date_created: Date | string; payment_confirmed_at: Date | string | null;
  wc_order_id: number | null;
  fulfillment_payment_status: string | null;
};
type Item = { id: number; product_id: number; name: string; quantity: number; total: string };
type Purchase = {
  id: number; customer_id: number | null; companion_order_id: number | null;
  woocommerce_order_id: number | null; payment_provider: string | null;
  payment_reference: string | null; receipt_number: string | null; currency: string;
  subtotal_minor: number | null; tax_minor: number | null; delivery_minor: number | null;
  discount_minor: number | null; total_minor: number;
};
type Line = {
  id: number; source_order_item_id: number | null; product_id: number;
  product_name: string; quantity: number; unit_total_minor: number | null; line_total_minor: number;
};

function minor(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw Object.assign(new Error("Invalid monetary amount"), { code: "INVALID_AMOUNT" });
  const result = Number(match[2]) * 100 + Number(`${match[3] ?? ""}00`.slice(0, 2));
  return match[1] === "-" ? -result : result;
}
function text(value: string | null | undefined): string | null {
  const result = value?.trim() ?? "";
  return result ? result : null;
}
function customer(value: string): number | null {
  // uc_orders.user_id is legacy text, so accept only its canonical decimal
  // representation. Never coerce snapshots, signs, whitespace, or exponents.
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 && result <= 2_147_483_647 ? result : null;
}
function providerStatus(order: Order): string {
  const status = order.status.toLowerCase();
  if (["dispatched", "shipped", "ready-to-collect", "delivered", "out-for-delivery"].includes(status) &&
      ["paid", "pending", "failed"].includes(order.fulfillment_payment_status ?? "")) {
    return order.fulfillment_payment_status!;
  }
  return order.payment_confirmed_at || ["processing", "completed", "paid"].includes(status)
    ? "paid" : ["failed", "cancelled"].includes(status) ? "failed" : "pending";
}
function fulfilmentStatus(order: Order): string {
  const status = order.status.toLowerCase();
  return ["completed", "delivered"].includes(status) ? "completed"
    : ["processing", "dispatched", "shipped", "ready-to-collect", "out-for-delivery"].includes(status) ? "processing" : "pending";
}
async function advisory(client: PoolClient, key: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}
async function conflict(
  client: PoolClient, purchaseId: number | null, orderId: number, reason: ReconciliationReason, key: string,
) {
  await client.query(
    `INSERT INTO uc_reconciliation_conflicts
       (conflict_type,canonical_purchase_id,source,source_reference,reason,priority)
     VALUES ('canonical_purchase',$1,'uc_orders',$2,$3,10)
     ON CONFLICT (source,source_reference,reason)
       WHERE status IN ('open','in_review') DO NOTHING`,
    [purchaseId, `order:${orderId}:${key}`, reason],
  );
}
function lineReasons(source: Item[], existing: Line[]): ReconciliationReason[] {
  const reasons = new Set<ReconciliationReason>();
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const byProduct = new Map(existing.map((line) => [
    `${line.product_id}:${normalize(line.product_name)}`, line,
  ]));
  const sourceKeys = new Set<string>();
  for (const item of source) {
    const key = `${item.product_id}:${normalize(item.name)}`;
    sourceKeys.add(key);
    const old = byProduct.get(key);
    if (!old) {
      if (existing.some((line) => line.line_total_minor === minor(item.total))) reasons.add(RECONCILIATION_REASONS.PRODUCT_MISMATCH);
      continue;
    }
    const total = minor(item.total)!;
    const unit = item.quantity > 0 && total % item.quantity === 0 ? total / item.quantity : null;
    if (old.product_id !== item.product_id || old.product_name !== item.name) reasons.add(RECONCILIATION_REASONS.PRODUCT_MISMATCH);
    if (old.quantity !== item.quantity || old.unit_total_minor !== unit || old.line_total_minor !== total) {
      reasons.add(RECONCILIATION_REASONS.AMOUNT_MISMATCH);
    }
  }
  if (existing.some((line) => !sourceKeys.has(`${line.product_id}:${normalize(line.product_name)}`))) {
    reasons.add(RECONCILIATION_REASONS.PRODUCT_MISMATCH);
  }
  return [...reasons];
}

/**
 * Reconciles a local order into the shadow projection. Strong-key ownership is
 * never transferred until every customer, amount, currency, and line check passes.
 */
export async function reconcileCanonicalPurchase(
  input: CanonicalPurchaseReconciliationInput,
): Promise<CanonicalPurchaseReconciliationResult> {
  if (!Number.isInteger(input.orderId) || input.orderId <= 0) {
    throw Object.assign(new Error("A valid order id is required"), { code: "INVALID_ORDER_ID" });
  }
  const ownsTransaction = !input.client;
  const client = input.client ?? await pool.connect();
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const orderResult = await client.query<Order>(
      `SELECT id,user_id,status,total,currency,payment_method,payment_reference,mpesa_receipt,
              discount_amount,date_created,payment_confirmed_at,wc_order_id,fulfillment_payment_status
       FROM uc_orders WHERE id=$1 FOR UPDATE`, [input.orderId],
    );
    const order = orderResult.rows[0];
    if (!order) throw Object.assign(new Error("Order not found"), { code: "ORDER_NOT_FOUND" });
    const sourceCustomer = customer(order.user_id);
    const sourceCurrency = (order.currency || "KES").trim().toUpperCase();
    const sourceTotal = minor(order.total)!;
    const sourceProvider = text(order.payment_method);
    const sourceReference = text(order.payment_reference);
    const receipt = text(order.mpesa_receipt)?.toUpperCase() ?? null;
    // Receipt trust is server-derived, never accepted from a caller.
    const receiptTrust = receipt && order.payment_confirmed_at && sourceProvider
      ? "trusted" : receipt ? "untrusted" : "absent";
    const locks = [
      `canonical:order:${order.id}`,
      ...(order.wc_order_id ? [`canonical:woo:${order.wc_order_id}`] : []),
      ...(sourceProvider && sourceReference ? [`canonical:provider:${sourceProvider.toLowerCase()}:${sourceReference.toUpperCase()}`] : []),
      ...(receipt ? [`canonical:receipt:${receipt}`] : []),
    ].sort();
    for (const key of locks) await advisory(client, key);
    const items = (await client.query<Item>(
      `SELECT id,product_id,name,quantity,total FROM uc_order_items WHERE order_id=$1 ORDER BY id FOR UPDATE`, [order.id],
    )).rows;

    // Deliberately return every match: a second matching key is a collision, not a reason to pick LIMIT 1.
    const matches = (await client.query<Purchase>(
      `SELECT id,customer_id,companion_order_id,woocommerce_order_id,payment_provider,
              payment_reference,receipt_number,currency,subtotal_minor,tax_minor,
              delivery_minor,discount_minor,total_minor
       FROM uc_canonical_purchases
       WHERE companion_order_id=$1
          OR ($2::integer IS NOT NULL AND woocommerce_order_id=$2)
          OR ($3::text IS NOT NULL AND $4::text IS NOT NULL
              AND lower(payment_provider)=lower($3) AND upper(payment_reference)=upper($4))
          OR ($5::text IS NOT NULL AND upper(receipt_number)=upper($5))
       ORDER BY id FOR UPDATE`,
      [order.id, order.wc_order_id, sourceProvider, sourceReference, receipt],
    )).rows;
    const strong = matches.filter((row) =>
      row.companion_order_id === order.id ||
      (order.wc_order_id !== null && row.woocommerce_order_id === order.wc_order_id) ||
      (sourceProvider !== null && sourceReference !== null &&
        row.payment_provider?.toLowerCase() === sourceProvider.toLowerCase() &&
        row.payment_reference?.toUpperCase() === sourceReference.toUpperCase()),
    );
    const strongIds = [...new Set(strong.map((row) => row.id))].sort((a, b) => a - b);
    const receiptMatches = receipt ? matches.filter((row) => row.receipt_number?.toUpperCase() === receipt) : [];
    const matchedKeys = new Map<number, Set<string>>();
    for (const row of strong) {
      const keys = matchedKeys.get(row.id) ?? new Set<string>();
      if (row.companion_order_id === order.id) keys.add("companion");
      if (order.wc_order_id !== null && row.woocommerce_order_id === order.wc_order_id) keys.add("woo");
      if (sourceProvider && sourceReference &&
        row.payment_provider?.toLowerCase() === sourceProvider.toLowerCase() &&
        row.payment_reference?.toUpperCase() === sourceReference.toUpperCase()) keys.add("provider");
      matchedKeys.set(row.id, keys);
    }
    // Receipt is a candidate key only after server-side trust classification.
    if (receiptTrust === "trusted") {
      for (const row of receiptMatches) {
        const keys = matchedKeys.get(row.id) ?? new Set<string>();
        keys.add("trusted_receipt");
        matchedKeys.set(row.id, keys);
      }
    }
    const candidateIds = [...matchedKeys.keys()].sort((a, b) => a - b);
    const receiptOutsideStrong = receiptMatches.filter((row) => !strongIds.includes(row.id));
    const reasons: ReconciliationReason[] = [];
    if (candidateIds.length > 1) {
      for (const id of candidateIds) {
        await conflict(client, id, order.id, RECONCILIATION_REASONS.KEY_COLLISION, `candidate-split:${id}`);
      }
      if (ownsTransaction) await client.query("COMMIT");
      return { canonicalPurchaseId: candidateIds[0]!, created: false, repeated: true, conflictReasons: [RECONCILIATION_REASONS.KEY_COLLISION] };
    }
    if ((receiptOutsideStrong.length && (strongIds.length > 0 || receiptTrust !== "trusted")) ||
      (receiptTrust !== "trusted" && receiptMatches.some((row) => !strongIds.includes(row.id)))) {
      const reason = receiptMatches.length > 1 || receiptTrust !== "trusted"
        ? RECONCILIATION_REASONS.AMBIGUOUS_RECEIPT : RECONCILIATION_REASONS.WEAK_RECEIPT_MATCH;
      for (const row of receiptOutsideStrong) await conflict(client, row.id, order.id, reason, `receipt:${receipt}:${row.id}`);
      reasons.push(reason);
    }
    // A trusted receipt is a fallback key only: exactly one row and no
    // competing strong key may select it, and normal compatibility checks
    // below still have to pass before it can gain a companion link.
    let candidate = strong[0];
    if (!candidate && receiptTrust === "trusted" && receiptMatches.length === 1) {
      candidate = receiptMatches[0];
    } else if (!candidate && receiptMatches.length > 1) {
      reasons.push(RECONCILIATION_REASONS.AMBIGUOUS_RECEIPT);
    }
    let existingLines: Line[] = [];
    if (candidate) {
      existingLines = (await client.query<Line>(
        `SELECT id,source_order_item_id,product_id,product_name,quantity,unit_total_minor,line_total_minor
         FROM uc_canonical_purchase_lines WHERE purchase_id=$1 ORDER BY id FOR UPDATE`, [candidate.id],
      )).rows;
      if (candidate.customer_id !== null && sourceCustomer !== null && candidate.customer_id !== sourceCustomer) reasons.push(RECONCILIATION_REASONS.CROSS_CUSTOMER);
      if (candidate.customer_id !== null && sourceCustomer === null) {
        reasons.push(RECONCILIATION_REASONS.UNKNOWN_SOURCE_OWNER, RECONCILIATION_REASONS.CROSS_CUSTOMER);
      }
      // Refreshing the same unresolved source does not claim customer ownership.
      // Unresolved identities still cannot adopt a purchase selected by another key.
      if (candidate.customer_id === null && sourceCustomer === null && candidate.companion_order_id !== order.id) {
        reasons.push(RECONCILIATION_REASONS.UNKNOWN_SOURCE_OWNER);
      }
      if (candidate.woocommerce_order_id !== null && order.wc_order_id !== null &&
        candidate.woocommerce_order_id !== order.wc_order_id) reasons.push(RECONCILIATION_REASONS.KEY_COLLISION);
      if (candidate.payment_reference && sourceReference &&
        (candidate.payment_provider?.toLowerCase() !== sourceProvider?.toLowerCase() ||
          candidate.payment_reference.toUpperCase() !== sourceReference.toUpperCase())) {
        reasons.push(RECONCILIATION_REASONS.KEY_COLLISION);
      }
      if (candidate.total_minor !== sourceTotal) reasons.push(RECONCILIATION_REASONS.AMOUNT_MISMATCH);
      if (candidate.currency.toUpperCase() !== sourceCurrency) reasons.push(RECONCILIATION_REASONS.CURRENCY_MISMATCH);
      if (candidate.companion_order_id !== order.id) {
        reasons.push(...lineReasons(items, existingLines));
      }
      if (candidate.companion_order_id !== null && candidate.companion_order_id !== order.id) {
        reasons.push(RECONCILIATION_REASONS.KEY_COLLISION);
      }
      if (reasons.length) {
        for (const reason of [...new Set(reasons)]) await conflict(client, candidate.id, order.id, reason, `candidate:${candidate.id}`);
      if (ownsTransaction) await client.query("COMMIT");
        return { canonicalPurchaseId: candidate.id, created: false, repeated: true, conflictReasons: [...new Set(reasons)] };
      }
    }
    const discount = minor(order.discount_amount);
    let purchaseId: number;
    let created = false;
    const snapshot = JSON.stringify({ customerId: sourceCustomer, source: "uc_orders", orderId: order.id });
    if (candidate) {
      purchaseId = candidate.id;
      await client.query(
        `UPDATE uc_canonical_purchases
         SET customer_id=COALESCE(customer_id,$2),companion_order_id=COALESCE(companion_order_id,$3),
             woocommerce_order_id=COALESCE(woocommerce_order_id,$4),payment_provider=COALESCE(payment_provider,$5),
             payment_reference=COALESCE(payment_reference,$6),receipt_number=COALESCE(receipt_number,$7),
           currency=$8,discount_minor=$9,total=$17,total_minor=$10,payment_status=$11,fulfilment_status=$12,
             identity_snapshot=$13::jsonb,correlation_id=COALESCE(correlation_id,$14),
             source_created_at=$15,source_updated_at=$16,updated_at=now() WHERE id=$1`,
        [purchaseId, sourceCustomer, order.id, order.wc_order_id, sourceProvider, sourceReference, receipt,
          sourceCurrency, discount, sourceTotal, providerStatus(order), fulfilmentStatus(order), snapshot,
           input.correlationId ?? null, order.date_created, order.payment_confirmed_at ?? order.date_created, order.total],
      );
    } else {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO uc_canonical_purchases
         (customer_id,companion_order_id,woocommerce_order_id,payment_provider,payment_reference,receipt_number,
          currency,discount_minor,total,total_minor,payment_status,fulfilment_status,identity_snapshot,correlation_id,
          source_created_at,source_updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16) RETURNING id`,
         [sourceCustomer, order.id, order.wc_order_id, sourceProvider, sourceReference, receipt, sourceCurrency,
          discount, order.total, sourceTotal, providerStatus(order), fulfilmentStatus(order), snapshot,
          input.correlationId ?? null, order.date_created, order.payment_confirmed_at ?? order.date_created],
      );
      purchaseId = inserted.rows[0]!.id;
      created = true;
    }
    const subtotal = items.reduce((sum, item) => sum + minor(item.total)!, 0);
    const delivery = sourceTotal + (discount ?? 0) - subtotal;
    await client.query(
      "UPDATE uc_canonical_purchases SET subtotal_minor=$2, tax_minor=NULL, delivery_minor=$3 WHERE id=$1",
      [purchaseId, subtotal, delivery >= 0 ? delivery : null],
    );
    // The authoritative source owns the complete set. Delete first so NULL
    // imported rows and removed source rows cannot survive a refresh.
    await client.query("DELETE FROM uc_canonical_purchase_lines WHERE purchase_id=$1", [purchaseId]);
    for (const item of items) {
      const total = minor(item.total)!;
      const unit = item.quantity > 0 && total % item.quantity === 0 ? total / item.quantity : null;
      await client.query(
        `INSERT INTO uc_canonical_purchase_lines
          (purchase_id,source_order_item_id,product_id,product_name,quantity,unit_total_minor,line_total,line_total_minor)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (source_order_item_id) WHERE source_order_item_id IS NOT NULL DO UPDATE
         SET purchase_id=EXCLUDED.purchase_id,product_id=EXCLUDED.product_id,product_name=EXCLUDED.product_name,
              quantity=EXCLUDED.quantity,unit_total_minor=EXCLUDED.unit_total_minor,line_total=EXCLUDED.line_total,
              line_total_minor=EXCLUDED.line_total_minor`,
        [purchaseId, item.id, item.product_id, item.name, item.quantity, unit, item.total, total],
      );
    }
    if (ownsTransaction) await client.query("COMMIT");
    return { canonicalPurchaseId: purchaseId, created, repeated: !created, conflictReasons: reasons };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}