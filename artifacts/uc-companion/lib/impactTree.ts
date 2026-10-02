/**
 * Hydrate the Future™ tree — pure logic behind the Impact Card tree section.
 *
 * Money and ecology are tracked separately on purpose:
 *  • Funding progress comes only from the customer's paid orders:
 *      allocation = Σ eligible order total × 3%
 *      progress   = allocation ÷ tree cost (KES 750, the conservative end
 *                   of the KES 500–750 Kenya estimate)
 *  • Refills are self-reported litres with no revenue. They animate the tree
 *    (Sprout) but never add funding.
 *  • "Established" means a field-verified tree. Only programme reporting can
 *    set it, so the app never reaches it from purchases alone.
 */
import type { UCOrder } from '@/hooks/useApi';

export const TREE_CONFIG = {
  contributionRate: 0.03,
  /** Primary (conservative) cost used for every progress figure. */
  treeCostKes: 750,
  treeCostRangeKes: [500, 750] as const,
  /**
   * Interim proxy: KES 1,723,000 realised revenue ÷ 141 confirmed sales.
   * This is revenue per sale, NOT confirmed customer LTV — replace when the
   * confirmed figure is available.
   */
  interimAverageLtvKes: 12_220,
} as const;

export type TreeStage = 'none' | 'seed' | 'sprout' | 'sapling' | 'growing' | 'funded';

export const TREE_STAGES: Record<TreeStage | 'established', { label: string; meaning: string }> = {
  none:        { label: 'No tree yet',      meaning: 'Your first Ultra Clear purchase plants your seed.' },
  seed:        { label: 'Seed',             meaning: 'Your relationship with Ultra Clear has begun.' },
  sprout:      { label: 'Sprout',           meaning: 'Refills and replacements are helping your tree grow.' },
  sapling:     { label: 'Sapling',          meaning: 'Your tree is partly funded.' },
  growing:     { label: 'Growing tree',     meaning: 'Most of your tree’s estimated cost is funded.' },
  funded:      { label: 'Funded tree',      meaning: 'Your contributions have reached the estimated cost of a tree.' },
  established: { label: 'Established tree', meaning: 'Field status confirmed by the programme.' },
};

const EXCLUDED_STATUSES = ['refunded', 'cancelled', 'failed', 'trash'];
const REPLACEMENT_PRODUCT_IDS = new Set([22, 23, 24, 25, 26]);

/**
 * Paid, KES, and not reversed. Status is checked as well as paymentStatus
 * because a paid-then-refunded WooCommerce order still reports
 * paymentStatus "paid" (its date_paid is set).
 */
export function isEligibleOrder(o: Pick<UCOrder, 'status' | 'paymentStatus' | 'currency'>): boolean {
  const status = String(o.status ?? '').toLowerCase();
  if (EXCLUDED_STATUSES.includes(status)) return false;
  const paid = o.paymentStatus
    ? o.paymentStatus.toLowerCase() === 'paid'
    : status === 'processing' || status === 'completed';
  return paid && String(o.currency || 'KES').toUpperCase() === 'KES';
}

export function isReplacementLine(line: UCOrder['lineItems'][number]): boolean {
  if (line.productId !== undefined && REPLACEMENT_PRODUCT_IDS.has(line.productId)) return true;
  return /cartridge|replacement/i.test(line.name ?? '');
}

function orderTotalKes(total: string): number {
  const n = Number(String(total).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface TreeProgress {
  stage: TreeStage;
  eligibleOrders: number;
  eligiblePurchasesKes: number;
  allocationKes: number;
  /** Whole trees whose estimated cost the allocation covers. */
  treesFunded: number;
  /** % of the current (next) tree funded, 0–99. */
  currentTreePct: number;
  /** % of one tree funded overall, uncapped (e.g. 160 = 1.6 trees). */
  totalPctOfTree: number;
  replacementPurchases: number;
  refillEntries: number;
}

export function computeTreeProgress(
  orders: readonly Pick<UCOrder, 'status' | 'paymentStatus' | 'currency' | 'total' | 'lineItems'>[],
  refillEntries: number,
  cfg = TREE_CONFIG,
): TreeProgress {
  const eligible = orders.filter(isEligibleOrder);
  const purchases = eligible.reduce((s, o) => s + orderTotalKes(o.total), 0);
  const allocation = Math.round(purchases * cfg.contributionRate * 100) / 100;
  // Epsilon absorbs float noise exactly at a whole-tree boundary.
  const treesExact = allocation / cfg.treeCostKes + 1e-9;
  const treesFunded = Math.floor(treesExact);
  const totalPct = Math.floor((allocation / cfg.treeCostKes) * 100 + 1e-7);
  const replacements = eligible.reduce(
    (n, o) => n + (o.lineItems ?? []).filter(isReplacementLine).reduce((q, l) => q + (l.quantity || 1), 0), 0);

  // Stage is the furthest of the event-based and funding-based stages, so a
  // large first purchase can't skip "Sprout" into an inconsistent state.
  let stage: TreeStage = 'none';
  if (eligible.length > 0) {
    if (treesFunded >= 1) stage = 'funded';
    else if (totalPct >= 50) stage = 'growing';
    else if (totalPct >= 25) stage = 'sapling';
    else if (replacements > 0 || refillEntries > 0) stage = 'sprout';
    else stage = 'seed';
  }

  return {
    stage,
    eligibleOrders: eligible.length,
    eligiblePurchasesKes: purchases,
    allocationKes: allocation,
    treesFunded,
    currentTreePct: treesFunded >= 1 ? totalPct % 100 : Math.min(99, totalPct),
    totalPctOfTree: totalPct,
    replacementPurchases: replacements,
    refillEntries,
  };
}

// ── Anonymous forest link ─────────────────────────────────────────────────

/** No 0/O/1/I — readable when spoken or typed. 32^6 ≈ 1.07 billion ids. */
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TREE_ID_PATTERN = /^UC-[A-HJ-NP-Z2-9]{6}$/;

/**
 * Random, not derived from the account id — so it can't be reversed to a
 * customer and can be regenerated if ever needed.
 */
export function newTreeId(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(6);
  let id = 'UC-';
  for (let i = 0; i < 6; i++) id += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  return id;
}

/**
 * Only the anonymous id and the stage leave the device — never amounts or
 * percentages, which could be reversed into the customer's spend.
 */
export function forestLink(baseUrl: string, treeId: string, stage: TreeStage): string {
  const url = new URL(baseUrl);
  url.searchParams.set('tree', treeId);
  url.searchParams.set('stage', stage);
  return url.toString();
}
