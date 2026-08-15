/**
 * filterCandidateUtils.ts
 *
 * Pure helper for computing the RegisterFilterPrompt candidate result.
 * Kept in a framework-free module so it can be unit-tested without a
 * React / React Native / Expo environment.
 */
import type { FilterActivation } from '@/hooks/useNotifications';

export type NudgeMode = 'register' | 'replace';

export interface CandidateResult {
  mode:              NudgeMode;
  product:           { id: number; name: string; lifespanDays: number };
  daysSincePurchase: number;
  orderId:           number;
}

/** Minimal order shape required by the candidate computation. */
export interface CandidateOrder {
  id:          number;
  dateCreated: string;
  lineItems?:  { productId: number }[];
}

/** Minimal filter-product shape required by the candidate computation. */
export interface CandidateProduct {
  id:          number;
  name:        string;
  lifespanDays: number;
}

/**
 * Computes which order (if any) should trigger the register / replace nudge.
 *
 * Returns a CandidateResult when the prompt should be shown, or null when it
 * should stay hidden (no matching order, or the only newer matching order is
 * the one that already registered the current filter cycle).
 *
 * @param opts.now  Override Date.now() for deterministic testing.
 */
export function computeRegisterCandidate(opts: {
  eligibleForRegister: boolean;
  eligibleForReplace:  boolean;
  activation:          FilterActivation | null;
  orders:              CandidateOrder[];
  filterProducts:      CandidateProduct[];
  now?:                number;
}): CandidateResult | null {
  const { eligibleForRegister, eligibleForReplace, activation, orders, filterProducts } = opts;
  const now = opts.now ?? Date.now();

  if (filterProducts.length === 0) return null;
  const byId = new Map(filterProducts.map(p => [p.id, p]));
  const sorted = [...orders].sort(
    (a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
  );

  // ① Register mode: no activation — find any trackable order.
  if (eligibleForRegister) {
    for (const order of sorted) {
      for (const item of order.lineItems ?? []) {
        const product = byId.get(item.productId);
        if (product) {
          const daysSincePurchase = Math.max(
            0,
            Math.floor((now - new Date(order.dateCreated).getTime()) / 86_400_000),
          );
          return { mode: 'register', product, daysSincePurchase, orderId: order.id };
        }
      }
    }
  }

  // ② Replace mode: activation stored — find a trackable order that is
  //   newer than the activation date AND from a different order than the
  //   one that started the current cycle.
  if (eligibleForReplace && activation) {
    const activationTime = new Date(activation.activatedAt).getTime();
    for (const order of sorted) {
      const orderTime = new Date(order.dateCreated).getTime();
      // Orders are newest-first; once we're at or before the activation we
      // can stop — there's nothing newer to find.
      if (orderTime <= activationTime) break;
      // Skip the same purchase that registered the current cycle.
      if (order.id === activation.sourceOrderId) continue;
      for (const item of order.lineItems ?? []) {
        const product = byId.get(item.productId);
        if (product) {
          const daysSincePurchase = Math.max(
            0,
            Math.floor((now - orderTime) / 86_400_000),
          );
          return { mode: 'replace', product, daysSincePurchase, orderId: order.id };
        }
      }
    }
  }

  return null;
}
