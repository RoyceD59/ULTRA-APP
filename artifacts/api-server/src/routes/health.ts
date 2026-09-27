import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

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
