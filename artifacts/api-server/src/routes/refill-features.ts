import { Router, type IRouter } from "express";
import { UpdateRefillFeaturesBody } from "@workspace/api-zod";
import { RefillGovernanceError, withRefillTeamActor } from "../lib/refill-governance.js";
import { readRefillFeatures, updateRefillFeatures } from "../lib/refill-features.js";

const router: IRouter = Router();
const refillFeaturesUpdateSchema = UpdateRefillFeaturesBody
  .strict()
  .refine(value => Object.keys(value).length > 0);

function respondError(res: import("express").Response, error: unknown): void {
  if (error instanceof RefillGovernanceError) {
    res.status(error.status).json({ code: error.code, error: error.message });
    return;
  }
  res.status(503).json({ code: "REFILL_FEATURES_UNAVAILABLE", error: "Could not read or update refill feature settings." });
}

router.get("/uc/admin/refill/features", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  try {
    const features = await withRefillTeamActor(req.headers.authorization, true, client => readRefillFeatures(client));
    res.json(features);
  } catch (error) {
    respondError(res, error);
  }
});

router.patch("/uc/admin/refill/features", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const parsed = refillFeaturesUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide one or more supported feature flags as booleans." });
    return;
  }
  try {
    const features = await withRefillTeamActor(req.headers.authorization, true,
      client => updateRefillFeatures(client, parsed.data));
    res.json(features);
  } catch (error) {
    respondError(res, error);
  }
});

export default router;