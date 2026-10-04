import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, pool, teamUsersTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import diagnosticsRouter from "../routes/runtime-diagnostics.js";
import healthRouter from "../routes/health.js";
import monitoringRouter, { fetchProblemCounts } from "../routes/monitoring.js";
import { issueToken } from "../lib/jwt.js";
import { assertIsolatedApiTestDatabase } from "./assert-isolated-test-database.js";
import { validateDiagnostic, diagnosticEnvironment as environment, diagnosticsPool, ensureRuntimeSchema, ingestDiagnostic, boundedApiRoute, runtimeRequestMiddleware, flushRuntimeMetrics, readRuntimeSnapshot, pruneRuntimeRecords } from "../lib/runtime-observability.js";
import { probeHealthTarget, healthTargets, persistHealthSample, readHealthHistory, evaluateIncident } from "../lib/runtime-health.js";

const app = express();
app.use(runtimeRequestMiddleware);
app.use("/api/diagnostics", diagnosticsRouter);
app.use(express.json());
app.use("/api", healthRouter, monitoringRouter);
app.get("/api/uc/orders/:id/failure", (_req, res) => res.status(500).json({ error: "private provider message" }));
app.get("/api/uc/orders/:id/expected", (_req, res) => res.status(401).json({ error: "Authentication required" }));
const baseDiagnostic = { schema: 1, app: "companion", environment, platform: "web", browser: "chrome", release: "development", routeClass: "checkout", category: "render", frames: [{ asset: "bundle", line: 123, column: 7 }] };
const users: string[] = [];
async function user(role: string, permissions: Record<string, string>, active = true) {
  const id = randomUUID(); users.push(id);
  await db.insert(teamUsersTable).values({ id, email: `${id}@runtime-test.invalid`, name: "Runtime test", passwordHash: "not-a-login", role, permissions, isActive: active });
  return { id, token: issueToken({ id, email: "test@runtime-test.invalid", type: "team-session", role, exp: Math.floor(Date.now()/1000)+3600 }) };
}
before(async () => {
  assertIsolatedApiTestDatabase();
  await ensureRuntimeSchema();
  await ensureRuntimeSchema(); // Existing deployments may re-enter startup.
});
after(async () => {
  if (users.length) await db.delete(teamUsersTable).where(inArray(teamUsersTable.id, users));
  await diagnosticsPool.end();
  await pool.end();
});

describe("runtime operational contract", { concurrency: false }, () => {
  it("rejects raw content, unknown keys, adversarial values, wrong environment and unsafe release/frames", () => {
    assert.ok(validateDiagnostic(baseDiagnostic));
    const attacks = [
      null, [], "render", { ...baseDiagnostic, message: "customer email/token" },
      { ...baseDiagnostic, app: { toString: "companion", valueOf: "companion" } },
      { ...baseDiagnostic, release: "person@example.com" }, { ...baseDiagnostic, routeClass: "/orders/customer-secret?token=secret" },
      { ...baseDiagnostic, environment: environment === "production" ? "preview" : "production" },
      { ...baseDiagnostic, correlationId: "customer-id" },
      { ...baseDiagnostic, frames: [{ asset: "bundle", line: 1, column: 2, file: "https://example.com?token=secret" }] },
      { ...baseDiagnostic, frames: [{ asset: "bundle", line: -1, column: 2 }] },
      { ...baseDiagnostic, frames: Array(6).fill({ asset: "bundle", line: 1, column: 2 }) },
      JSON.parse('{"__proto__":{"polluted":true}}'),
    ];
    for (const attack of attacks) assert.equal(validateDiagnostic(attack), null);
  });
  it("bounds paths and exposes a server-generated correlation ID, never a caller ID", async () => {
    assert.equal(boundedApiRoute("/api/uc/orders/customer@example.com?token=secret"), "/api/uc/orders/*");
    assert.equal(boundedApiRoute("/api/unknown/customer@example.com"), "/api/other");
    const response = await request(app).get("/api/uc/orders/customer-secret/failure?token=secret").set("X-Correlation-ID", "attacker");
    assert.equal(response.status, 500);
    assert.match(response.headers["x-correlation-id"], /^[0-9a-f-]{36}$/);
    assert.notEqual(response.headers["x-correlation-id"], "attacker");
    await request(app).get("/api/uc/orders/customer-secret/expected");
    await flushRuntimeMetrics();
    const snapshot = await readRuntimeSnapshot();
    const orders = snapshot.api.find(r => r.route === "/api/uc/orders/*");
    assert.ok(orders); assert.ok(orders.unexpected >= 1); assert.ok(orders.expected >= 1);
    assert.ok(orders.histogram.reduce((n, v) => n+v, 0) === orders.volume);
    const serialized = JSON.stringify(snapshot.api);
    assert.ok(!serialized.includes("customer-secret")); assert.ok(!serialized.includes("token"));
    assert.ok(!serialized.includes("private provider"));
  });
  it("requires live Monitoring permissions, rejects stale admin claims and deactivated users", async () => {
    const viewer = await user("member", { monitoring: "view" });
    const denied = await user("member", {});
    const admin = await user("admin", {});
    const inactive = await user("admin", {}, false);
    const routes = ["/api/admin/monitoring", "/api/admin/monitoring/runtime"];
    for (const route of routes) {
      assert.equal((await request(app).get(route)).status, 401);
      assert.equal((await request(app).get(route).auth(denied.token, { type: "bearer" })).status, 403);
      assert.equal((await request(app).get(route).auth(inactive.token, { type: "bearer" })).status, 403);
      assert.equal((await request(app).get(route).auth(viewer.token, { type: "bearer" })).status, 200);
      assert.equal((await request(app).get(route).auth(admin.token, { type: "bearer" })).status, 200);
    }
    await db.update(teamUsersTable).set({ role: "member" }).where(eq(teamUsersTable.id, admin.id));
    assert.equal((await request(app).get(routes[1]!).auth(admin.token, { type: "bearer" })).status, 403);
    assert.equal((await request(app).put("/api/admin/monitoring/runtime/config").auth(viewer.token, { type: "bearer" }).send({ mode: "live", destination: "email" })).status, 403);
    assert.equal((await request(app).post("/api/admin/monitoring/runtime/test").auth(viewer.token, { type: "bearer" })).status, 403);
    const editor = await user("member", { monitoring: "edit" });
    const preview = await request(app).post("/api/admin/monitoring/runtime/test").auth(editor.token, { type: "bearer" });
    assert.equal(preview.status, 200); assert.equal(preview.body.delivered, false);
    const badConfig = await request(app).put("/api/admin/monitoring/runtime/config").auth(editor.token, { type: "bearer" }).send({ mode: "live", destination: "customer@example.com" });
    assert.equal(badConfig.status, 400);
  });
  it("rejects disallowed origins, oversized and malformed JSON before storing anything", async () => {
    assert.equal((await request(app).post("/api/diagnostics").set("Origin", "https://evil.invalid").send(baseDiagnostic)).status, 403);
    assert.equal((await request(app).post("/api/diagnostics").send({ ...baseDiagnostic, raw: "x".repeat(4000) })).status, 413);
    assert.equal((await request(app).post("/api/diagnostics").set("Content-Type", "application/json").send('{"schema":')).status, 400);
    assert.equal((await request(app).post("/api/diagnostics").send({ ...baseDiagnostic, stack: "secret" })).status, 400);
    assert.equal((await request(app).post("/api/diagnostics").send(baseDiagnostic)).status, 202);
  });
  it("deduplicates groups, caps per-source/global traffic and limits claimed release cardinality across instances", async () => {
    await diagnosticsPool.query("DELETE FROM runtime_ingestion_limits");
    const d = validateDiagnostic(baseDiagnostic)!;
    for (let i = 0; i < 30; i++) assert.equal(await ingestDiagnostic(d, "ephemeral-source-A"), true);
    assert.equal(await ingestDiagnostic(d, "ephemeral-source-A"), false);
    const groups = await diagnosticsPool.query("SELECT count(DISTINCT fingerprint)::int AS n FROM runtime_diagnostics WHERE environment=$1", [environment]);
    assert.equal(groups.rows[0].n, 1);
    const minute = new Date(Math.floor(Date.now()/60000)*60000);
    await diagnosticsPool.query("UPDATE runtime_ingestion_limits SET count=600 WHERE key=$1 AND bucket=$2", [`${environment}:global`, minute]);
    assert.equal(await ingestDiagnostic(d, "different-source"), false);
    await diagnosticsPool.query("DELETE FROM runtime_ingestion_limits");
    for (let i = 0; i < 32; i++) {
      assert.equal(await ingestDiagnostic({ ...d, release: `${1700000000000+i}-1` }, `release-source-${i}`), true);
    }
    assert.equal(await ingestDiagnostic({ ...d, release: "1700000000099-1" }, "new-release-source"), false);
    const stored = JSON.stringify((await diagnosticsPool.query("SELECT metadata FROM runtime_diagnostics")).rows);
    assert.ok(!stored.includes("ephemeral-source")); assert.ok(!stored.includes("release-source"));
  });
  it("fails closed when the collector/database breaks but preserves startup liveness", async () => {
    const original = diagnosticsPool.query;
    diagnosticsPool.query = (() => Promise.reject(new Error("secret connection details"))) as typeof original;
    try {
      assert.equal((await request(app).post("/api/diagnostics").send(baseDiagnostic)).status, 503);
      const ready = await request(app).get("/api/readyz");
      assert.equal(ready.status, 503); assert.deepEqual(ready.body, { status: "degraded" });
      assert.equal((await request(app).get("/api/healthz")).status, 200);
      await flushRuntimeMetrics(); // Collection failure does not escape.
    } finally { diagnosticsPool.query = original; }
    await flushRuntimeMetrics();
    assert.ok((await readRuntimeSnapshot()).collectionGaps > 0, "Recovered storage must retain evidence of the lost interval");
  });
  it("rejects overload without building an unbounded database queue", async () => {
    const original = diagnosticsPool.query;
    diagnosticsPool.query = (async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      throw new Error("collector unavailable");
    }) as typeof original;
    try {
      const results = await Promise.all(Array.from({ length: 12 }, () => request(app).post("/api/diagnostics").send(baseDiagnostic)));
      assert.ok(results.filter(r => r.status === 429).length >= 8);
      assert.ok(results.filter(r => r.status === 503).length <= 4);
    } finally { diagnosticsPool.query = original; }
  });
  it("keeps stored diagnostics/health across an independent database connection and labels missing or old checks unknown", async () => {
    const at = new Date(Date.now()-180000).toISOString();
    await persistHealthSample({ key: "store", label: "Store", url: healthTargets[0].url, ok: true, httpStatus: 200, responseMs: 1, checkedAt: at, error: null });
    const independent = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      const result = await independent.query("SELECT count(*)::int AS n FROM runtime_diagnostics");
      assert.ok(result.rows[0].n > 0);
      // A new OS process has no module cache, history map or original pool.
      // This is a standalone process, not a nested test worker. Force colored
      // console inspection to prove machine output does not depend on it.
      const restartEnvironment: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "1" };
      delete restartEnvironment.NODE_TEST_CONTEXT;
      const restartCount = execFileSync(process.execPath, ["--input-type=module", "-e",
        `import pg from 'pg'; const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
          const r=await p.query('SELECT count(*)::int AS n FROM runtime_diagnostics'); process.stdout.write(String(r.rows[0].n)); await p.end();`
      ], { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8", env: restartEnvironment });
      assert.match(restartCount.trim(), /^\d+$/, "Restart probe must return plain numeric output");
      assert.ok(Number(restartCount.trim()) > 0);
      const checks = await readHealthHistory();
      assert.equal(checks[0]!.ok, null); assert.equal(checks[0]!.freshness, "stale");
      assert.ok(checks[0]!.history.length > 0);
      assert.equal(checks[1]!.ok, null); assert.equal(checks[1]!.checkedAt, null);
    } finally { await independent.end(); }
  });
  it("prunes diagnostics and health older than the documented 14 days", async () => {
    await diagnosticsPool.query(`INSERT INTO runtime_diagnostics(fingerprint,bucket,environment,metadata)
      VALUES('expired',now()-interval '15 days',$1,'{}')`, [environment]);
    await diagnosticsPool.query(`INSERT INTO runtime_health_samples(environment,key,bucket,sample)
      VALUES($1,'expired',now()-interval '15 days','{}')`, [environment]);
    await pruneRuntimeRecords();
    assert.equal((await diagnosticsPool.query("SELECT 1 FROM runtime_diagnostics WHERE fingerprint='expired'")).rowCount, 0);
    assert.equal((await diagnosticsPool.query("SELECT 1 FROM runtime_health_samples WHERE key='expired'")).rowCount, 0);
  });
  it("requires expected page/JSON responses; 403s, redirects and wrong content never prove health", async () => {
    const cases = [
      new Response("Forbidden", { status: 403 }),
      new Response("", { status: 302, headers: { Location: "http://127.0.0.1/private" } }),
      new Response('{"status":"ok"}', { status: 200, headers: { "Content-Type": "text/html" } }),
      new Response('{"status":"down"}', { status: 200, headers: { "Content-Type": "application/json" } }),
    ];
    for (const response of cases) {
      const result = await probeHealthTarget(healthTargets[1], (async (_url, init) => {
        assert.equal(init?.redirect, "manual"); return response;
      }) as typeof fetch);
      assert.equal(result.ok, false);
    }
    const verified = await probeHealthTarget(healthTargets[1], (async () => new Response('{"status":"ok"}', { headers: { "Content-Type": "application/json" } })) as typeof fetch);
    assert.equal(verified.ok, true);
    const store = await probeHealthTarget(healthTargets[0], (async () => new Response("<title>Ultra Clear Filters</title>", { headers: { "Content-Type": "text/html" } })) as typeof fetch);
    assert.equal(store.ok, true);
  });
  it("has deduplicated failure/recovery alerts, safe dry-run and no initial healthy notification", async () => {
    await diagnosticsPool.query("DELETE FROM runtime_incidents");
    await diagnosticsPool.query("DELETE FROM runtime_health_samples WHERE key='readiness'");
    await diagnosticsPool.query(`INSERT INTO runtime_observability_config(environment,mode,destination) VALUES($1,'live','slack')
      ON CONFLICT(environment) DO UPDATE SET mode='live',destination='slack'`, [environment]);
    const sent: string[] = [];
    const providers = { slack: async (text: string) => { sent.push(text); return true; }, email: async () => { throw new Error("email must not be called"); } };
    const sample = async (ok: boolean, minutes: number) => persistHealthSample({ key: "readiness", label: "Database", url: "", ok, httpStatus: null, responseMs: null, checkedAt: new Date(Date.now()+minutes*60000).toISOString(), error: null });
    await sample(true, -1); await sample(true, 0); await evaluateIncident("readiness", true, providers);
    assert.equal(sent.length, 0);
    assert.equal((await diagnosticsPool.query("SELECT delivery FROM runtime_incidents WHERE key='readiness' AND environment=$1", [environment])).rows[0].delivery, "baseline");
    await sample(false, 1); await evaluateIncident("readiness", false, providers);
    assert.equal(sent.length, 0);
    await sample(false, 2);
    await Promise.all([evaluateIncident("readiness", false, providers), evaluateIncident("readiness", false, providers)]);
    assert.equal(sent.length, 1);
    assert.equal((await diagnosticsPool.query("SELECT delivery FROM runtime_incidents WHERE key='readiness' AND environment=$1", [environment])).rows[0].delivery, "accepted");
    await evaluateIncident("readiness", false, providers);
    assert.equal(sent.length, 1);
    await sample(true, 3); await evaluateIncident("readiness", true, providers);
    assert.equal(sent.length, 1);
    await sample(true, 4); await evaluateIncident("readiness", true, providers);
    assert.equal(sent.length, 2);
    await diagnosticsPool.query("UPDATE runtime_observability_config SET mode='dry-run' WHERE environment=$1", [environment]);
    await sample(false, 5); await sample(false, 6); await evaluateIncident("readiness", false, providers);
    assert.equal(sent.length, 2);
    assert.equal((await diagnosticsPool.query("SELECT delivery FROM runtime_incidents WHERE key='readiness' AND environment=$1", [environment])).rows[0].delivery, "dry-run");
    await diagnosticsPool.query("UPDATE runtime_observability_config SET mode='off' WHERE environment=$1", [environment]);
  });
  it("represents failed problem queries as unknown rather than zero", async () => {
    const original = db.select;
    db.select = (() => { throw new Error("database down"); }) as typeof original;
    try { assert.deepEqual(await fetchProblemCounts(), { recoveryOrders: null, notificationFailures7d: null }); }
    finally { db.select = original; }
  });
});