import pg from "pg";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const diagnosticEnvironment = process.env.PREVIEW_SAFE_MODE === "1" ? "preview"
  : process.env.NODE_ENV === "production" ? "production" : "development";
// Dedicated small pool: a collector outage must not exhaust customer connections.
export const diagnosticsPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, max: 2,
  connectionTimeoutMillis: 1000, statement_timeout: 1500, query_timeout: 2000,
});
diagnosticsPool.on("error", () => { collectorState.available = false; });
export const collectorState = { available: true, lastFlushAt: null as string | null, dropped: 0 };
export const RETENTION_DAYS = 14;
const salt = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
export const categories = ["render", "unhandled_error", "unhandled_rejection", "api_read_failed", "api_read_timeout"] as const;
export const routeClasses = ["home", "catalogue", "product", "cart", "checkout", "orders", "account", "auth", "care", "guides", "impact", "rewards", "support", "admin", "monitoring", "projects", "tasks", "other"] as const;
export interface Diagnostic {
  schema: 1; app: "companion" | "projecthub";
  environment: "preview" | "development" | "production";
  platform: "web" | "ios" | "android" | "other";
  browser: "chrome" | "safari" | "firefox" | "edge" | "other" | "native";
  release: string; routeClass: typeof routeClasses[number]; category: typeof categories[number];
  frames: Array<{ asset: "application" | "vendor" | "bundle" | "unknown"; line: number; column: number }>;
  correlationId?: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateDiagnostic(value: unknown): Diagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["schema", "app", "environment", "platform", "browser", "release", "routeClass", "category", "frames", "correlationId"].includes(k))) return null;
  if (v.schema !== 1 || typeof v.app !== "string" || !["companion", "projecthub"].includes(v.app) ||
      v.environment !== diagnosticEnvironment || typeof v.platform !== "string" || !["web", "ios", "android", "other"].includes(v.platform) ||
      typeof v.browser !== "string" || !["chrome", "safari", "firefox", "edge", "other", "native"].includes(v.browser) ||
      typeof v.release !== "string" || !/^(?:unknown|development|[0-9]{10,16}-[0-9]{1,10}|[a-f0-9]{40})$/.test(v.release) ||
      !routeClasses.includes(v.routeClass as never) || !categories.includes(v.category as never) ||
      !Array.isArray(v.frames) || v.frames.length > 5 ||
      (v.correlationId !== undefined && (typeof v.correlationId !== "string" || !UUID.test(v.correlationId)))) return null;
  for (const frame of v.frames) {
    if (!frame || typeof frame !== "object" || Array.isArray(frame) ||
        Object.keys(frame).sort().join(",") !== "asset,column,line" ||
        !["application", "vendor", "bundle", "unknown"].includes(frame.asset) ||
        ![frame.line, frame.column].every(n => Number.isInteger(n) && n >= 0 && n <= 10_000_000)) return null;
  }
  // Reconstruct rather than storing any caller object.
  return { schema: 1, app: v.app as Diagnostic["app"], environment: diagnosticEnvironment,
    platform: v.platform as Diagnostic["platform"], browser: v.browser as Diagnostic["browser"],
    release: v.release, routeClass: v.routeClass as Diagnostic["routeClass"], category: v.category as Diagnostic["category"],
    frames: v.frames.map(f => ({ asset: f.asset, line: f.line, column: f.column })),
    ...(v.correlationId ? { correlationId: v.correlationId as string } : {}) };
}

export async function ensureRuntimeSchema(): Promise<void> {
  // Keep identical to shared migration 0065 for existing deployment startup.
  await diagnosticsPool.query(`
    CREATE TABLE IF NOT EXISTS runtime_diagnostics (
     fingerprint text NOT NULL, bucket timestamptz NOT NULL, environment text NOT NULL,
     metadata jsonb NOT NULL, count integer NOT NULL DEFAULT 1, last_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY(fingerprint,bucket));
    CREATE INDEX IF NOT EXISTS runtime_diagnostics_expiry_idx ON runtime_diagnostics(bucket);
    CREATE TABLE IF NOT EXISTS runtime_health_samples (
     environment text NOT NULL, key text NOT NULL, bucket timestamptz NOT NULL, sample jsonb NOT NULL,
     PRIMARY KEY(environment,key,bucket));
    CREATE INDEX IF NOT EXISTS runtime_health_expiry_idx ON runtime_health_samples(bucket);
    CREATE TABLE IF NOT EXISTS runtime_api_metrics (
     environment text NOT NULL, instance text NOT NULL, bucket timestamptz NOT NULL,
     route text NOT NULL, method text NOT NULL, summary jsonb NOT NULL,
     PRIMARY KEY(environment,instance,bucket,route,method));
    CREATE INDEX IF NOT EXISTS runtime_metrics_expiry_idx ON runtime_api_metrics(bucket);
    CREATE TABLE IF NOT EXISTS runtime_ingestion_limits (
     key text NOT NULL, bucket timestamptz NOT NULL, count integer NOT NULL, PRIMARY KEY(key,bucket));
    CREATE TABLE IF NOT EXISTS runtime_incidents (
     environment text NOT NULL, key text NOT NULL, state text NOT NULL,
     changed_at timestamptz NOT NULL DEFAULT now(), delivery text NOT NULL DEFAULT 'disabled',
     PRIMARY KEY(environment,key));
    CREATE TABLE IF NOT EXISTS runtime_observability_config (
     environment text PRIMARY KEY, mode text NOT NULL DEFAULT 'off', destination text NOT NULL DEFAULT 'slack');
  `);
}

export async function ingestDiagnostic(d: Diagnostic, address: string): Promise<boolean> {
  // Hourly pseudonym; never store IP, forwarded headers, user/session identity.
  const pseudonym = createHmac("sha256", salt).update(`${Math.floor(Date.now() / 3600000)}:${address}`).digest("hex");
  const bucket = new Date(Math.floor(Date.now() / 60000) * 60000);
  for (const [key, limit] of [[`${diagnosticEnvironment}:global`, 600], [`${diagnosticEnvironment}:${pseudonym}`, 30]] as const) {
    const result = await diagnosticsPool.query(`INSERT INTO runtime_ingestion_limits(key,bucket,count) VALUES($1,$2,1)
      ON CONFLICT(key,bucket) DO UPDATE SET count=runtime_ingestion_limits.count+1
      WHERE runtime_ingestion_limits.count < $3 RETURNING count`, [key, bucket, limit]);
    if (!result.rowCount) return false;
  }
  // At most 32 claimed releases per app/day; serialized across API instances.
  const client = await diagnosticsPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`runtime-release:${diagnosticEnvironment}:${d.app}`]);
    const day = new Date(Math.floor(Date.now()/86400000)*86400000);
    const prefix = `${diagnosticEnvironment}:release:${d.app}:`;
    const known = await client.query("SELECT 1 FROM runtime_ingestion_limits WHERE key=$1 AND bucket=$2", [`${prefix}${d.release}`, day]);
    if (!known.rowCount) {
      const releases = await client.query("SELECT count(*)::int AS n FROM runtime_ingestion_limits WHERE key LIKE $1 AND bucket=$2", [`${prefix}%`, day]);
      if (releases.rows[0].n >= 32) { await client.query("ROLLBACK"); return false; }
      await client.query("INSERT INTO runtime_ingestion_limits(key,bucket,count) VALUES($1,$2,1)", [`${prefix}${d.release}`, day]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
  const { correlationId: _id, ...group } = d;
  const fingerprint = createHash("sha256").update(JSON.stringify(group)).digest("hex");
  await diagnosticsPool.query(`INSERT INTO runtime_diagnostics(fingerprint,bucket,environment,metadata) VALUES($1,$2,$3,$4)
    ON CONFLICT(fingerprint,bucket) DO UPDATE SET count=LEAST(runtime_diagnostics.count+1,100000),
    last_at=now(),metadata=EXCLUDED.metadata`, [fingerprint, bucket, diagnosticEnvironment, JSON.stringify(d)]);
  return true;
}

// Fixed route families, never raw paths. Detail IDs/slugs are deliberately discarded.
export function boundedApiRoute(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] || "";
  const roots = ["healthz", "readyz", "auth", "admin", "members", "projects", "tasks", "dashboard", "contacts", "notifications", "system", "library", "blog", "guides", "payments", "guest-pay", "referrals", "storage", "ai", "webhook"];
  const ucRoots = ["products", "orders", "customer", "impact", "rewards", "referrals", "promotions", "locations", "reminders", "hydration", "reviews", "tickets", "guides", "blog", "auth", "water-chat", "webhooks"];
  const parts = clean.replace(/^\/api\/?/, "").split("/");
  if (parts[0] === "uc") return ucRoots.includes(parts[1] || "") ? `/api/uc/${parts[1]}/*` : "/api/uc/other";
  return roots.includes(parts[0] || "") ? `/api/${parts[0]}/*` : "/api/other";
}
export interface Metric { volume: number; expected: number; unexpected: number; statuses: Record<string, number>; sumMs: number; maxMs: number; histogram: number[]; correlationId: string | null }
const metrics = new Map<string, Metric>();
const instance = randomUUID();
let flushing = false;
let pendingDropped = 0;
export const runtimeRequestMiddleware: RequestHandler = (req, res, next) => {
  const id = randomUUID();
  res.setHeader("X-Correlation-ID", id);
  res.locals.correlationId = id;
  const started = performance.now();
  res.once("finish", () => {
    if (!req.originalUrl.startsWith("/api") || req.originalUrl.startsWith("/api/diagnostics")) return;
    const route = boundedApiRoute(req.originalUrl);
    const method = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(req.method) ? req.method : "OTHER";
    const key = `${route}|${method}`;
    const m = metrics.get(key) || { volume: 0, expected: 0, unexpected: 0, statuses: {}, sumMs: 0, maxMs: 0, histogram: [0, 0, 0, 0, 0, 0], correlationId: null };
    const ms = Math.min(300000, Math.max(0, performance.now() - started));
    m.volume++; m.sumMs += ms; m.maxMs = Math.max(ms, m.maxMs);
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    m.statuses[statusClass] = (m.statuses[statusClass] || 0) + 1;
    if ([400, 401, 403, 404, 409, 422, 429].includes(res.statusCode)) m.expected++;
    else if (res.statusCode >= 400) { m.unexpected++; m.correlationId = id; }
    const bin = [100, 500, 1000, 3000, 10000].findIndex(n => ms <= n);
    m.histogram[bin < 0 ? 5 : bin]!++;
    metrics.set(key, m);
  });
  next();
};
export async function flushRuntimeMetrics(): Promise<void> {
  if (flushing) return;
  flushing = true;
  const batch = [...metrics.entries()];
  metrics.clear();
  const bucket = new Date();
  try {
    for (const [key, m] of batch) {
      const [route, method] = key.split("|");
      await diagnosticsPool.query(`INSERT INTO runtime_api_metrics(environment,instance,bucket,route,method,summary)
        VALUES($1,$2,$3,$4,$5,$6)`, [diagnosticEnvironment, instance, bucket, route, method, JSON.stringify(m)]);
    }
    await pruneRuntimeRecords();
    if (pendingDropped) {
      await diagnosticsPool.query(`INSERT INTO runtime_health_samples(environment,key,bucket,sample)
        VALUES($1,$2,$3,$4) ON CONFLICT(environment,key,bucket) DO UPDATE SET sample=EXCLUDED.sample`,
        [diagnosticEnvironment, `collection_gap:${instance}`, bucket, JSON.stringify({ dropped: pendingDropped })]);
      pendingDropped = 0;
    }
    collectorState.available = true;
    collectorState.lastFlushAt = bucket.toISOString();
  } catch {
    collectorState.available = false;
    const dropped = batch.reduce((n, [, m]) => n + m.volume, 0);
    collectorState.dropped += dropped;
    pendingDropped += dropped;
  } finally { flushing = false; }
}
export async function pruneRuntimeRecords(): Promise<void> {
  for (const table of ["runtime_diagnostics", "runtime_health_samples", "runtime_api_metrics"]) {
    await diagnosticsPool.query(`DELETE FROM ${table} WHERE bucket < now() - interval '14 days'`);
  }
  await diagnosticsPool.query(`DELETE FROM runtime_ingestion_limits WHERE
    (key LIKE '%:release:%' AND bucket < now() - interval '14 days') OR
    (key NOT LIKE '%:release:%' AND bucket < now() - interval '2 minutes')`);
}
export async function checkReadiness(): Promise<{ status: "ready" | "degraded"; database: "ok" | "unavailable"; checkedAt: string }> {
  try {
    await diagnosticsPool.query("SELECT 1 FROM team_users LIMIT 1");
    return { status: "ready", database: "ok", checkedAt: new Date().toISOString() };
  } catch {
    return { status: "degraded", database: "unavailable", checkedAt: new Date().toISOString() };
  }
}
export async function readRuntimeSnapshot(filters: { app?: string; release?: string; environment?: string } = {}) {
  const env = filters.environment || diagnosticEnvironment;
  const [events, summaries, freshness, incidents, config, gaps] = await Promise.all([
    diagnosticsPool.query(`SELECT metadata, count, bucket, last_at FROM runtime_diagnostics
      WHERE environment=$1 AND bucket > now()-interval '14 days'
      AND ($2::text IS NULL OR metadata->>'app'=$2) AND ($3::text IS NULL OR metadata->>'release'=$3)
      ORDER BY last_at DESC LIMIT 100`, [env, filters.app || null, filters.release || null]),
    diagnosticsPool.query(`SELECT route,method,summary,bucket FROM runtime_api_metrics
      WHERE environment=$1 AND bucket > now()-interval '15 minutes' ORDER BY bucket DESC LIMIT 1000`, [env]),
    diagnosticsPool.query(`SELECT bucket AS at,sample FROM runtime_health_samples WHERE environment=$1 AND key='collector' ORDER BY bucket DESC LIMIT 1`, [env]),
    diagnosticsPool.query(`SELECT key,state,changed_at,delivery FROM runtime_incidents WHERE environment=$1`, [env]),
    diagnosticsPool.query(`SELECT mode,destination FROM runtime_observability_config WHERE environment=$1`, [diagnosticEnvironment]),
    diagnosticsPool.query(`SELECT coalesce(sum((sample->>'dropped')::integer),0)::integer AS dropped
      FROM runtime_health_samples WHERE environment=$1 AND key LIKE 'collection_gap:%'
      AND bucket > now()-interval '15 minutes'`, [env]),
  ]);
  const at = freshness.rows[0]?.at ? new Date(freshness.rows[0].at).toISOString() : null;
  const byRoute = new Map<string, Metric & { route: string; method: string }>();
  for (const row of summaries.rows) {
    const key = `${row.route}|${row.method}`;
    const m: Metric & { route: string; method: string } = byRoute.get(key) || { route: row.route, method: row.method, volume: 0, expected: 0, unexpected: 0, statuses: {}, sumMs: 0, maxMs: 0, histogram: [0,0,0,0,0,0], correlationId: null };
    const s = row.summary as Metric;
    m.volume += s.volume; m.expected += s.expected; m.unexpected += s.unexpected; m.sumMs += s.sumMs; m.maxMs = Math.max(m.maxMs, s.maxMs);
    s.histogram.forEach((n, i) => { m.histogram[i]! += n; });
    for (const [k, n] of Object.entries(s.statuses)) m.statuses[k] = (m.statuses[k] || 0) + n;
    if (!m.correlationId && s.correlationId) m.correlationId = s.correlationId;
    byRoute.set(key, m);
  }
  return { environment: env, retentionDays: RETENTION_DAYS, collector: { state: !at || Date.now()-Date.parse(at)>120000 || !freshness.rows[0]?.sample?.ok ? "stale" : "current", lastAt: at, local: collectorState },
    events: events.rows, api: [...byRoute.values()].map(m => ({ ...m, meanMs: m.volume ? Math.round(m.sumMs / m.volume) : null })),
    incidents: incidents.rows, alertConfig: config.rows[0] || { mode: "off", destination: "slack" },
    windowMinutes: 15, truncated: summaries.rows.length === 1000, collectionGaps: gaps.rows[0].dropped };
}