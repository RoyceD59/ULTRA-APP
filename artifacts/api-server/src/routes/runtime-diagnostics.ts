import { Router, json } from "express";
import { buildCorsOrigins } from "../lib/cors-origins.js";
import { collectorState, ingestDiagnostic, validateDiagnostic } from "../lib/runtime-observability.js";

const router = Router();
let active = 0;
let windowStart = Date.now();
let attempts = 0;
// This route is mounted before general body parsing and authentication.
router.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = buildCorsOrigins(process.env);
  if (origin && (!allowed || !allowed.includes(origin))) {
    res.status(403).json({ error: "Origin not allowed" }); return;
  }
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.post("/", json({ limit: "3kb", strict: true }), async (req, res) => {
  const diagnostic = validateDiagnostic(req.body);
  if (!diagnostic) { res.status(400).json({ error: "Invalid diagnostic" }); return; }
  if (Date.now()-windowStart > 60000) { attempts = 0; windowStart = Date.now(); }
  if (active >= 4 || ++attempts > 1000) { res.status(429).json({ error: "Collector busy" }); return; }
  active++;
  try {
    const accepted = await ingestDiagnostic(diagnostic, req.socket.remoteAddress || "unknown");
    res.status(accepted ? 202 : 429).json({ status: accepted ? "accepted" : "limited" });
  } catch {
    collectorState.available = false;
    res.status(503).json({ error: "Collector unavailable" });
  } finally { active--; }
});
router.use((error: { status?: number }, _req: unknown, res: import("express").Response, _next: unknown) => {
  res.status(error.status === 413 ? 413 : 400).json({ error: "Invalid diagnostic payload" });
});
export default router;