import { randomUUID } from "node:crypto";
import { and, eq, gt, lte, or } from "drizzle-orm";
import {
  db,
  teamSettingsTable,
  ucRestockDemandAlertsTable,
  ucWishlistTable,
} from "@workspace/db";
import { sendViaResend } from "./resend.js";

const DEFAULT_RESTOCK_DEMAND_THRESHOLD = 5;
const DEMAND_ALERT_CLAIM_TTL_MS = 15 * 60 * 1000;
const DEMAND_EMAIL_TIMEOUT_MS = 30 * 1000;

export interface RestockDemandAlertDeps {
  sendEmail: typeof sendViaResend;
  getAlertEmail: () => Promise<string>;
  threshold: number;
  inventoryUrl: string;
  /** Test seam for the reset/send completion interleaving. */
  beforeRearmTransition?: () => Promise<void>;
  /** Test seam for proving delivery cannot outlive its claim lease. */
  claimTtlMs?: number;
  /** Test seam for the abortable provider-delivery deadline. */
  emailTimeoutMs?: number;
}

export function projectHubInventoryUrl(): string {
  const configured = process.env["PROJECTHUB_URL"]?.trim() || "https://app.ucfilters.com";
  const origin = /^https?:\/\//i.test(configured)
    ? configured.replace(/\/+$/, "")
    : `https://${configured.replace(/\/+$/, "")}`;
  return `${origin}/admin/inventory`;
}

/**
 * Resolve and normalize the configured threshold for both the request and
 * scheduled paths. A caller-supplied value is the test seam used by scheduler
 * tests; production callers read the shared team settings row.
 */
export async function getRestockDemandThreshold(configured?: number): Promise<number> {
  let threshold = configured ?? DEFAULT_RESTOCK_DEMAND_THRESHOLD;
  if (configured === undefined) {
    try {
      const [settings] = await db
        .select({ restockDemandThreshold: teamSettingsTable.restockDemandThreshold })
        .from(teamSettingsTable)
        .where(eq(teamSettingsTable.id, "singleton"))
        .limit(1);
      if (settings?.restockDemandThreshold != null) {
        threshold = settings.restockDemandThreshold;
      }
    } catch (err) {
      console.warn(
        "[restock-demand] could not read threshold from DB — using default (5):",
        err,
      );
    }
  }
  return Math.max(1, Math.floor(threshold));
}

/**
 * Evaluate one product's waiting list after its stock status is known.
 *
 * Product-level state is claimed atomically before delivery. Concurrent
 * request and scheduler paths therefore cannot both send, and retries reuse
 * the same provider idempotency key. The row is deleted only when the cycle
 * re-arms.
 */
export async function checkRestockDemandForProduct(params: {
  productId: number;
  stockStatus: string;
  deps: RestockDemandAlertDeps;
}): Promise<"alerted" | "reset" | "unchanged" | "failed"> {
  const rows = await db
    .select({
      id: ucWishlistTable.id,
      productName: ucWishlistTable.productName,
    })
    .from(ucWishlistTable)
    .where(eq(ucWishlistTable.productId, params.productId));

  if (rows.length === 0) return "unchanged";

  const shouldReset =
    params.stockStatus === "instock" || rows.length < params.deps.threshold;
  if (shouldReset) {
    const now = new Date();
    const deleted = await db
      .delete(ucRestockDemandAlertsTable)
      .where(
        and(
          eq(ucRestockDemandAlertsTable.productId, params.productId),
          or(
            eq(ucRestockDemandAlertsTable.status, "sent"),
            and(
              eq(ucRestockDemandAlertsTable.status, "claimed"),
              lte(ucRestockDemandAlertsTable.claimExpiresAt, now),
            ),
            and(
              eq(ucRestockDemandAlertsTable.status, "rearm_pending"),
              lte(ucRestockDemandAlertsTable.claimExpiresAt, now),
            ),
          ),
        ),
      )
      .returning({ productId: ucRestockDemandAlertsTable.productId });
    if (deleted.length > 0) return "reset";

    // Do not delete a live delivery claim: that would let a concurrent request
    // insert a new provider key while the first email is still in flight.
    // Mark it for removal once the current sender finishes instead.
    await params.deps.beforeRearmTransition?.();
    const pending = await db
      .update(ucRestockDemandAlertsTable)
      .set({ status: "rearm_pending", updatedAt: now })
      .where(
        and(
          eq(ucRestockDemandAlertsTable.productId, params.productId),
          eq(ucRestockDemandAlertsTable.status, "claimed"),
          gt(ucRestockDemandAlertsTable.claimExpiresAt, now),
        ),
      )
      .returning({ productId: ucRestockDemandAlertsTable.productId });
    if (pending.length > 0) return "reset";

    // The sender may have changed claimed -> sent after the first delete but
    // before the pending transition. Reconcile that serialized row outcome so
    // the observed restock cannot leave the next demand cycle suppressed.
    const completedDuringRearm = await db
      .delete(ucRestockDemandAlertsTable)
      .where(
        and(
          eq(ucRestockDemandAlertsTable.productId, params.productId),
          eq(ucRestockDemandAlertsTable.status, "sent"),
        ),
      )
      .returning({ productId: ucRestockDemandAlertsTable.productId });
    return completedDuringRearm.length > 0 ? "reset" : "unchanged";
  }

  const productName = rows[0]!.productName;
  const now = new Date();
  const claimTtlMs = Math.max(2, params.deps.claimTtlMs ?? DEMAND_ALERT_CLAIM_TTL_MS);
  const emailTimeoutMs = Math.min(
    Math.max(1, params.deps.emailTimeoutMs ?? DEMAND_EMAIL_TIMEOUT_MS),
    claimTtlMs - 1,
  );
  const claimExpiresAt = new Date(now.getTime() + claimTtlMs);
  const newIdempotencyKey = `restock-demand-${params.productId}-${randomUUID()}`;

  const [insertedClaim] = await db
    .insert(ucRestockDemandAlertsTable)
    .values({
      productId: params.productId,
      productName,
      waitingCount: rows.length,
      threshold: params.deps.threshold,
      idempotencyKey: newIdempotencyKey,
      status: "claimed",
      claimExpiresAt,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ idempotencyKey: ucRestockDemandAlertsTable.idempotencyKey });

  // A failed or interrupted send becomes reclaimable after its short lease.
  // The idempotency key is deliberately retained across retries.
  const [reclaimedClaim] = insertedClaim
    ? []
    : await db
      .update(ucRestockDemandAlertsTable)
      .set({
        productName,
        waitingCount: rows.length,
        threshold: params.deps.threshold,
        claimExpiresAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(ucRestockDemandAlertsTable.productId, params.productId),
          eq(ucRestockDemandAlertsTable.status, "claimed"),
          lte(ucRestockDemandAlertsTable.claimExpiresAt, now),
        ),
      )
      .returning({ idempotencyKey: ucRestockDemandAlertsTable.idempotencyKey });

  const claim = insertedClaim ?? reclaimedClaim;
  if (!claim) return "unchanged";

  const waitingLabel = `${rows.length} waiting customer${rows.length === 1 ? "" : "s"}`;
  const body = [
    `URGENT RESTOCK DEMAND: ${productName}`,
    "",
    `${waitingLabel} for this out-of-stock product.`,
    `The waiting-customer threshold is ${params.deps.threshold}.`,
    "",
    `Open the inventory page: ${params.deps.inventoryUrl}`,
    "",
    "This alert will not repeat unless demand falls below the threshold and crosses it again.",
  ].join("\n");

  let emailAccepted = false;
  const deliveryController = new AbortController();
  const deliveryTimeout = setTimeout(() => deliveryController.abort(), emailTimeoutMs);
  deliveryTimeout.unref();
  try {
    const alertEmail = await params.deps.getAlertEmail();
    if (deliveryController.signal.aborted) {
      emailAccepted = false;
    } else {
      emailAccepted = await params.deps.sendEmail({
        from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
        to: alertEmail,
        subject: `⚠️ Restock demand: ${productName} — ${rows.length} waiting`,
        text: body,
        idempotencyKey: claim.idempotencyKey,
        signal: deliveryController.signal,
        meta: { template: "restock_demand_alert" },
      });
    }
  } catch {
    emailAccepted = false;
  } finally {
    clearTimeout(deliveryTimeout);
  }

  if (!emailAccepted) {
    const clearedPendingRearm = await db
      .delete(ucRestockDemandAlertsTable)
      .where(
        and(
          eq(ucRestockDemandAlertsTable.productId, params.productId),
          eq(ucRestockDemandAlertsTable.idempotencyKey, claim.idempotencyKey),
          eq(ucRestockDemandAlertsTable.status, "rearm_pending"),
        ),
      )
      .returning({ productId: ucRestockDemandAlertsTable.productId });
    if (clearedPendingRearm.length > 0) return "failed";

    await db
      .update(ucRestockDemandAlertsTable)
      .set({ claimExpiresAt: now, updatedAt: new Date() })
      .where(
        and(
          eq(ucRestockDemandAlertsTable.productId, params.productId),
          eq(ucRestockDemandAlertsTable.idempotencyKey, claim.idempotencyKey),
          eq(ucRestockDemandAlertsTable.status, "claimed"),
        ),
      );
    return "failed";
  }

  const clearedPendingRearm = await db
    .delete(ucRestockDemandAlertsTable)
    .where(
      and(
        eq(ucRestockDemandAlertsTable.productId, params.productId),
        eq(ucRestockDemandAlertsTable.idempotencyKey, claim.idempotencyKey),
        eq(ucRestockDemandAlertsTable.status, "rearm_pending"),
      ),
    )
    .returning({ productId: ucRestockDemandAlertsTable.productId });
  if (clearedPendingRearm.length > 0) return "alerted";

  await db
    .update(ucRestockDemandAlertsTable)
    .set({
      status: "sent",
      waitingCount: rows.length,
      alertedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ucRestockDemandAlertsTable.productId, params.productId),
        eq(ucRestockDemandAlertsTable.idempotencyKey, claim.idempotencyKey),
        eq(ucRestockDemandAlertsTable.status, "claimed"),
      ),
    );
  return "alerted";
}