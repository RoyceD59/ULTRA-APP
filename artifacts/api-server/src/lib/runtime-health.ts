import { diagnosticEnvironment, diagnosticsPool, checkReadiness, collectorState } from "./runtime-observability.js";
import { sendSlackTeamMessage } from "./slack.js";
import { sendViaResend } from "./resend.js";

export const healthTargets = [
  { key: "store", label: "ucfilters.com store response", url: "https://www.ucfilters.com/", kind: "store" },
  { key: "app", label: "app.ucfilters.com API liveness response", url: "https://app.ucfilters.com/api/healthz", kind: "api" },
] as const;
export interface HealthSample {
  key: string; label: string; url: string; ok: boolean | null; httpStatus: number | null;
  responseMs: number | null; checkedAt: string; error: string | null;
}
export async function probeHealthTarget(target: typeof healthTargets[number], fetcher: typeof fetch = fetch): Promise<HealthSample> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  const sample: HealthSample = { ...target, ok: false, httpStatus: null, responseMs: null, checkedAt: new Date().toISOString(), error: null };
  try {
    const response = await fetcher(target.url, {
      redirect: "manual", signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 Chrome/126.0 Safari/537.36" },
    });
    sample.httpStatus = response.status;
    // Hard byte budget; never retain or expose external response contents.
    const reader = response.body?.getReader();
    let body = ""; let size = 0;
    try {
      while (reader) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 32768) { body += new TextDecoder().decode(chunk.value.slice(0, Math.max(0, 32768 - (size - chunk.value.byteLength)))); break; }
        body += new TextDecoder().decode(chunk.value);
      }
    } finally { await reader?.cancel().catch(() => {}); }
    if (response.status === 200) {
      if (target.kind === "api") {
        try { sample.ok = response.headers.get("content-type")?.includes("application/json") === true && JSON.parse(body).status === "ok"; }
        catch { sample.ok = false; }
      } else {
        sample.ok = response.headers.get("content-type")?.includes("text/html") === true &&
          /<title[^>]*>[^<]*(?:ultra[\s-]*clear|ucfilters)/i.test(body);
      }
    }
    if (!sample.ok) sample.error = "Expected response contract not verified";
  } catch { sample.error = ctrl.signal.aborted ? "Probe timed out" : "Probe unavailable"; }
  finally { clearTimeout(timer); sample.responseMs = Date.now() - start; }
  return sample;
}

export async function persistHealthSample(sample: HealthSample): Promise<void> {
  const bucket = new Date(Math.floor(Date.parse(sample.checkedAt) / 60000) * 60000);
  await diagnosticsPool.query(`INSERT INTO runtime_health_samples(environment,key,bucket,sample) VALUES($1,$2,$3,$4)
    ON CONFLICT(environment,key,bucket) DO UPDATE SET sample=EXCLUDED.sample`,
    [diagnosticEnvironment, sample.key, bucket, JSON.stringify(sample)]);
}
export async function readHealthHistory() {
  return Promise.all(healthTargets.map(async target => {
    const rows = await diagnosticsPool.query(`SELECT sample FROM runtime_health_samples WHERE environment=$1 AND key=$2
      AND bucket > now()-interval '14 days' ORDER BY bucket DESC LIMIT 48`, [diagnosticEnvironment, target.key]);
    const samples = rows.rows.map(r => r.sample as HealthSample);
    const latest = samples[0];
    const stale = !latest || Date.now()-Date.parse(latest.checkedAt) > 120000;
    return { ...target, ...(latest || { ok: null, httpStatus: null, responseMs: null, checkedAt: null, error: "No samples available" }),
      ok: stale ? null : latest!.ok, freshness: stale ? "stale" : "current",
      history: samples.reverse().map(s => ({ at: s.checkedAt, ok: s.ok, responseMs: s.responseMs })),
      coverage: target.kind === "api" ? "Liveness only; not customer-screen verification" : "Expected HTML response only; not checkout verification" };
  }));
}
export interface OperationalAlertProviders {
  slack(text: string, id: string): Promise<boolean>;
  email(text: string): Promise<boolean>;
}
const providers: OperationalAlertProviders = {
  slack: (text, id) => sendSlackTeamMessage(text, "runtime_health", { idempotencyKey: id }),
  email: async text => {
    // Existing operational recipients only. No customer destination/input.
    const recipients = (process.env.UC_ADMIN_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 10);
    if (!recipients.length) return false;
    const results = await Promise.all(recipients.map(to => sendViaResend({
      from: "Ultra Clear App <noreply@contacts.ucfilters.com>", to,
      subject: "Operational health transition", text,
    }).catch(() => false)));
    return results.every(Boolean);
  },
};
export async function evaluateIncident(key: string, ok: boolean | null, delivery: OperationalAlertProviders = providers) {
  if (!["store", "app", "readiness"].includes(key) || ok === null) return;
  // Two matching consecutive persisted checks, no reminder on every refresh.
  const previous = await diagnosticsPool.query(`SELECT sample FROM runtime_health_samples
    WHERE environment=$1 AND key=$2 ORDER BY bucket DESC LIMIT 2`, [diagnosticEnvironment, key]);
  if (previous.rows.length < 2 || previous.rows.some(r => r.sample.ok !== ok)) return;
  const state = ok ? "healthy" : "failure";
  const config = await diagnosticsPool.query(`SELECT mode,destination FROM runtime_observability_config WHERE environment=$1`, [diagnosticEnvironment]);
  const mode = config.rows[0]?.mode || "off";
  const destination = config.rows[0]?.destination || "slack";
  const changed = await diagnosticsPool.query(`INSERT INTO runtime_incidents(environment,key,state,delivery)
    VALUES($1,$2,$3,$4) ON CONFLICT(environment,key) DO UPDATE SET state=EXCLUDED.state,
    changed_at=now(),delivery=EXCLUDED.delivery WHERE runtime_incidents.state<>EXCLUDED.state
    RETURNING changed_at::text AS changed_at,(xmax=0) AS inserted`, [diagnosticEnvironment, key, state, mode === "off" ? "disabled" : mode === "dry-run" ? "dry-run" : "claimed"]);
  // Preserve PostgreSQL microseconds for the compare-and-set, not JS Date milliseconds.
  if (!changed.rowCount || mode !== "live") return;
  // Suppress initial healthy state: recovery requires a recorded failure.
  if (ok && changed.rows[0].inserted) {
    await diagnosticsPool.query(`UPDATE runtime_incidents SET delivery='baseline' WHERE environment=$1 AND key=$2 AND changed_at=$3`,
      [diagnosticEnvironment, key, changed.rows[0].changed_at]);
    return;
  }
  const id = `runtime:${diagnosticEnvironment}:${key}:${new Date(changed.rows[0].changed_at).getTime()}`;
  const text = `Operational health: ${diagnosticEnvironment} / ${key} / ${state}. See ProjectHub Monitoring.`;
  const sent = await (destination === "email" ? delivery.email(text) : delivery.slack(text, id)).catch(() => false);
  await diagnosticsPool.query(`UPDATE runtime_incidents SET delivery=$4
    WHERE environment=$1 AND key=$2 AND changed_at=$3`, [diagnosticEnvironment, key, changed.rows[0].changed_at, sent ? "accepted" : "failed"]);
}
let sampling = false;
export async function sampleOperationalHealth() {
  if (sampling) return;
  sampling = true;
  try {
    const bucket = new Date(Math.floor(Date.now()/60000)*60000);
    const claim = await diagnosticsPool.query(`INSERT INTO runtime_health_samples(environment,key,bucket,sample)
      VALUES($1,'sampler_claim',$2,'{}') ON CONFLICT DO NOTHING RETURNING key`, [diagnosticEnvironment, bucket]);
    if (!claim.rowCount) return;
    const readiness = await checkReadiness();
    await persistHealthSample({ key: "readiness", label: "Essential database", url: "", ok: readiness.status === "ready",
      httpStatus: null, responseMs: null, checkedAt: readiness.checkedAt, error: readiness.status === "ready" ? null : "Dependency unavailable" });
    // Isolated preview/development never contacts live operational targets.
    if (diagnosticEnvironment === "production") {
      for (const sample of await Promise.all(healthTargets.map(t => probeHealthTarget(t)))) {
        await persistHealthSample(sample);
        await evaluateIncident(sample.key, sample.ok);
      }
    }
    await evaluateIncident("readiness", readiness.status === "ready");
    await persistHealthSample({ key: "collector", label: "Collector scheduler", url: "", ok: collectorState.available,
      httpStatus: null, responseMs: null, checkedAt: new Date().toISOString(), error: collectorState.available ? null : "Collection gap" });
  } catch { collectorState.available = false; }
  finally { sampling = false; }
}