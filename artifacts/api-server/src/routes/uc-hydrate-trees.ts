/**
 * Hydrate the Future™ shared trees.
 *
 *   GET /uc/customer/tree   (customer auth) — the signed-in customer's shared
 *       tree (stage, % funded) and their own share. No co-funder data.
 *   GET /uc/impact/forest   (public, any origin) — live programme totals for
 *       the forest page hosted on its own subdomain.
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { logger } from "../lib/logger";
import { customerTree, forestTotals, syncTreeContributions } from "../lib/hydrate-trees.js";
import { authenticatedCustomer } from "./uc-rewards.js";

const router: IRouter = Router();

const SYNC_INTERVAL_MS = 30_000;
let lastSyncAt = 0;
let inFlight: Promise<void> | null = null;

/**
 * Allocate new purchases at most every 30 s per process; concurrent callers
 * share one pass. A failed sync never blocks reads — they show the last
 * allocated state.
 */
async function syncIfStale(force = false): Promise<void> {
  if (!force && Date.now() - lastSyncAt < SYNC_INTERVAL_MS) return;
  inFlight ??= syncTreeContributions()
    .then(r => {
      lastSyncAt = Date.now();
      if (r.allocated || r.reversed) logger.info(r, "[hydrate-trees] contributions synced");
    })
    .finally(() => { inFlight = null; });
  await inFlight;
}

router.get("/uc/customer/tree", async (req: Request, res: Response): Promise<void> => {
  const customerId = await authenticatedCustomer(req, res);
  if (!customerId) return;
  try {
    await syncIfStale();
    res.json(await customerTree(customerId));
  } catch (err) {
    logger.error({ err }, "[uc/customer/tree] failed");
    res.status(503).json({ error: "Your tree is temporarily unavailable" });
  }
});

router.get("/uc/impact/forest", async (_req: Request, res: Response): Promise<void> => {
  // Public aggregate with no credentials: readable from the forest subdomain
  // without widening the API's global CORS allowlist.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=60");
  try {
    await syncIfStale();
    res.json(await forestTotals());
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    logger.error({ err }, "[uc/impact/forest] failed");
    res.status(503).json({ error: "Forest totals are temporarily unavailable" });
  }
});

export default router;
