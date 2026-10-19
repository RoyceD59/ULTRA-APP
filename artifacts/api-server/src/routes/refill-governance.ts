import { Router, type IRouter, type Request, type Response } from "express";
import { refillCampaignProposalSchema, refillReasonSchema } from "@workspace/api-zod/refill-governance";
import {
  RefillGovernanceError, withRefillTeamActor, listGovernedStations,
  listCampaignVersions, listOperatorStations, recordStationAction,
  recordOperatorAction, proposeCampaignVersion, recordCampaignAction,
} from "../lib/refill-governance.js";
import { isRefillGovernanceEnabled } from "../lib/refill-features.js";

const router: IRouter = Router();

// This switch exposes governance records only. It never enables a refill,
// customer balance, payment, quote, or dispenser action.
async function previewEnabled(_req: Request, res: Response, next: () => void): Promise<void> {
  try {
    if (!(await isRefillGovernanceEnabled())) {
      res.status(404).json({ error: "Refill governance preview is unavailable." });
      return;
    }
    res.set("Cache-Control", "no-store");
    next();
  } catch {
    res.status(503).json({ code: "REFILL_FEATURES_UNAVAILABLE", error: "Refill governance settings are unavailable." });
  }
}

function respondError(res: Response, error: unknown): void {
  if (error instanceof RefillGovernanceError) {
    res.status(error.status).json({ code: error.code, error: error.message });
    return;
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === "42P01") {
    res.status(503).json({ code: "REFILL_MIGRATION_REQUIRED", error: "Refill governance storage is unavailable." });
    return;
  }
  res.status(500).json({ code: "REFILL_GOVERNANCE_ERROR", error: "Could not complete the governance request." });
}

type Work = (req: Request) => Promise<unknown>;
function handle(work: Work) {
  return async (req: Request, res: Response): Promise<void> => {
    try { res.json(await work(req)); }
    catch (error) { respondError(res, error); }
  };
}

function reason(req: Request): string {
  const parsed = refillReasonSchema.safeParse(req.body);
  if (!parsed.success) throw new RefillGovernanceError(400, "INVALID_REASON", "Enter an audit reason of 8–500 characters.");
  return parsed.data.reason;
}

function param(req: Request, key: string): string {
  const value = req.params[key];
  if (typeof value !== "string" || value.length < 1 || value.length > 100) {
    throw new RefillGovernanceError(400, "INVALID_IDENTIFIER", "The identifier is invalid.");
  }
  return value;
}

router.use("/uc/admin/refill/governance", previewEnabled);
router.use("/uc/station/refill/scope", previewEnabled);

router.get("/uc/admin/refill/governance/stations", handle(req =>
  withRefillTeamActor(req.headers.authorization, true, client => listGovernedStations(client))));
router.get("/uc/admin/refill/governance/rules", handle(req =>
  withRefillTeamActor(req.headers.authorization, true, client => listCampaignVersions(client))));
router.get("/uc/station/refill/scope", handle(req =>
  withRefillTeamActor(req.headers.authorization, false, (client, actor) => listOperatorStations(client, actor))));

router.post("/uc/admin/refill/governance/stations/:stationId/:action", handle(req => {
  const stationId = param(req, "stationId");
  const action = param(req, "action");
  if (action !== "enable" && action !== "suspend") throw new RefillGovernanceError(404, "ACTION_NOT_FOUND", "Unknown station action.");
  const auditReason = reason(req);
  return withRefillTeamActor(req.headers.authorization, true, (client, actor) => recordStationAction(client, actor, stationId, action, auditReason));
}));
router.post("/uc/admin/refill/governance/stations/:stationId/operators/:operatorId/:action", handle(req => {
  const stationId = param(req, "stationId");
  const operatorId = param(req, "operatorId");
  const action = param(req, "action");
  if (action !== "grant" && action !== "revoke") throw new RefillGovernanceError(404, "ACTION_NOT_FOUND", "Unknown operator action.");
  const auditReason = reason(req);
  return withRefillTeamActor(req.headers.authorization, true, (client, actor) => recordOperatorAction(client, actor, stationId, operatorId, action, auditReason));
}));
router.post("/uc/admin/refill/governance/rules", handle(req => {
  const parsed = refillCampaignProposalSchema.safeParse(req.body);
  if (!parsed.success) throw new RefillGovernanceError(400, "INVALID_RULE", "Enter valid campaign terms and a complete integer-unit scenario.");
  return withRefillTeamActor(req.headers.authorization, true, (client, actor) => proposeCampaignVersion(client, actor, parsed.data));
}));
router.post("/uc/admin/refill/governance/rules/:ruleId/:action", handle(req => {
  const ruleId = param(req, "ruleId");
  if (!/^[a-f0-9-]{36}$/i.test(ruleId)) throw new RefillGovernanceError(400, "INVALID_IDENTIFIER", "The identifier is invalid.");
  const action = param(req, "action");
  if (action !== "approve" && action !== "suspend") throw new RefillGovernanceError(404, "ACTION_NOT_FOUND", "Unknown rule action.");
  const auditReason = reason(req);
  return withRefillTeamActor(req.headers.authorization, true, (client, actor) => recordCampaignAction(client, actor, ruleId, action, auditReason));
}));

export default router;