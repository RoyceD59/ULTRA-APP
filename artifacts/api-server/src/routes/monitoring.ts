import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gte, ne, count } from "drizzle-orm";
import { db, ucOrdersTable, ucNotificationLogTable, teamUsersTable } from "@workspace/db";
import { requireTeamAuth } from "./auth.js";
import { hasWCCredentials } from "./uc";
import { stripeEnabled, getMpesaShortcode } from "./payments";
import { getWhatsAppStatus, isAlertConfigured } from "../lib/whatsapp";
import { checkReadiness, diagnosticEnvironment, diagnosticsPool, readRuntimeSnapshot } from "../lib/runtime-observability.js";
import { readHealthHistory } from "../lib/runtime-health.js";

const router: IRouter = Router();
interface AuthedRequest extends Request { teamUser?: { id: string } }
/** Every request uses the live active user, including admins (never JWT role). */
export async function hasMonitoringAccess(req: Request, edit = false): Promise<boolean> {
  const id = (req as AuthedRequest).teamUser?.id;
  if (!id) return false;
  try {
    const [row] = await db.select({
      permissions: teamUsersTable.permissions, role: teamUsersTable.role, active: teamUsersTable.isActive,
    }).from(teamUsersTable).where(eq(teamUsersTable.id, id)).limit(1);
    if (!row?.active) return false;
    const level = (row.permissions as Record<string, string> | null)?.monitoring || "none";
    return row.role === "admin" || level === "edit" || (!edit && level === "view");
  } catch { return false; }
}
const permitted = (edit = false) => async (req: Request, res: Response, next: import("express").NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  if (!(await hasMonitoringAccess(req, edit))) { res.status(403).json({ error: "Monitoring access required" }); return; }
  next();
};
export async function fetchProblemCounts() {
  try {
    const [recovery, failures] = await Promise.all([
      db.select({ total: count() }).from(ucOrdersTable).where(and(eq(ucOrdersTable.webhookRecovery, true), ne(ucOrdersTable.status, "completed"), ne(ucOrdersTable.status, "cancelled"))),
      db.select({ total: count() }).from(ucNotificationLogTable).where(and(eq(ucNotificationLogTable.status, "failed"), gte(ucNotificationLogTable.sentAt, new Date(Date.now()-7*86400000)))),
    ]);
    return { recoveryOrders: recovery[0]!.total, notificationFailures7d: failures[0]!.total };
  } catch { return { recoveryOrders: null, notificationFailures7d: null }; }
}
const envPresent = (key: string) => !!process.env[key]?.trim();
router.get("/admin/monitoring", requireTeamAuth, permitted(), async (_req, res) => {
  try {
    const [site, ready, problems] = await Promise.all([readHealthHistory(), checkReadiness(), fetchProblemCounts()]);
    res.json({
      generatedAt: new Date().toISOString(), site,
      payments: {
        paystack: envPresent("PAYSTACK_SECRET_KEY"),
        mpesaMode: getMpesaShortcode() && envPresent("MPESA_PASSKEY") && envPresent("MPESA_CONSUMER_KEY") && envPresent("MPESA_CONSUMER_SECRET") ? "live" : "demo",
        stripe: stripeEnabled() && envPresent("STRIPE_SECRET_KEY"), cod: true,
      },
      services: [
        { name: "Essential database readiness", status: ready.database === "ok" ? "ok" : "down", detail: ready.database === "ok" ? "Bounded database query passed" : "Dependency unavailable; problem counts may be unknown" },
        { name: "WooCommerce API configuration", status: "warn", detail: hasWCCredentials() ? "Credentials present; provider operation not verified" : "Not configured; demo catalogue is not live stock evidence" },
        { name: "WhatsApp alerts", status: "warn", detail: getWhatsAppStatus().state === "connected" ? "Session connected; recipient delivery not verified" : "Session not connected" },
        { name: "Email alerts", status: "warn", detail: isAlertConfigured() ? "Operational recipients configured; delivery not verified" : "Operational recipients not configured" },
        { name: "AI water chat", status: envPresent("AI_INTEGRATIONS_ANTHROPIC_API_KEY") ? "warn" : "down", detail: envPresent("AI_INTEGRATIONS_ANTHROPIC_API_KEY") ? "Credentials present; provider operation not verified" : "Credentials missing" },
      ], problems,
    });
  } catch { res.status(503).json({ error: "Monitoring unavailable; health is unknown" }); }
});
router.get("/admin/monitoring/runtime", requireTeamAuth, permitted(), async (req, res) => {
  const { app, release, environment } = req.query;
  if ((app !== undefined && !["companion", "projecthub"].includes(String(app))) ||
      (environment !== undefined && !["preview", "development", "production"].includes(String(environment))) ||
      (release !== undefined && (typeof release !== "string" || !/^(?:unknown|development|[0-9]{10,16}-[0-9]{1,10}|[a-f0-9]{40})$/.test(release))) ||
      Object.keys(req.query).some(k => !["app", "release", "environment"].includes(k))) {
    res.status(400).json({ error: "Invalid filters" }); return;
  }
  try {
    res.json(await readRuntimeSnapshot({ app: app as string, release: release as string, environment: environment as string }));
  } catch { res.status(503).json({ error: "Diagnostics unavailable; counts are unknown" }); }
});
router.put("/admin/monitoring/runtime/config", requireTeamAuth, permitted(true), async (req, res) => {
  const body = req.body;
  if (!body || Object.keys(body).sort().join(",") !== "destination,mode" ||
      !["off", "dry-run", "live"].includes(body.mode) || !["slack", "email"].includes(body.destination)) {
    res.status(400).json({ error: "Invalid alert configuration" }); return;
  }
  try {
    await diagnosticsPool.query(`INSERT INTO runtime_observability_config(environment,mode,destination) VALUES($1,$2,$3)
      ON CONFLICT(environment) DO UPDATE SET mode=EXCLUDED.mode,destination=EXCLUDED.destination`,
      [diagnosticEnvironment, body.mode, body.destination]);
    res.json({ ...body, environment: diagnosticEnvironment });
  } catch { res.status(503).json({ error: "Configuration unavailable" }); }
});
router.post("/admin/monitoring/runtime/test", requireTeamAuth, permitted(true), (_req, res) => {
  res.json({ mode: "dry-run", delivered: false, message: `Operational health: ${diagnosticEnvironment} / readiness / failure. See ProjectHub Monitoring.` });
});
export default router;