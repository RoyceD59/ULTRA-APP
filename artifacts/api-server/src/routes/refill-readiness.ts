import { Router, type IRouter } from "express";
import { simulateRefillEconomics } from "@workspace/api-zod/refill-readiness";
import { requireAdmin } from "../lib/adminAuth.js";
import { getRefillCapabilities, getRefillReadiness } from "../lib/refill-readiness.js";
import { readRefillFeatures } from "../lib/refill-features.js";

const router: IRouter = Router();

router.get("/uc/refill/capabilities", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  try {
    const features = await readRefillFeatures();
    res.json(getRefillCapabilities(features));
  } catch {
    res.status(503).json({ error: "Feature capabilities could not be loaded." });
  }
});

router.get("/uc/admin/refill/readiness", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (!(await requireAdmin(req, res))) return;
  try {
    const features = await readRefillFeatures();
    res.json(getRefillReadiness(features));
  } catch {
    res.status(503).json({ error: "Refill readiness could not be loaded." });
  }
});

router.post("/uc/admin/refill/simulate", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (!(await requireAdmin(req, res))) return;
  try {
    res.json(simulateRefillEconomics(req.body));
  } catch (error) {
    if (error instanceof RangeError) {
      res.status(400).json({ error: "Enter valid integer quantities and minor units; mark unknown costs as missing." });
      return;
    }
    res.status(500).json({ error: "Could not calculate the scenario" });
  }
});

export default router;
