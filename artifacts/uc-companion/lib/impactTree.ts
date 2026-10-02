/**
 * Hydrate the Future™ tree — display logic for the Impact Card.
 *
 * The server owns the money and the shared-tree membership
 * (GET /api/uc/customer/tree): 3% of each eligible purchase is allocated,
 * half grows trees and half stays with clean-water access. Tree shares from
 * several customers fill one shared tree; each member sees a copy of it here,
 * with their own share but never who else funds it.
 *
 * Refills are self-reported litres with no revenue: they only move a seed to
 * Sprout. "Established" comes from programme field verification only.
 */
import type { CustomerTree } from '@/hooks/useApi';

export const TREE_CONFIG = {
  contributionRate: 0.03,
  treeShare: 0.5,
  treeCostKes: 750,
  treeCostRangeKes: [500, 750] as const,
  /**
   * Interim proxy: KES 1,723,000 realised revenue ÷ 141 confirmed sales.
   * Revenue per sale, NOT confirmed customer LTV.
   */
  interimAverageLtvKes: 12_220,
} as const;

export type TreeStage = 'none' | 'seed' | 'sprout' | 'sapling' | 'growing' | 'funded' | 'established';

export const TREE_STAGES: Record<TreeStage, { label: string; meaning: string }> = {
  none:        { label: 'No tree yet',      meaning: 'Your first Ultra Clear purchase plants your seed in a shared tree.' },
  seed:        { label: 'Seed',             meaning: 'You’ve joined a shared tree. It grows as Ultra Clear customers buy.' },
  sprout:      { label: 'Sprout',           meaning: 'Your refills and replacements are watering your tree.' },
  sapling:     { label: 'Sapling',          meaning: 'Your shared tree is at least a quarter funded.' },
  growing:     { label: 'Growing tree',     meaning: 'Most of your shared tree’s estimated cost is funded.' },
  funded:      { label: 'Funded tree',      meaning: 'Your shared tree has reached its estimated cost.' },
  established: { label: 'Established tree', meaning: 'Field status confirmed by the programme.' },
};

/** What the card shows, from the server response plus local refill activity. */
export function displayStage(t: CustomerTree | undefined, refillEntries: number): TreeStage {
  if (!t || t.eligibleOrders === 0) return 'none';
  if (!t.tree) return 'seed'; // paid, but not yet allocated to a tree
  if (t.tree.established) return 'established';
  if (t.tree.stage === 'seed' && (t.replacementPurchases > 0 || refillEntries > 0)) return 'sprout';
  return t.tree.stage;
}

// ── Anonymous forest link ─────────────────────────────────────────────────

/** No 0/O/1/I — readable when spoken or typed. 32^6 ≈ 1.07 billion ids. */
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TREE_ID_PATTERN = /^UC-[A-HJ-NP-Z2-9]{6}$/;

/** Random, not derived from the account id, so it can't be traced back. */
export function newTreeId(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(6);
  let id = 'UC-';
  for (let i = 0; i < 6; i++) id += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  return id;
}

/** Only the anonymous id and the stage leave the device. */
export function forestLink(baseUrl: string, treeId: string, stage: TreeStage): string {
  const url = new URL(baseUrl);
  url.searchParams.set('tree', treeId);
  url.searchParams.set('stage', stage);
  return url.toString();
}
