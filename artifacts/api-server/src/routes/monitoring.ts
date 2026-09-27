import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gte, ne } from "drizzle-orm";
import { db, ucOrdersTable, ucNotificationLogTable, teamUsersTable } from "@workspace/db";
import { requireTeamAuth } from "./auth.js";
import { hasWCCredentials } from "./uc";
import { stripeEnabled, getMpesaShortcode } from "./payments";
import { getWhatsAppStatus, isAlertConfigured } from "../lib/whatsapp";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Site reachability checks ─────────────────────────────────────────────────
// Live checks of the public store and the published app API, cached for 60 s so
// dashboard refreshes don't hammer the targets. History is an in-memory ring
// (resets on restart — good enough for an at-a-glance view; the store's own
// uptime monitor remains the long-term record).

interface SiteTarget {
  key: string;
  label: string;
  url: string;
}

const SITE_TARGETS: SiteTarget[] = [
  { key: "store", label: "ucfilters.com store", url: "https://www.ucfilters.com/" },
  { key: "app", label: "app.ucfilters.com API", url: "https://app.ucfilters.com/api/healthz" },
];

// The store's WAF blocks non-browser user agents (returns 403), so present a
// browser UA. Any response below 500 means the site is up and serving.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface HistoryPoint {
  at: string;
  ok: boolean;
  responseMs: number | null;
}

interface SiteCheck {
  key: string;
  label: string;
  url: string;
  ok: boolean;
  httpStatus: number | null;
  responseMs: number | null;
  checkedAt: string;
  error: string | null;
  history: HistoryPoint[];
}

const HISTORY_LIMIT = 48;
const CHECK_CACHE_MS = 60_000;
const CHECK_TIMEOUT_MS = 8_000;

const _history = new Map<string, HistoryPoint[]>();
let _lastChecks: { at: number; checks: SiteCheck[] } | null = null;
let _inFlight: Promise<SiteCheck[]> | null = null;

async function checkTarget(target: SiteTarget): Promise<SiteCheck> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  let ok = false;
  let httpStatus: number | null = null;
  let responseMs: number | null = null;
  let error: string | null = null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
    try {
      // redirect: "manual" — never follow redirects, so a compromised or
      // misconfigured target can't steer this server to an arbitrary URL
      // (blind SSRF). A 3xx answer still proves the site is up.
      const res = await fetch(target.url, {
        headers: { "User-Agent": BROWSER_UA },
        redirect: "manual",
        signal: ctrl.signal,
      });
      responseMs = Date.now() - started;
      httpStatus = res.status;
      ok = res.status < 500;
      if (!ok) error = `HTTP ${res.status}`;
      // Drain/cancel the body so the connection is released promptly.
      await res.body?.cancel().catch(() => {});
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    error =
      err instanceof Error && err.name === "AbortError"
        ? `Timed out after ${CHECK_TIMEOUT_MS / 1000}s`
        : "Unreachable (network error)";
  }

  const history = _history.get(target.key) ?? [];
  history.push({ at: checkedAt, ok, responseMs });
  if (history.length > HISTORY_LIMIT) history.shift();
  _history.set(target.key, history);

  return {
    key: target.key,
    label: target.label,
    url: target.url,
    ok,
    httpStatus,
    responseMs,
    checkedAt,
    error,
    history: [...history],
  };
}

async function runSiteChecks(): Promise<SiteCheck[]> {
  if (_lastChecks && Date.now() - _lastChecks.at < CHECK_CACHE_MS) {
    return _lastChecks.checks;
  }
  // Coalesce concurrent refreshes — several dashboard tabs must not each
  // trigger their own round of external requests.
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const checks = await Promise.all(SITE_TARGETS.map(checkTarget));
      _lastChecks = { at: Date.now(), checks };
      return checks;
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

/** Test hook — reset check cache + history between test cases. */
export function _resetMonitoringCacheForTests(): void {
  _lastChecks = null;
  _inFlight = null;
  _history.clear();
}

// ─── Service + problem checks ─────────────────────────────────────────────────

interface ServiceStatus {
  name: string;
  status: "ok" | "warn" | "down";
  detail: string;
}

function envPresent(key: string): boolean {
  return !!process.env[key]?.trim();
}

async function checkDatabase(): Promise<ServiceStatus> {
  const started = Date.now();
  try {
    await db.select({ id: ucOrdersTable.id }).from(ucOrdersTable).limit(1);
    return {
      name: "Database",
      status: "ok",
      detail: `Responding in ${Date.now() - started} ms`,
    };
  } catch (err) {
    logger.error({ err }, "Monitoring: database check failed");
    return { name: "Database", status: "down", detail: "Query failed — check deployment logs" };
  }
}

async function fetchProblemCounts(): Promise<{
  recoveryOrders: number;
  notificationFailures7d: number;
}> {
  try {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [recoveryRows, failureRows] = await Promise.all([
      db
        .select({ id: ucOrdersTable.id })
        .from(ucOrdersTable)
        .where(
          and(
            eq(ucOrdersTable.webhookRecovery, true),
            ne(ucOrdersTable.status, "completed"),
            ne(ucOrdersTable.status, "cancelled"),
          ),
        ),
      db
        .select({ id: ucNotificationLogTable.id })
        .from(ucNotificationLogTable)
        .where(
          and(
            eq(ucNotificationLogTable.status, "failed"),
            gte(ucNotificationLogTable.sentAt, since),
          ),
        ),
    ]);
    return {
      recoveryOrders: recoveryRows.length,
      notificationFailures7d: failureRows.length,
    };
  } catch (err) {
    logger.error({ err }, "Monitoring: problem counts failed");
    return { recoveryOrders: 0, notificationFailures7d: 0 };
  }
}

function buildServices(dbStatus: ServiceStatus): ServiceStatus[] {
  const services: ServiceStatus[] = [dbStatus];

  const wc = hasWCCredentials();
  services.push({
    name: "WooCommerce store API",
    status: wc ? "ok" : "warn",
    detail: wc
      ? "API credentials configured"
      : "No store credentials — catalogue runs in demo mode",
  });

  const wa = getWhatsAppStatus().state;
  services.push({
    name: "WhatsApp alerts",
    status: wa === "connected" ? "ok" : "warn",
    detail:
      wa === "connected"
        ? "Session connected"
        : wa === "qr"
          ? "Waiting for QR scan — see System Status page"
          : wa === "connecting"
            ? "Reconnecting…"
            : "Not connected — alerts fall back to email",
  });

  const email = isAlertConfigured();
  services.push({
    name: "Email alerts",
    status: email ? "ok" : "warn",
    detail: email
      ? "Admin recipients configured"
      : "No admin email recipients set — team alerts cannot be emailed",
  });

  const ai = envPresent("AI_INTEGRATIONS_ANTHROPIC_API_KEY");
  services.push({
    name: "AI water chat",
    status: ai ? "ok" : "down",
    detail: ai ? "Credentials configured" : "AI credentials missing — chat will fail",
  });

  return services;
}

// ─── Route ────────────────────────────────────────────────────────────────────

interface AuthedRequest extends Request {
  teamUser?: { id: string; email: string; name: string; role: "admin" | "member" };
}

/**
 * Server-side mirror of the ProjectHub "monitoring" page permission.
 * Admins always pass; members need view/edit on "monitoring" (the JWT only
 * carries the role, so member permissions are read from the DB).
 */
async function hasMonitoringAccess(req: Request): Promise<boolean> {
  const user = (req as AuthedRequest).teamUser;
  if (!user) return false;
  if (user.role === "admin") return true;
  try {
    const [row] = await db
      .select({ permissions: teamUsersTable.permissions })
      .from(teamUsersTable)
      .where(eq(teamUsersTable.id, user.id))
      .limit(1);
    const level = (row?.permissions as Record<string, string> | null)?.["monitoring"] ?? "none";
    return level === "view" || level === "edit";
  } catch (err) {
    logger.error({ err }, "Monitoring: permission lookup failed");
    return false;
  }
}

router.get(
  "/admin/monitoring",
  requireTeamAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!(await hasMonitoringAccess(req))) {
        res.status(403).json({ error: "Monitoring access required" });
        return;
      }
      const [siteChecks, dbStatus, problems] = await Promise.all([
        runSiteChecks(),
        checkDatabase(),
        fetchProblemCounts(),
      ]);

      res.json({
        generatedAt: new Date().toISOString(),
        site: siteChecks,
        payments: {
          paystack: envPresent("PAYSTACK_SECRET_KEY"),
          // "live" only when EVERY credential the STK-push flow needs exists —
          // a missing consumer key/secret means charges would fail despite a
          // valid shortcode + passkey.
          mpesaMode:
            getMpesaShortcode() &&
            envPresent("MPESA_PASSKEY") &&
            envPresent("MPESA_CONSUMER_KEY") &&
            envPresent("MPESA_CONSUMER_SECRET")
              ? ("live" as const)
              : ("demo" as const),
          stripe: stripeEnabled() && envPresent("STRIPE_SECRET_KEY"),
          cod: true,
        },
        services: buildServices(dbStatus),
        problems,
      });
    } catch (err) {
      logger.error({ err }, "Monitoring snapshot failed");
      res.status(500).json({ error: "Failed to build monitoring snapshot" });
    }
  },
);

export default router;
