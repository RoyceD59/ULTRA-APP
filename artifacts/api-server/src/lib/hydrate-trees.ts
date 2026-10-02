/**
 * Hydrate the Future™ shared trees.
 *
 *   allocation       = eligible purchase total × 3%
 *   tree share       = allocation × 50%   (1.5% of revenue grows trees)
 *   clean-water share= allocation × 50%   (1.5% stays with clean-water access)
 *
 * Tree shares fill shared trees in purchase order: the oldest tree that still
 * needs funding first, then a new tree at the current target (KES 750 by
 * default). A purchase can span two trees. Memberships are persisted and never
 * moved; a refunded/cancelled purchase is marked reversed, and later purchases
 * backfill the gap it leaves.
 *
 * Customers only ever see their own share and their tree's overall progress —
 * never who else, or how many others, fund the same tree.
 */
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";

export interface HydrateConfig {
  contributionRate: number;
  treeShare: number;
  treeCostMinor: number;
  baselineRevenueKes: number;
  treesPlanted: number | null;
  treesEstablished: number | null;
  reportDate: string | null;
  location: string;
}

function num(raw: string | undefined, fallback: number, { min = 0, max = Infinity } = {}): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
function optionalCount(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Programme figures come from env so staff can update them without a release:
 *   HYDRATE_TREE_COST_KES          (default 750; applies to NEW trees only)
 *   HYDRATE_TREE_SHARE             (default 0.5 of the 3%)
 *   FOREST_BASELINE_REVENUE_KES    (eligible revenue not captured in the app,
 *                                   e.g. earlier/offline sales — must not
 *                                   overlap app purchases)
 *   FOREST_TREES_PLANTED, FOREST_TREES_ESTABLISHED, FOREST_REPORT_DATE,
 *   FOREST_LOCATION                (programme-reported field figures)
 */
export function hydrateConfig(env: Record<string, string | undefined> = process.env): HydrateConfig {
  return {
    contributionRate: 0.03,
    treeShare: num(env["HYDRATE_TREE_SHARE"], 0.5, { min: 0.01, max: 1 }),
    treeCostMinor: Math.round(num(env["HYDRATE_TREE_COST_KES"], 750, { min: 1 }) * 100),
    baselineRevenueKes: num(env["FOREST_BASELINE_REVENUE_KES"], 0),
    treesPlanted: optionalCount(env["FOREST_TREES_PLANTED"]),
    treesEstablished: optionalCount(env["FOREST_TREES_ESTABLISHED"]),
    reportDate: env["FOREST_REPORT_DATE"]?.trim() || null,
    location: env["FOREST_LOCATION"]?.trim() || "Kenya — planting sites to be confirmed by the programme partner",
  };
}

// ── Pure fill algorithm ────────────────────────────────────────────────────

export interface OpenTree { treeNumber: number; remainingMinor: number }
export interface PendingPurchase { purchaseId: number; customerId: number; totalMinor: number }
export interface PlannedSlice { purchaseId: number; customerId: number; treeNumber: number; amountMinor: number }

export function treeShareMinor(totalMinor: number, cfg: Pick<HydrateConfig, "contributionRate" | "treeShare">): number {
  // Round away float noise first so JS agrees with the numeric floor in SQL.
  return Math.floor(Math.round(Math.max(0, totalMinor) * cfg.contributionRate * cfg.treeShare * 1e6) / 1e6);
}

/**
 * Assign each purchase's tree share to trees. `openTrees` are existing trees
 * with room, oldest first; new trees are numbered from `nextTreeNumber`.
 */
export function planAllocations(
  openTrees: readonly OpenTree[],
  nextTreeNumber: number,
  purchases: readonly PendingPurchase[],
  cfg: Pick<HydrateConfig, "contributionRate" | "treeShare" | "treeCostMinor">,
): { slices: PlannedSlice[]; newTrees: number[] } {
  const queue = openTrees.filter(t => t.remainingMinor > 0).map(t => ({ ...t }))
    .sort((a, b) => a.treeNumber - b.treeNumber);
  const slices: PlannedSlice[] = [];
  const newTrees: number[] = [];
  let next = nextTreeNumber;

  for (const p of purchases) {
    let left = treeShareMinor(p.totalMinor, cfg);
    while (left > 0) {
      if (queue.length === 0) {
        queue.push({ treeNumber: next, remainingMinor: cfg.treeCostMinor });
        newTrees.push(next);
        next++;
      }
      const tree = queue[0]!;
      const take = Math.min(left, tree.remainingMinor);
      const prior = slices.find(s => s.purchaseId === p.purchaseId && s.treeNumber === tree.treeNumber);
      if (prior) prior.amountMinor += take;
      else slices.push({ purchaseId: p.purchaseId, customerId: p.customerId, treeNumber: tree.treeNumber, amountMinor: take });
      tree.remainingMinor -= take;
      left -= take;
      if (tree.remainingMinor === 0) queue.shift();
    }
  }
  return { slices, newTrees };
}

// ── Persistence ─────────────────────────────────────────────────────────────

const LOCK_KEY = "uc_hydrate_tree_allocation";
const BATCH = 500;

/** Paid, customer-linked KES purchase whose app order was not reversed. */
const ELIGIBLE_SQL = `
  p.payment_status = 'paid'
  AND p.customer_id IS NOT NULL
  AND upper(p.currency) = 'KES'
  AND NOT EXISTS (
    SELECT 1 FROM uc_orders o
    WHERE o.id = p.companion_order_id
      AND lower(o.status) IN ('refunded', 'cancelled', 'failed', 'trash')
  )`;

/**
 * Idempotent, serialised pass: reverse slices whose purchase is no longer
 * eligible, then allocate new eligible purchases. Safe to call often.
 */
export async function syncTreeContributions(cfg = hydrateConfig()): Promise<{ allocated: number; reversed: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [LOCK_KEY]);
    const reversed = await client.query(
      `UPDATE uc_hydrate_tree_contributions c SET reversed_at = now()
       WHERE c.reversed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM uc_canonical_purchases p WHERE p.id = c.canonical_purchase_id AND ${ELIGIBLE_SQL})`,
    );
    const allocated = await allocateBatch(client, cfg);
    await client.query("COMMIT");
    return { allocated, reversed: reversed.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function allocateBatch(client: PoolClient, cfg: HydrateConfig): Promise<number> {
  const pending = await client.query<{ id: string; customer_id: number; total_minor: number }>(
    `SELECT p.id, p.customer_id, p.total_minor FROM uc_canonical_purchases p
     WHERE ${ELIGIBLE_SQL}
       AND NOT EXISTS (SELECT 1 FROM uc_hydrate_tree_contributions c WHERE c.canonical_purchase_id = p.id)
       -- skip purchases too small to earn a whole cent, or they'd block the batch forever
       AND floor(p.total_minor * $1::numeric) >= 1
     ORDER BY COALESCE(p.source_created_at, p.created_at), p.id
     LIMIT ${BATCH}`,
    [cfg.contributionRate * cfg.treeShare],
  );
  const purchases = pending.rows
    .map(r => ({ purchaseId: Number(r.id), customerId: r.customer_id, totalMinor: r.total_minor }))
    .filter(p => treeShareMinor(p.totalMinor, cfg) > 0);
  if (purchases.length === 0) return 0;

  const open = await client.query<{ tree_number: number; remaining: string }>(
    `SELECT t.tree_number,
            t.target_minor - COALESCE(SUM(c.amount_minor) FILTER (WHERE c.reversed_at IS NULL), 0) AS remaining
     FROM uc_hydrate_trees t
     LEFT JOIN uc_hydrate_tree_contributions c ON c.tree_number = t.tree_number
     GROUP BY t.tree_number
     HAVING t.target_minor - COALESCE(SUM(c.amount_minor) FILTER (WHERE c.reversed_at IS NULL), 0) > 0
     ORDER BY t.tree_number`,
  );
  const maxRow = await client.query<{ max: number | null }>("SELECT MAX(tree_number) AS max FROM uc_hydrate_trees");
  const plan = planAllocations(
    open.rows.map(r => ({ treeNumber: r.tree_number, remainingMinor: Number(r.remaining) })),
    (maxRow.rows[0]?.max ?? 0) + 1,
    purchases,
    cfg,
  );

  for (const n of plan.newTrees) {
    await client.query("INSERT INTO uc_hydrate_trees (tree_number, target_minor) VALUES ($1, $2)", [n, cfg.treeCostMinor]);
  }
  for (const s of plan.slices) {
    await client.query(
      `INSERT INTO uc_hydrate_tree_contributions (canonical_purchase_id, customer_id, tree_number, amount_minor)
       VALUES ($1, $2, $3, $4)`,
      [s.purchaseId, s.customerId, s.treeNumber, s.amountMinor],
    );
  }
  return purchases.length;
}

// ── Read models ─────────────────────────────────────────────────────────────

const kes = (minor: number) => Math.round(minor) / 100;

export type TreeStage = "seed" | "sapling" | "growing" | "funded";

export function stageForPct(pct: number): TreeStage {
  if (pct >= 100) return "funded";
  if (pct >= 50) return "growing";
  if (pct >= 25) return "sapling";
  return "seed";
}

export interface CustomerTree {
  eligibleOrders: number;
  eligiblePurchasesKes: number;
  allocationKes: number;
  treeShareKes: number;
  cleanWaterKes: number;
  replacementPurchases: number;
  /** Distinct shared trees this customer has helped grow. */
  treesHelped: number;
  /** The shared tree their most recent contribution went into. */
  tree: null | {
    stage: TreeStage;
    fundedPct: number;
    established: boolean;
    yourShareKes: number;
  };
  config: { contributionRate: number; treeShare: number; treeCostKes: number };
}

export async function customerTree(customerId: number, cfg = hydrateConfig()): Promise<CustomerTree> {
  const purchases = await pool.query<{ n: string; total: string | null }>(
    `SELECT COUNT(*) AS n, SUM(p.total_minor) AS total FROM uc_canonical_purchases p
     WHERE p.customer_id = $1 AND ${ELIGIBLE_SQL}`, [customerId]);
  const replacements = await pool.query<{ n: string | null }>(
    `SELECT SUM(l.quantity) AS n FROM uc_canonical_purchase_lines l
     JOIN uc_canonical_purchases p ON p.id = l.purchase_id
     WHERE p.customer_id = $1 AND ${ELIGIBLE_SQL}
       AND (l.product_id IN (22, 23, 24, 25, 26) OR l.product_name ~* '(cartridge|replacement)')`, [customerId]);
  const mine = await pool.query<{ tree_number: number; your_share: string; last_at: Date }>(
    `SELECT tree_number, SUM(amount_minor) AS your_share, MAX(created_at) AS last_at
     FROM uc_hydrate_tree_contributions
     WHERE customer_id = $1 AND reversed_at IS NULL
     GROUP BY tree_number ORDER BY MAX(created_at) DESC, tree_number DESC`, [customerId]);

  let tree: CustomerTree["tree"] = null;
  const latest = mine.rows[0];
  if (latest) {
    // Tree-level aggregate only: no member list or member count is read.
    const t = await pool.query<{ target_minor: number; funded: string; established_at: Date | null }>(
      `SELECT t.target_minor, t.established_at,
              COALESCE(SUM(c.amount_minor) FILTER (WHERE c.reversed_at IS NULL), 0) AS funded
       FROM uc_hydrate_trees t LEFT JOIN uc_hydrate_tree_contributions c ON c.tree_number = t.tree_number
       WHERE t.tree_number = $1 GROUP BY t.tree_number`, [latest.tree_number]);
    const row = t.rows[0]!;
    const pct = Math.min(100, Math.floor((Number(row.funded) / row.target_minor) * 100));
    tree = {
      stage: stageForPct(pct),
      fundedPct: pct,
      established: !!row.established_at,
      yourShareKes: kes(Number(latest.your_share)),
    };
  }

  const totalMinor = Number(purchases.rows[0]?.total ?? 0);
  const allocationMinor = totalMinor * cfg.contributionRate;
  return {
    eligibleOrders: Number(purchases.rows[0]?.n ?? 0),
    eligiblePurchasesKes: kes(totalMinor),
    allocationKes: kes(allocationMinor),
    treeShareKes: kes(allocationMinor * cfg.treeShare),
    cleanWaterKes: kes(allocationMinor * (1 - cfg.treeShare)),
    replacementPurchases: Number(replacements.rows[0]?.n ?? 0),
    treesHelped: mine.rows.length,
    tree,
    config: { contributionRate: cfg.contributionRate, treeShare: cfg.treeShare, treeCostKes: kes(cfg.treeCostMinor) },
  };
}

export interface ForestTotals {
  generatedAt: string;
  eligibleRevenueKes: number;
  appRevenueKes: number;
  baselineRevenueKes: number;
  contributionKes: number;
  treeFundKes: number;
  cleanWaterKes: number;
  /** Shared app trees whose target is fully funded. */
  sharedTreesFunded: number;
  /** % funded of the oldest shared tree still growing (null if none). */
  growingTreePct: number | null;
  /** Estimated trees funded from all tree funding (app + baseline), conservative cost. */
  estimatedTreesFunded: number;
  treesPlanted: number | null;
  treesEstablished: number | null;
  reportDate: string | null;
  location: string;
  config: { contributionRate: number; treeShare: number; treeCostKes: number };
}

export async function forestTotals(cfg = hydrateConfig()): Promise<ForestTotals> {
  const rev = await pool.query<{ total: string | null }>(
    `SELECT SUM(p.total_minor) AS total FROM uc_canonical_purchases p WHERE ${ELIGIBLE_SQL}`);
  const trees = await pool.query<{ funded: string; target_minor: number }>(
    `SELECT t.target_minor, COALESCE(SUM(c.amount_minor) FILTER (WHERE c.reversed_at IS NULL), 0) AS funded
     FROM uc_hydrate_trees t LEFT JOIN uc_hydrate_tree_contributions c ON c.tree_number = t.tree_number
     GROUP BY t.tree_number ORDER BY t.tree_number`);

  const appMinor = Number(rev.rows[0]?.total ?? 0);
  const baselineMinor = Math.round(cfg.baselineRevenueKes * 100);
  const totalMinor = appMinor + baselineMinor;
  const allocationMinor = totalMinor * cfg.contributionRate;
  const treeFundMinor = allocationMinor * cfg.treeShare;
  const growing = trees.rows.find(t => Number(t.funded) < t.target_minor);

  return {
    generatedAt: new Date().toISOString(),
    eligibleRevenueKes: kes(totalMinor),
    appRevenueKes: kes(appMinor),
    baselineRevenueKes: kes(baselineMinor),
    contributionKes: kes(allocationMinor),
    treeFundKes: kes(treeFundMinor),
    cleanWaterKes: kes(allocationMinor - treeFundMinor),
    sharedTreesFunded: trees.rows.filter(t => Number(t.funded) >= t.target_minor).length,
    growingTreePct: growing ? Math.floor((Number(growing.funded) / growing.target_minor) * 100) : null,
    estimatedTreesFunded: Math.floor(treeFundMinor / cfg.treeCostMinor + 1e-9),
    treesPlanted: cfg.treesPlanted,
    treesEstablished: cfg.treesEstablished,
    reportDate: cfg.reportDate,
    location: cfg.location,
    config: { contributionRate: cfg.contributionRate, treeShare: cfg.treeShare, treeCostKes: kes(cfg.treeCostMinor) },
  };
}
