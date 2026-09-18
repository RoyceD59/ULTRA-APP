import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { callExpoPushApi, removePushTokenIfCurrent } from "./push.js";
import { logger } from "./logger.js";
import { reconcileCanonicalPurchaseDualWrite } from "./canonical-purchase-dual-write.js";

export const ORDER_CUSTOMER_STAGES = ["accepted", "shipped", "delivered"] as const;
export type OrderCustomerStage = (typeof ORDER_CUSTOMER_STAGES)[number];
const OUTBOX_LOOKUP_TIMEOUT_MS = 5_000;

/** Run a bounded lookup without changing the pool's session-wide timeout. */
async function boundedQuery(text: string, values: any[] = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${OUTBOX_LOOKUP_TIMEOUT_MS}`);
    const result = await client.query(text, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Woo has a number of store-specific statuses.  Only these milestones are
 * exposed to customers; unknown statuses remain in the event ledger without
 * moving the customer projection. */
export function customerStageForWooStatus(status: string): OrderCustomerStage | null {
  const normalized = status.trim().toLowerCase().replace(/^wc-/, "");
  if ([
    "shipped", "out-for-delivery", "out_for_delivery", "in-transit", "in_transit",
    "ready-for-pickup", "ready_for_pickup", "ready-for-collection", "ready_for_collection",
  ].includes(normalized)) {
    return "shipped";
  }
  if (["completed", "delivered"].includes(normalized)) return "delivered";
  if (["pending", "on-hold", "on_hold", "processing", "accepted", "paid"].includes(normalized)) {
    return "accepted";
  }
  return null;
}

function eventKeyFor(input: {
  orderId: number;
  status: string;
  deliveryId?: string;
  modifiedAt?: string;
  sourceVersion?: string;
}): string {
  // Woo retries keep date_modified stable. Prefer it so reconciliation and a
  // signed webhook converge on one event; delivery id is the fallback for
  // stores which omit modification timestamps.
  const canonicalModified = input.modifiedAt && !Number.isNaN(Date.parse(input.modifiedAt))
    ? new Date(input.modifiedAt).toISOString()
    : input.modifiedAt;
  const numericVersion = parseSourceVersion(input.sourceVersion);
  const source = canonicalModified && !Number.isNaN(Date.parse(canonicalModified))
    ? `${input.orderId}:${input.status.trim().toLowerCase()}:${canonicalModified}:${input.sourceVersion ?? canonicalModified}`
    : numericVersion !== null
      ? `${input.orderId}:${input.status.trim().toLowerCase()}:version:${numericVersion}`
    : input.deliveryId?.trim() || `${input.orderId}:${input.status.trim().toLowerCase()}`;
  return `woo:${createHash("sha256").update(source).digest("hex")}`;
}

function parseSourceVersion(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type TransitionResult = {
  repeated: boolean;
  orderId: number;
  customerStage: string | null;
  status: string;
  eventKey: string;
  outboxCreated: boolean;
  stale: boolean;
};

/**
 * Apply a Woo/manual status transition.  The order projection, immutable
 * event, and notification outbox are one database transaction.  A row lock
 * makes two concurrent/replayed webhooks resolve to one transition.
 */
export async function transitionOrderStatus(input: {
  orderId: number;
  status: string;
  eventKey?: string;
  deliveryId?: string;
  modifiedAt?: string;
  sourceVersion?: string;
  actor?: string;
  source?: "woocommerce" | "staff" | "reconciliation";
  customerStage?: OrderCustomerStage;
}): Promise<TransitionResult> {
  const client = await pool.connect();
  const normalizedStatus = input.status.trim().toLowerCase();
  const eventKey = input.eventKey ?? eventKeyFor({
    orderId: input.orderId,
    status: normalizedStatus,
    deliveryId: input.deliveryId,
    modifiedAt: input.modifiedAt,
    sourceVersion: input.sourceVersion,
  });
  const actor = input.actor ?? input.source ?? "system";
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT id,user_id,status,customer_stage,wc_order_id,
              woo_status_modified_at,woo_status_version
       FROM uc_orders WHERE id=$1 FOR UPDATE`,
      [input.orderId],
    );
    const order = locked.rows[0] as {
      id: number; user_id: string; status: string; customer_stage: string | null; wc_order_id: number | null;
      woo_status_modified_at: Date | string | null; woo_status_version: string | null;
    } | undefined;
    if (!order) {
      const error = Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
      throw error;
    }

    const duplicate = await client.query(
      "SELECT id FROM uc_customer_stage_events WHERE resource_type='order' AND resource_id=$1 AND idempotency_key=$2 LIMIT 1",
      [String(input.orderId), eventKey],
    );
    if (duplicate.rows[0]) {
      await client.query("COMMIT");
     await reconcileCanonicalPurchaseDualWrite(input.orderId, eventKey);
      return {
        repeated: true,
        orderId: input.orderId,
        customerStage: order.customer_stage,
        status: order.status,
        eventKey,
        outboxCreated: false,
        stale: false,
      };
    }

    const sourceModified = input.modifiedAt && !Number.isNaN(Date.parse(input.modifiedAt))
      ? new Date(input.modifiedAt)
      : null;
    const sourceVersionOrder = parseSourceVersion(input.sourceVersion);
    const sourceIsWoo = input.source === "woocommerce" || input.source === "reconciliation";
    const currentModified = order.woo_status_modified_at
      ? new Date(order.woo_status_modified_at)
      : null;
    const currentVersionOrder = parseSourceVersion(order.woo_status_version ?? undefined);
    const hasOrdering = sourceModified !== null || sourceVersionOrder !== null;
    if (sourceIsWoo && !hasOrdering) {
      await client.query(
        `INSERT INTO uc_customer_stage_events
          (resource_type,resource_id,stage,status,source_modified_at,source_version,idempotency_key,actor)
         VALUES ('order',$1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (resource_type,resource_id,idempotency_key) DO NOTHING`,
        [
          String(input.orderId),
          order.customer_stage ?? "accepted",
          normalizedStatus,
          null,
          input.sourceVersion ?? null,
          eventKey,
          actor,
        ],
      );
      await client.query("COMMIT");
      return {
        repeated: false,
        orderId: input.orderId,
        customerStage: order.customer_stage,
        status: order.status,
        eventKey,
        outboxCreated: false,
        stale: true,
      };
    }
    if (sourceIsWoo && sourceModified && currentModified && sourceModified <= currentModified) {
      await client.query(
        `INSERT INTO uc_customer_stage_events
          (resource_type,resource_id,stage,status,source_modified_at,source_version,idempotency_key,actor)
         VALUES ('order',$1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (resource_type,resource_id,idempotency_key) DO NOTHING`,
        [
          String(input.orderId),
          order.customer_stage ?? "accepted",
          normalizedStatus,
          sourceModified,
          input.sourceVersion ?? input.modifiedAt ?? null,
          eventKey,
          actor,
        ],
      );
      await client.query("COMMIT");
      return {
        repeated: false,
        orderId: input.orderId,
        customerStage: order.customer_stage,
        status: order.status,
        eventKey,
        outboxCreated: false,
        stale: true,
      };
    }
    if (
      sourceIsWoo &&
      sourceModified === null &&
      sourceVersionOrder !== null &&
      currentVersionOrder !== null &&
      sourceVersionOrder <= currentVersionOrder
    ) {
      await client.query(
        `INSERT INTO uc_customer_stage_events
          (resource_type,resource_id,stage,status,source_modified_at,source_version,idempotency_key,actor)
         VALUES ('order',$1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (resource_type,resource_id,idempotency_key) DO NOTHING`,
        [
          String(input.orderId),
          order.customer_stage ?? "accepted",
          normalizedStatus,
          null,
          input.sourceVersion,
          eventKey,
          actor,
        ],
      );
      await client.query("COMMIT");
      return {
        repeated: false,
        orderId: input.orderId,
        customerStage: order.customer_stage,
        status: order.status,
        eventKey,
        outboxCreated: false,
        stale: true,
      };
    }

    const requestedStage = input.customerStage ?? customerStageForWooStatus(normalizedStatus);
    const currentIndex = order.customer_stage
      ? ORDER_CUSTOMER_STAGES.indexOf(order.customer_stage as OrderCustomerStage)
      : -1;
    const requestedIndex = requestedStage ? ORDER_CUSTOMER_STAGES.indexOf(requestedStage) : -1;
    if (
      input.customerStage !== undefined &&
      requestedIndex >= 0 &&
      currentIndex >= 0 &&
      (requestedIndex < currentIndex || requestedIndex > currentIndex + 1)
    ) {
      throw Object.assign(
        new Error("Customer stages may only move forward one stage at a time"),
        { code: "INVALID_STAGE_TRANSITION" },
      );
    }
    const stageChanged = requestedIndex > currentIndex;
    const nextStage = stageChanged ? requestedStage : order.customer_stage;

    if (sourceIsWoo && sourceModified) {
      await client.query(
        `UPDATE uc_orders
         SET status=$2, customer_stage=$3,
             customer_stage_updated_at=CASE WHEN $3 IS DISTINCT FROM customer_stage THEN now() ELSE customer_stage_updated_at END,
             woo_status_modified_at=$4, woo_status_version=$5
         WHERE id=$1`,
        [input.orderId, normalizedStatus, nextStage, sourceModified, input.sourceVersion ?? input.modifiedAt],
      );
    } else if (sourceIsWoo && sourceVersionOrder !== null) {
      await client.query(
        `UPDATE uc_orders
         SET status=$2, customer_stage=$3,
             customer_stage_updated_at=CASE WHEN $3 IS DISTINCT FROM customer_stage THEN now() ELSE customer_stage_updated_at END,
             woo_status_version=$4
         WHERE id=$1`,
        [input.orderId, normalizedStatus, nextStage, input.sourceVersion],
      );
    } else {
      await client.query(
        "UPDATE uc_orders SET status=$2, customer_stage=$3, customer_stage_updated_at=CASE WHEN $3 IS DISTINCT FROM customer_stage THEN now() ELSE customer_stage_updated_at END WHERE id=$1",
        [input.orderId, normalizedStatus, nextStage],
      );
    }
    await client.query(
      `INSERT INTO uc_customer_stage_events
        (resource_type,resource_id,stage,status,source_modified_at,source_version,idempotency_key,actor)
       VALUES ('order',$1,$2,$3,$4,$5,$6,$7)`,
      [String(input.orderId), nextStage ?? "accepted", normalizedStatus, sourceModified,
        input.sourceVersion ?? input.modifiedAt ?? null, eventKey, actor],
    );

    let outboxCreated = false;
    if (stageChanged && order.user_id) {
      const outbox = await client.query(
        `INSERT INTO uc_order_notification_outbox
          (event_key,order_id,user_id,stage,payload)
         VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (event_key) DO NOTHING
         RETURNING id`,
        [
          eventKey,
          input.orderId,
          order.user_id,
          nextStage,
          JSON.stringify({
            screen: "order-detail",
            orderId: input.orderId,
            stage: nextStage,
            status: normalizedStatus,
          }),
        ],
      );
      outboxCreated = Boolean(outbox.rows[0]);
    }
    await reconcileCanonicalPurchaseDualWrite(input.orderId, eventKey, client);
    await client.query("COMMIT");
    return {
      repeated: false,
      orderId: input.orderId,
      customerStage: nextStage,
      status: normalizedStatus,
      eventKey,
      outboxCreated,
      stale: false,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type OutboxRunResult = {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Claim and deliver pending outbox rows. Claiming before the provider call
 * prevents concurrent workers from sending the same row. A stale "sending"
 * claim is made retryable after ten minutes, covering a crashed worker.
 */
export async function processOrderNotificationOutbox(limit = 50): Promise<OutboxRunResult> {
  const result: OutboxRunResult = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < limit; i++) {
    const client = await pool.connect();
    let row: {
      id: number; order_id: number; user_id: string; stage: string;
      payload: Record<string, unknown>; attempt_count: number; claim_token: string;
    } | undefined;
    try {
      await client.query("BEGIN");
      const claimToken = randomUUID();
      const claimed = await client.query(
        `SELECT id,order_id,user_id,stage,payload,attempt_count
         FROM uc_order_notification_outbox
         WHERE (status IN ('pending','failed') AND next_attempt_at <= now())
            OR (status='sending' AND (
              lease_expires_at < now()
              OR (lease_expires_at IS NULL AND locked_at < now() - interval '10 minutes')
            ))
         ORDER BY id
         FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      row = claimed.rows[0];
      if (!row) {
        await client.query("COMMIT");
        break;
      }
      await client.query(
        `UPDATE uc_order_notification_outbox
         SET status='sending', locked_at=now(), lease_expires_at=now() + interval '45 seconds',
             claim_token=$2, attempt_count=attempt_count+1
         WHERE id=$1`,
        [row.id, claimToken],
      );
      row.claim_token = claimToken;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      logger.warn({ err: error }, "Order notification outbox claim failed");
      break;
    } finally {
      client.release();
    }
    if (!row) break;

    result.processed++;
    const attempt = row.attempt_count + 1;
    const finish = async (
      status: "sent" | "failed" | "skipped",
      deliveryEvent: string,
      errorMessage?: string,
    ) => {
      const retryable = status === "failed" && deliveryEvent === "provider_failure";
      const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(attempt - 1, 7));
      const completed = await pool.query(
        `UPDATE uc_order_notification_outbox
         SET status=$2, last_error=$3, sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END,
             next_attempt_at=CASE WHEN $4 THEN now() + ($5 * interval '1 second') ELSE next_attempt_at END,
             locked_at=NULL, lease_expires_at=NULL, claim_token=NULL
         WHERE id=$1 AND status='sending' AND claim_token=$6`,
        [row!.id, retryable ? "failed" : status, errorMessage ?? null, retryable, delaySeconds, row!.claim_token],
      );
      if (completed.rowCount !== 1) return;
      await pool.query(
        `INSERT INTO uc_notification_log
          (channel,provider,recipient,template,message_body,order_id,status,delivery_event,delivery_event_at,error_message)
         VALUES ('push','expo',$1,'order-customer-stage',$2,$3,$4,$5,now(),$6)`,
        [row!.user_id, `order ${row!.order_id}: ${row!.stage}`, row!.order_id, status, deliveryEvent, errorMessage ?? null],
      ).catch((error) => logger.warn({ err: error, outboxId: row!.id }, "Order notification audit write failed"));
    };

    const prefs = await boundedQuery(
      `SELECT COALESCE(p.opt_out_orders,false) AS pref_opt_out,
              COALESCE(t.opt_out_orders,false) AS token_opt_out
       FROM (SELECT $1::text AS user_id) u
       LEFT JOIN uc_notif_prefs p ON p.user_id=u.user_id
       LEFT JOIN uc_push_tokens t ON t.user_id=u.user_id`,
      [row.user_id],
    );
    if (prefs.rows[0]?.pref_opt_out || prefs.rows[0]?.token_opt_out) {
      await finish("skipped", "opted_out");
      result.skipped++;
      continue;
    }
    const tokenResult = await boundedQuery(
      "SELECT push_token,opt_out_orders FROM uc_push_tokens WHERE user_id=$1 LIMIT 1",
      [row.user_id],
    );
    const token = tokenResult.rows[0]
      ? { pushToken: String(tokenResult.rows[0].push_token), optOutOrders: Boolean(tokenResult.rows[0].opt_out_orders) }
      : null;
    if (!token) {
      await finish("skipped", "no_push_token");
      result.skipped++;
      continue;
    }
    const renewed = await boundedQuery(
      `UPDATE uc_order_notification_outbox
       SET lease_expires_at=now() + interval '45 seconds'
       WHERE id=$1 AND status='sending' AND claim_token=$2 AND lease_expires_at > now()
       RETURNING id`,
      [row.id, row.claim_token],
    );
    if (renewed.rowCount !== 1) {
      result.skipped++;
      continue;
    }
    const sent = await callExpoPushApi(
      token.pushToken,
      "Your order update",
      `Your order is ${row.stage.replaceAll("_", " ")}.`,
      row.payload,
    );
    if (sent.staleToken) {
      await removePushTokenIfCurrent(row.user_id, token.pushToken);
      await finish("skipped", "stale_token", sent.error);
      result.skipped++;
    } else if (sent.accepted) {
      await finish("sent", "accepted");
      result.sent++;
    } else {
      await finish("failed", "provider_failure", sent.error);
      result.failed++;
    }
  }
  return result;
}

/** Repair local projections when a Woo webhook was delayed or unavailable. */
export async function reconcileWooOrderStatuses(limit = 100): Promise<{ checked: number; updated: number }> {
  const base = process.env["WC_BASE_URL"];
  const key = process.env["WC_CONSUMER_KEY"];
  const secret = process.env["WC_CONSUMER_SECRET"];
  if (!base || !key || !secret) return { checked: 0, updated: 0 };
  const local = await pool.query(
    "SELECT id,wc_order_id FROM uc_orders WHERE wc_order_id IS NOT NULL ORDER BY id DESC LIMIT $1",
    [limit],
  );
  let updated = 0;
  for (const row of local.rows as Array<{ id: number; wc_order_id: number }>) {
    try {
      const response = await fetch(
        `${base.replace(/\/$/, "")}/wp-json/wc/v3/orders/${row.wc_order_id}?consumer_key=${encodeURIComponent(key)}&consumer_secret=${encodeURIComponent(secret)}`,
      );
      if (!response.ok) continue;
      const remote = await response.json() as Record<string, unknown>;
      if (typeof remote.status !== "string") continue;
      const result = await transitionOrderStatus({
        orderId: Number(row.id),
        status: remote.status,
        deliveryId: `reconcile:${row.wc_order_id}:${String(remote.date_modified_gmt ?? remote.date_modified ?? "")}`,
        modifiedAt: typeof remote.date_modified_gmt === "string" ? remote.date_modified_gmt : undefined,
        sourceVersion: typeof remote.version === "number" || typeof remote.version === "string"
          ? String(remote.version)
          : undefined,
        actor: "woocommerce-reconciliation",
        source: "reconciliation",
      });
      if (!result.repeated) updated++;
    } catch (error) {
      logger.warn({ err: error, orderId: row.id }, "Woo order status reconciliation failed");
    }
  }
  return { checked: local.rows.length, updated };
}