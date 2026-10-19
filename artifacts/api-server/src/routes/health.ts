import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkReadiness } from "../lib/runtime-observability.js";

const router: IRouter = Router();
router.get("/readyz", async (_req, res) => {
  const result = await checkReadiness();
  res.setHeader("Cache-Control", "no-store");
  // Public status only. Dependency detail is restricted to Monitoring.
  res.status(result.status === "ready" ? 200 : 503).json({ status: result.status });
});

// /api/healthz — used by the deployment platform's startup health check
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// /api — base path health check (proxy-level monitoring hits this path)
// Returning 200 prevents spurious "healthcheck /api returned status 500" noise
// in deployment logs during server startup probes.
router.get("/", (_req, res) => {
  res.json({ status: "ok", service: "Ultra Clear API" });
});

export default router;
