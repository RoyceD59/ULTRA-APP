import { isCustomerLifecycleFlagEnabled } from "./customer-lifecycle-flags.js";
import type { PoolClient } from "pg";
import {
  reconcileCanonicalPurchase,
  type ReconciliationReason,
} from "./canonical-purchase-reconciliation.js";

export class CanonicalPurchaseDualWriteError extends Error {
  readonly code = "CANONICAL_DUAL_WRITE_RETRYABLE";
  readonly retryable = true;
  readonly reasons: ReconciliationReason[];

  constructor(orderId: number, reasons: ReconciliationReason[] = []) {
    super(`Canonical purchase reconciliation requires retry for order ${orderId}`);
    this.name = "CanonicalPurchaseDualWriteError";
    this.reasons = reasons;
  }
}

/**
 * Single route/pipeline entry point. It deliberately accepts only the durable
 * local order id, never callback identity or provider payload customer fields.
 */
export async function reconcileCanonicalPurchaseDualWrite(
  orderId: number,
  correlationId?: string | null,
  client?: PoolClient,
): Promise<void> {
  if (!isCustomerLifecycleFlagEnabled("dualWrites")) return;
  const result = await reconcileCanonicalPurchase({ orderId, correlationId, client });
  if (result.conflictReasons.length) {
    throw new CanonicalPurchaseDualWriteError(orderId, result.conflictReasons);
  }
}