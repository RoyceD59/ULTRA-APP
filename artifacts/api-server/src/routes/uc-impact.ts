/**
 * UC Impact Metrics
 *
 * GET  /api/uc/impact          — live stats (auto + offline-clients + legacy offset)
 * POST /api/uc/impact/override — admin: set legacy offset adjustments
 *
 * Calculations
 *   litresFiltered = Σ (order_item.quantity × PRODUCT_LITRES[productId])
 *                   for completed / processing / on-hold orders
 *                 + Σ (offline_client.product.quantity × capacity)  ← NEW
 *                 + legacyLitresOffset
 *   plasticsAvoided = litresFiltered × 2   (500 ml bottle = 0.5 L → 1 L = 2 bottles)
 *   totalUsers      = COUNT(DISTINCT userId) from app orders
 *                   + COUNT(offline client entries)                  ← NEW
 *                   + legacyUsersOffset
 *
 * The legacy offset (impact-override.json) is kept for historical data that
 * was entered before the per-client register existed.
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  db,
  ucOrdersTable,
  ucOrderItemsTable,
  ucOfflineClientsTable,
  type OfflineProduct,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { requireImpactEditAccess } from "../lib/adminAuth.js";
import { getProductLifespanMap } from "./uc.js";

const router: IRouter = Router();

// ─── Product litre capacity map ───────────────────────────────────────────────
// Excludes CAT_SHOWER (ids 15,16,17,18,19) and shower/skin accessories (24,25).
// 0 = non-filtering product (carry sleeve, filter shell, gift bundle with no filter).

export const PRODUCT_LITRES: Record<number, number> = {
  1:  150,   // Hydra Flux bottle
  2:  150,   // Truva Go bottle
  3:  150,   // Viva Drop bottle
  4:  150,   // Flex bottle
  5:  150,   // Timbo bottle
  6:  150,   // Gym Buddy bottle
  7:  400,   // Survivor Straw
  8:  150,   // Breeze bottle
  9:  400,   // EcoSmart Elite
  11: 1750,  // Sweet Home faucet (avg 1500–2000 L rated)
  12: 1500,  // Counter Reverse Osmosis
  13: 400,   // Electric Pitcher
  14: 10000, // RO Home System (full membrane cycle)
  20: 300,   // Gift & Bundle (conservative mixed estimate)
  21: 0,     // Bottle Carry Sleeve
  22: 150,   // Bottle Filter Cartridge (replacement)
  23: 1750,  // Faucet Filter Cartridge (replacement)
  26: 400,   // Survivor Straw Cartridge (replacement)
  27: 0,     // Filter Shell
  29: 50000, // Aqua Stream 1200 (commercial)
};

// Statuses that count as "fulfilled" for impact purposes
const FULFILLED_STATUSES = ["completed", "processing", "on-hold"];

// ─── Legacy override file ──────────────────────────────────────────────────────
const OVERRIDE_FILE = path.resolve("artifacts/api-server/data/impact-override.json");

interface ImpactOverride {
  litresOffset:  number;
  usersOffset:   number;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
}

const DEFAULT_OVERRIDE: ImpactOverride = {
  litresOffset:  0,
  usersOffset:   0,
  lastUpdatedBy: "system",
  lastUpdatedAt: "",
};

let _override: ImpactOverride | null = null;

async function readOverride(): Promise<ImpactOverride> {
  if (_override !== null) return _override;
  try {
    const raw = await fs.readFile(OVERRIDE_FILE, "utf8");
    _override = JSON.parse(raw) as ImpactOverride;
  } catch {
    _override = { ...DEFAULT_OVERRIDE };
  }
  return _override;
}

async function writeOverride(o: ImpactOverride): Promise<void> {
  _override = o;
  await fs.writeFile(OVERRIDE_FILE, JSON.stringify(o, null, 2), "utf8");
}

// ─── Auto-calculate from app DB orders ───────────────────────────────────────

async function calcImpactFromDb(): Promise<{
  totalUsers: number;
  litresFiltered: number;
  cleanWaterDays: number;
}> {
  const orders = await db
    .select({ id: ucOrdersTable.id, userId: ucOrdersTable.userId })
    .from(ucOrdersTable)
    .where(inArray(ucOrdersTable.status, FULFILLED_STATUSES));

  if (orders.length === 0) return { totalUsers: 0, litresFiltered: 0, cleanWaterDays: 0 };

  const orderIds   = orders.map(o => o.id);
  const userIds    = new Set(orders.map(o => o.userId));
  const totalUsers = userIds.size;

  const items = await db
    .select({
      productId: ucOrderItemsTable.productId,
      quantity:  ucOrderItemsTable.quantity,
    })
    .from(ucOrderItemsTable)
    .where(inArray(ucOrderItemsTable.orderId, orderIds));

  // Lifespan map from the live catalogue (cached, never guessed). When the
  // store has never been reachable the map is null — count 0 rather than
  // fabricate lifespans; litres/users are unaffected.
  const lifespans = await getProductLifespanMap();

  let litresFiltered = 0;
  let cleanWaterDays = 0;
  for (const item of items) {
    const capacity = PRODUCT_LITRES[item.productId] ?? 0;
    litresFiltered += capacity * item.quantity;
    const lifespan = lifespans?.get(item.productId) ?? 0;
    cleanWaterDays += lifespan * item.quantity;
  }

  return { totalUsers, litresFiltered, cleanWaterDays };
}

// ─── Calculate from offline client entries ────────────────────────────────────

async function calcImpactFromOfflineClients(): Promise<{
  clientCount: number;
  litresFiltered: number;
}> {
  const rows = await db.select().from(ucOfflineClientsTable);
  if (rows.length === 0) return { clientCount: 0, litresFiltered: 0 };

  let litresFiltered = 0;
  for (const row of rows) {
    const products = (row.products ?? []) as OfflineProduct[];
    for (const p of products) {
      const capacity =
        p.litresPerUnit ??
        (p.productId !== undefined ? (PRODUCT_LITRES[p.productId] ?? 0) : 0);
      litresFiltered += capacity * p.quantity;
    }
  }

  return { clientCount: rows.length, litresFiltered };
}

// ─── GET /api/uc/impact ───────────────────────────────────────────────────────

router.get("/uc/impact", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [
      { totalUsers: dbUsers, litresFiltered: dbLitres, cleanWaterDays },
      { clientCount: offlineCount, litresFiltered: offlineLitres },
      override,
    ] = await Promise.all([
      calcImpactFromDb(),
      calcImpactFromOfflineClients(),
      readOverride(),
    ]);

    const legacyLitresOffset = override.litresOffset ?? 0;
    const legacyUsersOffset  = override.usersOffset  ?? 0;

    const totalUsers      = dbUsers      + offlineCount    + legacyUsersOffset;
    const litresFiltered  = dbLitres     + offlineLitres   + legacyLitresOffset;
    const plasticsAvoided = litresFiltered * 2;

    res.json({
      totalUsers:      Math.max(0, totalUsers),
      litresFiltered:  Math.max(0, litresFiltered),
      plasticsAvoided: Math.max(0, plasticsAvoided),
      // Days of clean water delivered: Σ filter lifespan × quantity for every
      // fulfilled replacement-filter line item (live catalogue lifespans only).
      cleanWaterDays:  Math.max(0, cleanWaterDays),
      autoStats: {
        totalUsers:     dbUsers,
        litresFiltered: dbLitres,
        cleanWaterDays,
      },
      offlineStats: {
        clientCount:    offlineCount,
        litresFiltered: offlineLitres,
      },
      override: {
        litresOffset:  legacyLitresOffset,
        usersOffset:   legacyUsersOffset,
        lastUpdatedBy: override.lastUpdatedBy,
        lastUpdatedAt: override.lastUpdatedAt,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[uc/impact] calculation error:", err);
    res.status(500).json({ error: "Failed to calculate impact metrics" });
  }
});

// ─── POST /api/uc/impact/override ─────────────────────────────────────────────

router.post("/uc/impact/override", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireImpactEditAccess(req, res))) return;
  const { litresOffset, usersOffset, updatedBy } = req.body as {
    litresOffset?: unknown;
    usersOffset?:  unknown;
    updatedBy?:    unknown;
  };

  if (
    litresOffset !== undefined &&
    (typeof litresOffset !== "number" || !isFinite(litresOffset))
  ) {
    res.status(400).json({ error: "litresOffset must be a finite number" });
    return;
  }
  if (
    usersOffset !== undefined &&
    (typeof usersOffset !== "number" || !isFinite(usersOffset))
  ) {
    res.status(400).json({ error: "usersOffset must be a finite number" });
    return;
  }

  const current = await readOverride();
  const next: ImpactOverride = {
    litresOffset:  typeof litresOffset === "number" ? Math.round(litresOffset) : current.litresOffset,
    usersOffset:   typeof usersOffset  === "number" ? Math.round(usersOffset)  : current.usersOffset,
    lastUpdatedBy: typeof updatedBy    === "string" ? updatedBy : "admin",
    lastUpdatedAt: new Date().toISOString(),
  };

  await writeOverride(next);
  res.json({ ok: true, override: next });
});

export default router;
