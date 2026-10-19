import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { normalizeEmail, normalizePhone } from "./customer-identity.js";
import { resolveCustomerIdentity } from "./customer-identity-resolution.js";
import { logger } from "./logger.js";
import { getProductCapacityMap, getProductLifespanMap, hasWCCredentials, wcFetchArray } from "../routes/uc.js";
import { ensureAssignmentWooSource } from "./assignment-woo-source.js";

export class AssignmentError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
export interface AssignmentInput {
  idempotencyKey: string; customerName: string; email: string; phone: string;
  productId: number; installationDate: string; orderId: number; orderItemId: number;
  targetAccountId?: number;
}
type Assignment = {
  id: number; email: string; phone: string; customer_name: string; product_id: number;
  product_name: string; lifespan_days: number; capacity_litres: number;
  installation_date: string | Date; order_id: number; order_item_id: number;
  target_account_id: number | null; linked_account_id: number | null; filter_id: number | null;
  status: string; review_reason: string | null; idempotency_key: string;
  woo_order_item_id: number | null;
};
type SourceLine = {
  id: number; user_id: string; status: string; payment_method: string;
  cod_collection_status: string | null; wc_order_id: number | null;
  item_id: number; product_id: number; name: string; quantity: number;
  woo_customer_id?: number; woo_email?: string;
  woo_order_item_id?: number;
};
const eligibleStatuses = new Set(["processing", "completed", "on-hold", "shipped", "delivered"]);

export function normalizedAssignment(input: AssignmentInput): AssignmentInput {
  const phone = normalizePhone(input.phone), email = normalizeEmail(input.email);
  if (!phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !input.customerName?.trim())
    throw new AssignmentError("INVALID_CONTACT", "Enter a name, valid email and international phone.", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.installationDate) ||
      !Number.isFinite(Date.parse(input.installationDate)) ||
      new Date(input.installationDate).toISOString().slice(0, 10) !== input.installationDate ||
      input.installationDate > new Date().toISOString().slice(0, 10))
    throw new AssignmentError("INVALID_DATE", "Choose a valid installation date, not in the future.", 400);
  if (![input.productId, input.orderId, input.orderItemId].every(v => Number.isInteger(v) && v > 0) ||
      (input.targetAccountId !== undefined && (!Number.isInteger(input.targetAccountId) || input.targetAccountId <= 0)) ||
      !input.idempotencyKey?.trim() || input.idempotencyKey.length > 100 ||
      input.customerName.length > 200 || email.length > 320)
    throw new AssignmentError("INVALID_INPUT", "Select an existing COD order, line and filter.", 400);
  return { ...input, email, phone, customerName: input.customerName.trim() };
}

async function sourceLine(client: PoolClient, orderId: number, itemId: number): Promise<SourceLine> {
  const order = (await client.query<SourceLine>(
    `SELECT o.*, i.id AS item_id,i.product_id,i.name,i.quantity
     FROM uc_orders o JOIN uc_order_items i ON i.order_id=o.id
     WHERE o.id=$1 AND i.id=$2 FOR UPDATE OF o,i`, [orderId, itemId])).rows[0];
  if (!order) throw new AssignmentError("SOURCE_NOT_FOUND", "That order line is not in the durable order ledger.", 404);
  if (order.payment_method !== "cod" || !eligibleStatuses.has(order.status) || order.quantity < 1)
    throw new AssignmentError("INELIGIBLE_ORDER", "Only an existing eligible cash-on-delivery purchase can be assigned.");
  const duplicates = await client.query("SELECT id FROM uc_order_items WHERE order_id=$1 AND product_id=$2", [orderId,order.product_id]);
  if (duplicates.rowCount !== 1)
    throw new AssignmentError("AMBIGUOUS_ORDER_LINE", "Duplicate product lines require purchase review before a filter can be assigned.");
  // Never treat a local Woo mirror as authority when the source is unavailable.
  if (order.wc_order_id) {
    if (!hasWCCredentials()) throw new AssignmentError("SOURCE_UNAVAILABLE", "The WooCommerce source is unavailable.", 503);
    const orders = await wcFetchArray("/orders", { include: String(order.wc_order_id) }, AbortSignal.timeout(15000));
    if (!orders) throw new AssignmentError("SOURCE_UNAVAILABLE", "WooCommerce could not verify this purchase. Retry later.", 503);
    const remote = orders.find(o => Number(o["id"]) === order.wc_order_id);
    const lines = remote?.["line_items"] as { id: number; product_id: number; quantity: number }[] | undefined;
    if (!remote || remote["payment_method"] !== "cod" || !eligibleStatuses.has(String(remote["status"])) ||
        !Array.isArray(lines) || lines.filter(i => i.product_id === order.product_id && i.quantity >= order.quantity).length !== 1)
      throw new AssignmentError("SOURCE_CONFLICT", "The WooCommerce COD source or its product lines do not match the ledger.");
    order.woo_customer_id = Number(remote["customer_id"] ?? 0);
    order.woo_email = normalizeEmail(String((remote["billing"] as Record<string, unknown> | undefined)?.["email"] ?? ""));
    order.woo_order_item_id = Number(lines.find(i => i.product_id === order.product_id)!.id);
    if (!Number.isSafeInteger(order.woo_order_item_id) || order.woo_order_item_id <= 0)
      throw new AssignmentError("SOURCE_CONFLICT", "WooCommerce did not supply a durable order-line identity.");
  }
  return order;
}

async function ownershipReason(client: PoolClient, order: SourceLine, accountId?: number, contactEmail?: string): Promise<string | null> {
  // A nonempty principal is never assumed to be an unowned guest. Numeric,
  // email and legacy principals must resolve explicitly or go to staff review.
  if (order.user_id && order.user_id !== "guest" && order.user_id !== "0") {
    const owner = (await client.query<{ id: number; deleted_at: Date | null }>(
      "SELECT id,deleted_at FROM uc_users WHERE id::text=$1 OR email=$1", [order.user_id])).rows;
    if (owner.length === 0 && normalizeEmail(order.user_id) === contactEmail) {
      // A genuine guest email principal is unowned, not an existing account.
    } else {
      if (owner.length !== 1) return "unresolved_purchase_owner";
      if (owner[0]!.deleted_at) return "deleted_purchase_owner";
      if (owner[0]!.id !== accountId) return "purchase_owned_by_another_account";
    }
  }
  if (order.woo_email) {
    const remoteOwners = (await client.query<{ id: number; deleted_at: Date | null }>(
      "SELECT id,deleted_at FROM uc_users WHERE email=$1", [order.woo_email])).rows;
    if (remoteOwners.some(u => u.deleted_at)) return "deleted_woo_owner";
    if (remoteOwners.some(u => u.id !== accountId)) return "woo_purchase_owner_conflict";
    if (order.woo_customer_id && order.woo_email !== contactEmail) return "woo_purchase_owner_conflict";
  } else if (order.woo_customer_id) {
    return "unresolved_woo_owner";
  }
  const canonical = (await client.query<{ customer_id: number | null }>(
    `SELECT customer_id FROM uc_canonical_purchases
     WHERE companion_order_id=$1 OR ($2::integer IS NOT NULL AND woocommerce_order_id=$2) FOR UPDATE`,
    [order.id, order.wc_order_id])).rows;
  if (canonical.some(p => p.customer_id !== null && p.customer_id !== accountId)) return "canonical_purchase_owner_conflict";
  const filters = (await client.query<{ user_id: number }>(
    `SELECT user_id FROM uc_registered_filters
     WHERE (source='app' AND source_order_id=$1)
        OR (source='store' AND $2::integer IS NOT NULL AND source_order_id=$2) FOR UPDATE`,
    [order.id, order.wc_order_id])).rows;
  if (filters.some(f => f.user_id !== accountId)) return "filter_owned_by_another_account";
  const reservations = (await client.query<{ linked_account_id: number | null; target_account_id: number | null; email: string; phone: string }>(
    "SELECT linked_account_id,target_account_id,email,phone FROM uc_customer_assignments WHERE order_id=$1",
    [order.id])).rows;
  if (accountId && reservations.some(a =>
    (a.linked_account_id !== null && a.linked_account_id !== accountId) ||
    (a.target_account_id !== null && a.target_account_id !== accountId))) return "order_assignment_owner_conflict";
  return null;
}

async function audit(client: PoolClient, id: number, actor: string, action: string, details: Record<string, unknown> = {}) {
  await client.query("INSERT INTO uc_customer_assignment_audit(assignment_id,actor,action,details) VALUES($1,$2,$3,$4)", [id, actor, action, details]);
}

export async function previewAssignment(raw: AssignmentInput) {
  const input = normalizedAssignment(raw);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const identity = await resolveCustomerIdentity(input, client);
    const order = await sourceLine(client, input.orderId, input.orderItemId);
    const [lifespans, capacities] = await Promise.all([getProductLifespanMap(), getProductCapacityMap()]);
    if (order.product_id !== input.productId || !lifespans?.has(input.productId) || !capacities?.has(input.productId))
      throw new AssignmentError("CATALOGUE_UNAVAILABLE", "The selected line must be a trackable catalogue filter with known capacity and lifespan.", 503);
    const reason = await ownershipReason(client, order, input.targetAccountId, input.email);
    if (reason) throw new AssignmentError("OWNERSHIP_CONFLICT", reason.replaceAll("_", " "));
    if (input.targetAccountId && (identity.kind !== "one_active_candidate" || identity.customerId !== input.targetAccountId))
      throw new AssignmentError("CONTACT_CONFLICT", "The selected account must match these contacts without deleted or conflicting identities.");
    return { input, order, identity, productName: order.name, lifespanDays: lifespans.get(input.productId)!,
      capacityLitres: capacities.get(input.productId)!, cashCollectionState: order.cod_collection_status ?? "unknown" };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined); client.release();
  }
}

export async function createAssignment(raw: AssignmentInput, actor: string) {
  const normalized = normalizedAssignment(raw);
  // A lost response followed by an exact replay must work even after linking
  // changed the source's owner. No write or extra audit event on that path.
  const replay = (await pool.query<Assignment>(
    "SELECT * FROM uc_customer_assignments WHERE idempotency_key=$1", [normalized.idempotencyKey])).rows[0];
  if (replay) {
    if (!sameReservation(replay, normalized))
      throw new AssignmentError("DUPLICATE_CONFLICT", "This key already has a different assignment.");
    return replay.id;
  }
  const preview = await previewAssignment(normalized), input = preview.input;
  const client = await pool.connect();
  let id: number;
  try {
    await client.query("BEGIN");
    await resolveCustomerIdentity(input, client);
    const order = await sourceLine(client, input.orderId, input.orderItemId);
    const reason = await ownershipReason(client, order, input.targetAccountId, input.email);
    if (reason) throw new AssignmentError("OWNERSHIP_CONFLICT", reason.replaceAll("_", " "));
    const existing = (await client.query<Assignment>(
      "SELECT * FROM uc_customer_assignments WHERE idempotency_key=$1 OR order_item_id=$2 FOR UPDATE",
      [input.idempotencyKey, input.orderItemId])).rows[0];
    if (existing) {
      if (!sameReservation(existing, input))
        throw new AssignmentError("DUPLICATE_CONFLICT", "This key or purchase line already has a different assignment.");
      id = existing.id;
    } else {
      id = (await client.query<{ id: number }>(`INSERT INTO uc_customer_assignments
        (idempotency_key,customer_name,email,phone,product_id,product_name,lifespan_days,capacity_litres,
         installation_date,order_id,order_item_id,target_account_id,created_by,review_reason,status,woo_order_item_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [input.idempotencyKey,input.customerName,input.email,input.phone,input.productId,preview.productName,
        preview.lifespanDays,preview.capacityLitres,input.installationDate,input.orderId,input.orderItemId,
        input.targetAccountId ?? null,actor,
        preview.identity.kind === "create_allowed" ? "awaiting_account" :
          preview.identity.kind === "one_active_candidate" ? "awaiting_verified_contacts" : preview.identity.kind,
        ["create_allowed", "one_active_candidate"].includes(preview.identity.kind) ? "pending" : "review",
        order.woo_order_item_id ?? null])).rows[0]!.id;
      await audit(client,id,actor,"created", { contactSnapshot: { name: input.customerName, email: input.email, phone: input.phone } });
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
  // Saving a reservation never releases assets, including when a target was selected.
  return id;
}

export async function linkAssignment(id: number, accountId: number | undefined, actor: string, staffConfirmed = false) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Contact locks must precede row locks, matching public identity writes.
    const initial = (await client.query<Assignment>("SELECT * FROM uc_customer_assignments WHERE id=$1", [id])).rows[0];
    if (!initial) throw new AssignmentError("NOT_FOUND", "Assignment not found.", 404);
    const identity = await resolveCustomerIdentity(initial, client);
    const assignment = (await client.query<Assignment>("SELECT * FROM uc_customer_assignments WHERE id=$1 FOR UPDATE", [id])).rows[0]!;
    if (assignment.status === "linked") {
      if (accountId && assignment.linked_account_id !== accountId)
        throw new AssignmentError("ALREADY_LINKED", "This assignment belongs to another account.");
      await client.query("COMMIT"); return;
    }
    // Account deletion erases its contacts. This durable marker prevents a
    // later account using the same contacts from bypassing deleted ambiguity.
    let reason: string | null = assignment.review_reason === "deleted_account_ambiguity" ? "deleted_account_ambiguity" : null;
    if (!reason && identity.kind !== "one_active_candidate") reason = identity.kind === "create_allowed" ? "awaiting_account" : identity.kind;
    const targetId = accountId ?? (identity.kind === "one_active_candidate" ? identity.customerId : undefined);
    if (!reason && identity.kind === "one_active_candidate" && identity.customerId !== targetId) reason = "contact_conflict";
    if (assignment.target_account_id && targetId !== assignment.target_account_id) reason = "target_account_conflict";
    if (targetId) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`uc-account:${targetId}`]);
    const account = targetId ? (await client.query<{ email: string; phone: string; email_verified: boolean; phone_verified: boolean; deleted_at: Date | null }>(
      "SELECT * FROM uc_users WHERE id=$1 FOR UPDATE", [targetId])).rows[0] : undefined;
    if (!reason && (!account || account.deleted_at)) reason = "deleted_or_missing_account";
    if (!reason && account && (normalizeEmail(account.email) !== assignment.email || normalizePhone(account.phone) !== assignment.phone))
      reason = "contact_conflict";
    // Both saved contacts must be proven. One verified contact cannot authorize
    // a purchase reserved for another phone/email, even on provider sign-in.
    if (!reason && !staffConfirmed && (!account?.email_verified || !account?.phone_verified)) reason = "awaiting_verified_contacts";
    if (!reason) {
      try {
        const order = await sourceLine(client, assignment.order_id, assignment.order_item_id);
        reason = await ownershipReason(client, order, targetId, assignment.email);
        if (!reason && order.product_id !== assignment.product_id) reason = "source_product_changed";
        if (!reason && assignment.woo_order_item_id && assignment.woo_order_item_id !== order.woo_order_item_id)
          reason = "source_order_line_changed";
        if (!reason) {
          // Every line of a COD order must remain with one customer.
          const others = (await client.query<{ email: string; phone: string }>(
            "SELECT email,phone FROM uc_customer_assignments WHERE order_id=$1 AND id<>$2", [order.id,id])).rows;
          if (others.some(a => a.email !== assignment.email || a.phone !== assignment.phone)) reason = "order_contact_conflict";
        }
        if (!reason) {
          const source = order.wc_order_id ? "store" : "app", sourceId = order.wc_order_id ?? order.id;
          const prior = (await client.query<{ id: number; user_id: number }>(
            `SELECT id,user_id FROM uc_registered_filters WHERE product_id=$1
             AND ((source='app' AND source_order_id=$2) OR (source='store' AND source_order_id=$3)) FOR UPDATE`,
             [assignment.product_id,order.id,order.wc_order_id])).rows;
          if (prior.length > 1 || prior.some(f => f.user_id !== targetId)) reason = "filter_owner_conflict";
          else {
            const canonicalLine = (await client.query<{ id: number }>(
              "SELECT id FROM uc_canonical_purchase_lines WHERE source_order_item_id=$1", [assignment.order_item_id])).rows[0];
            const filterId = prior[0]?.id ?? (await client.query<{ id: number }>(
              `INSERT INTO uc_registered_filters(user_id,product_id,product_name,rated_capacity_litres,
                activated_at,source_order_id,source,canonical_purchase_line_id)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
              [targetId,assignment.product_id,assignment.product_name,assignment.capacity_litres,
                dateOnly(assignment.installation_date),sourceId,source,canonicalLine?.id ?? null])).rows[0]!.id;
            // Association only: no status pipeline, settlement, rewards, or impact writes.
            await client.query("UPDATE uc_orders SET user_id=$1 WHERE id=$2", [String(targetId),order.id]);
            await client.query(`UPDATE uc_canonical_purchases SET customer_id=$1
              WHERE (companion_order_id=$2 OR ($3::integer IS NOT NULL AND woocommerce_order_id=$3)) AND customer_id IS NULL`,
              [targetId,order.id,order.wc_order_id]);
            await client.query(`UPDATE uc_customer_assignments SET status='linked',review_reason=NULL,
              linked_account_id=$2,filter_id=$3,linked_at=now() WHERE id=$1`, [id,targetId,filterId]);
            await audit(client,id,actor,staffConfirmed ? "staff_linked" : "verified_contact_linked", { accountId: targetId, filterId });
          }
        }
      } catch (error) {
        if (!(error instanceof AssignmentError)) throw error;
        reason = error.code === "SOURCE_UNAVAILABLE" ? "source_unavailable_retryable" : error.code.toLowerCase();
      }
    }
    if (reason) {
      const status = ["awaiting_account", "awaiting_verified_contacts", "source_unavailable_retryable"].includes(reason) ? "pending" : "review";
      await client.query("UPDATE uc_customer_assignments SET status=$2,review_reason=$3 WHERE id=$1", [id,status,reason]);
      if (assignment.review_reason !== reason || assignment.status !== status)
        await audit(client,id,actor,"link_deferred", { reason });
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

const reconciliationInFlight = new Map<number, Promise<void>>();
/** Signup queues this without delaying its success; authenticated reads retry. */
export function reconcileAssignmentsForAccount(accountId: number): Promise<void> {
  const running = reconciliationInFlight.get(accountId);
  if (running) return running;
  const work = reconcileAccount(accountId);
  reconciliationInFlight.set(accountId,work);
  void work.finally(() => { if (reconciliationInFlight.get(accountId) === work) reconciliationInFlight.delete(accountId); });
  return work;
}
async function reconcileAccount(accountId: number) {
  try {
    const rows = (await pool.query<{ id: number }>(
      `SELECT a.id FROM uc_customer_assignments a JOIN uc_users u
       ON (a.email=u.email OR a.phone=u.phone) WHERE u.id=$1 AND u.deleted_at IS NULL AND a.status<>'linked'
       ORDER BY a.id LIMIT 100`, [accountId])).rows;
     const deadline = Date.now() + 5000;
     for (const row of rows) {
       if (Date.now() > deadline) break;
       await linkAssignment(row.id, accountId, "verified-account-refresh");
     }
  } catch { logger.warn({ accountId, event: "assignment_retry_deferred" }, "Customer assignments remain pending for retry"); }
}

type AssignmentReadParams = { page: number; limit: number; status?: string; q?: string };

async function readAssignments(accountId?: number, assignmentId?: number, paging?: AssignmentReadParams) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (accountId !== undefined) clauses.push(`a.linked_account_id=${bind(accountId)} AND a.status='linked'`);
  if (assignmentId !== undefined) clauses.push(`a.id=${bind(assignmentId)}`);
  if (paging?.status) clauses.push(`a.status=${bind(paging.status)}`);
  if (paging?.q) {
    const term = bind(`%${paging.q.replace(/[\\%_]/g, "\\$&")}%`);
    clauses.push(`(a.customer_name ILIKE ${term} OR a.email ILIKE ${term} OR a.phone ILIKE ${term})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = paging ? Number((await pool.query(`SELECT count(*) FROM uc_customer_assignments a ${where}`, values)).rows[0].count) : 0;
  const bounds = paging ? `LIMIT ${bind(paging.limit)} OFFSET ${bind((paging.page - 1) * paging.limit)}` : "";
  const result = await pool.query(
    `SELECT a.*, o.wc_order_id,o.cod_collection_status, f.activated_at,f.maintenance_count,f.active
     FROM uc_customer_assignments a JOIN uc_orders o ON o.id=a.order_id
     LEFT JOIN uc_registered_filters f ON f.id=a.filter_id
     ${where}
     ORDER BY a.id DESC ${bounds}`, values);
  const items = result.rows.map(r => ({
    id: r.id, customerName: r.customer_name, email: r.email, phone: r.phone,
    productId: r.product_id, productName: r.product_name, lifespanDays: r.lifespan_days,
    capacityLitres: r.capacity_litres, installationDate: dateOnly(r.installation_date),
    orderId: r.order_id, orderItemId: r.order_item_id, orderReference: String(r.wc_order_id ?? r.order_id),
    cashCollectionState: r.cod_collection_status ?? "unknown", status: r.status, reviewReason: r.review_reason,
    targetAccountId: r.target_account_id, linkedAccountId: r.linked_account_id, filterId: r.filter_id,
    activatedAt: r.activated_at, maintenanceCount: r.maintenance_count, active: r.active,
    createdAt: r.created_at, linkedAt: r.linked_at,
  }));
  return { items, total };
}

/** Existing customer mobile read; deliberately contains no staff audit history. */
export async function listAssignments(accountId?: number) {
  return (await readAssignments(accountId)).items;
}

export async function listAssignmentPage(params: AssignmentReadParams, accountId?: number) {
  return { ...await readAssignments(accountId, undefined, params), page: params.page, limit: params.limit };
}

export async function getAssignment(id: number) {
  const assignment = (await readAssignments(undefined, id)).items[0];
  if (!assignment) throw new AssignmentError("NOT_FOUND", "Assignment not found.", 404);
  return assignment;
}

export async function assignmentAudit(id: number, page: number, limit: number) {
  if (!(await pool.query("SELECT id FROM uc_customer_assignments WHERE id=$1", [id])).rowCount)
    throw new AssignmentError("NOT_FOUND", "Assignment not found.", 404);
  const total = Number((await pool.query("SELECT count(*) FROM uc_customer_assignment_audit WHERE assignment_id=$1", [id])).rows[0].count);
  const items = (await pool.query(`SELECT id,actor,action,details,created_at AS "createdAt"
    FROM uc_customer_assignment_audit WHERE assignment_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3`,
    [id, limit, (page - 1) * limit])).rows;
  return { items, total, page, limit };
}

export async function assignmentOrderLines(q: string) {
  const match = /^(woo:)?(\d+)$/.exec(q.trim());
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) <= 0)
    throw new AssignmentError("ORDER_REFERENCE_REQUIRED", "Enter a local order number or woo: followed by a WooCommerce order number.", 400);
  const ref = Number(match[2]), wooOnly = !!match[1];
  const read = () => pool.query(
    `SELECT o.id AS "orderId",o.wc_order_id AS "wooOrderId",o.user_id AS "ownerReference",
     o.status,o.cod_collection_status AS "cashCollectionState",i.id AS "orderItemId",
     i.product_id AS "productId",i.name,i.quantity,
     a.id AS "assignmentId"
     FROM uc_orders o JOIN uc_order_items i ON i.order_id=o.id
     LEFT JOIN uc_customer_assignments a ON a.order_item_id=i.id
      WHERE (${wooOnly ? "o.wc_order_id=$1" : "o.id=$1 OR o.wc_order_id=$1"}) AND o.payment_method='cod' ORDER BY i.id`, [ref]);
  let result = await read();
  if (result.rowCount === 0 && (wooOnly || hasWCCredentials())) {
    await ensureAssignmentWooSource(ref); result = await read();
  }
  return result.rows;
}

function sameReservation(a: Assignment, b: AssignmentInput) {
  return a.customer_name === b.customerName && a.email === b.email && a.phone === b.phone &&
    a.product_id === b.productId && a.order_id === b.orderId && a.order_item_id === b.orderItemId &&
    dateOnly(a.installation_date) === b.installationDate &&
    a.target_account_id === (b.targetAccountId ?? null);
}

function dateOnly(value: string | Date): string {
  // node-postgres parses DATE into a local-midnight Date; Drizzle's string
  // mode is not applied to raw PoolClient queries.
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
  return value.slice(0,10);
}