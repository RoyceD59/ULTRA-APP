import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, canEdit } from "@/lib/team-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface RuntimeSnapshot {
  environment: string; retentionDays: number; windowMinutes: number; truncated: boolean; collectionGaps?: number;
  collector: { state: string; lastAt: string | null; local: { available: boolean; dropped: number } };
  events: Array<{ metadata: { app: string; environment: string; platform: string; browser: string; release: string; routeClass: string; category: string; correlationId?: string; frames: Array<{ line: number; column: number }> }; count: number; last_at: string }>;
  api: Array<{ route: string; method: string; volume: number; expected: number; unexpected: number; statuses: Record<string, number>; meanMs: number | null; maxMs: number; correlationId: string | null }>;
  incidents: Array<{ key: string; state: string; delivery: string; changed_at: string }>;
  alertConfig: { mode: string; destination: string };
}
export function runtimeFreshness(state: string, lastAt: string | null, now = Date.now()): "current" | "unknown" {
  return state === "current" && lastAt !== null && Number.isFinite(Date.parse(lastAt)) && now-Date.parse(lastAt) <= 120000 ? "current" : "unknown";
}
export function RuntimeDiagnosticsPanel() {
  const [app, setApp] = useState("");
  const [environment, setEnvironment] = useState("");
  const [release, setRelease] = useState("");
  const [mode, setMode] = useState("");
  const [destination, setDestination] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const client = useQueryClient();
  const filters = new URLSearchParams();
  if (app) filters.set("app", app);
  if (environment) filters.set("environment", environment);
  if (release) filters.set("release", release);
  const { data, isError, isLoading } = useQuery({
    queryKey: ["runtime-diagnostics", app, environment, release],
    queryFn: () => apiFetch<RuntimeSnapshot>(`/admin/monitoring/runtime?${filters}`),
    refetchInterval: 60000, refetchIntervalInBackground: false,
    retry: false,
  });
  const selectedMode = mode || data?.alertConfig.mode || "off";
  const selectedDestination = destination || data?.alertConfig.destination || "slack";
  const status = data && !isError && data.collector.local.available ? runtimeFreshness(data.collector.state, data.collector.lastAt) : "unknown";
  async function configure() {
    setSaving(true); setNotice("");
    try {
      await apiFetch("/admin/monitoring/runtime/config", { method: "PUT", body: JSON.stringify({ mode: selectedMode, destination: selectedDestination }) });
      setNotice("Alert configuration saved.");
      await client.invalidateQueries({ queryKey: ["runtime-diagnostics"] });
    } catch { setNotice("Configuration not saved. Current settings are unchanged or unknown; refresh before retrying."); }
    finally { setSaving(false); }
  }
  async function test() {
    setSaving(true);
    try {
      const result = await apiFetch<{ delivered: boolean; message: string }>("/admin/monitoring/runtime/test", { method: "POST" });
      setNotice(`Dry-run only. No notification sent. ${result.message}`);
    } catch { setNotice("Dry-run unavailable. No notification sent."); }
    finally { setSaving(false); }
  }
  return <Card>
    <CardHeader><CardTitle>Runtime diagnostics</CardTitle>
      <p className="text-sm text-muted-foreground">First-party JavaScript diagnostics only. No entered content, identities, raw messages or stacks. Not OS-level native crash reporting.</p>
    </CardHeader>
    <CardContent className="space-y-5">
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">App
          <select className="ml-2 rounded border bg-background p-2" value={app} onChange={e => setApp(e.target.value)}>
            <option value="">Both apps</option><option value="companion">Companion</option><option value="projecthub">ProjectHub</option>
          </select>
        </label>
        <label className="text-sm">Environment
          <select className="ml-2 rounded border bg-background p-2" value={environment} onChange={e => setEnvironment(e.target.value)}>
            <option value="">This API environment</option><option>production</option><option>development</option><option>preview</option>
          </select>
        </label>
        <label className="text-sm">Loaded release
          <input className="ml-2 rounded border bg-background p-2" maxLength={40} placeholder="Build ID, revision or unknown" value={release} onChange={e => setRelease(e.target.value.trim())} />
        </label>
      </div>
      <p role="status" className={status === "unknown" ? "text-amber-600 text-sm" : "text-sm text-muted-foreground"}>
        {isLoading ? "Loading diagnostics…" : status === "unknown" ? "Collection unavailable or stale. Missing events and metrics are unknown, not zero failures." : `Collector current · ${data?.environment} · last sample ${data?.collector.lastAt}`}
      </p>
      {data && <p className="text-xs text-muted-foreground">
        {data.retentionDays}-day retention · API aggregates cover the last {data.windowMinutes} minutes · up to 100 recent error groups.
        {data.collector.local.dropped > 0 && ` ${data.collector.local.dropped} API observations dropped by this instance.`}
        {!data.collector.local.available && " This instance reports a collection gap."}
        {data.truncated && " API results are truncated; totals are incomplete."}
        {!!data.collectionGaps && ` Recorded collection gap: ${data.collectionGaps} API observations dropped in this window; totals are incomplete.`}
      </p>}
      {!isError && data && <>
        <h3 className="font-semibold">Recent client failures</h3>
        {!data.events.length ? <p className="text-sm text-muted-foreground">{status === "current" ? "No collected failures in the selected results. This does not prove error-free operation." : "Client failure count unknown."}</p> :
          <ul className="space-y-3">{data.events.map((event, i) => <li key={`${event.last_at}-${i}`} className="rounded border p-3 text-sm break-words">
            <p className="font-semibold">{event.metadata.app} · {event.metadata.category} · {event.count} collected occurrence(s)</p>
            <p>{event.metadata.environment} · {event.metadata.platform} / {event.metadata.browser} · {event.metadata.routeClass}</p>
            <p>Loaded release: <code>{event.metadata.release}</code></p>
            <p className="text-xs text-muted-foreground">Last observed: {new Date(event.last_at).toLocaleString()}
              {event.metadata.frames.length > 0 && ` · Bundle location ${event.metadata.frames[0]!.line}:${event.metadata.frames[0]!.column}`}
            </p>
            {event.metadata.correlationId && <p className="text-xs">Support correlation: <code>{event.metadata.correlationId}</code></p>}
          </li>)}</ul>}
        <h3 className="font-semibold">API route-family aggregates</h3>
        <p className="text-xs text-muted-foreground">Expected auth/validation/not-found/conflict/rate-limit responses are separate from unexpected failures. Route families intentionally omit resource IDs. Latencies are server response durations, not screen performance.</p>
        {data.api.length ? <div className="overflow-x-auto"><table className="w-full text-sm">
          <caption className="sr-only">Recent API volume, response classes, errors and latency by bounded route family</caption>
          <thead><tr>{["Route", "Requests", "Status classes", "Expected errors", "Unexpected errors", "Mean / max ms", "Support correlation"].map(h => <th key={h} scope="col" className="p-2 text-left whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{data.api.map(row => <tr key={`${row.method}:${row.route}`} className="border-t">
            <th scope="row" className="p-2 text-left font-normal whitespace-nowrap">{row.method} {row.route}</th>
            <td className="p-2">{row.volume}</td><td className="p-2">{Object.entries(row.statuses).map(([k,v]) => `${k}: ${v}`).join(", ")}</td>
            <td className="p-2">{row.expected}</td><td className="p-2">{row.unexpected}</td>
            <td className="p-2 whitespace-nowrap">{row.meanMs ?? "unknown"} / {Math.round(row.maxMs)}</td>
            <td className="p-2 text-xs">{row.correlationId || "—"}</td>
          </tr>)}</tbody>
        </table></div> : <p className="text-sm text-muted-foreground">No persisted API samples in this window; volume and failures are unknown.</p>}
        <h3 className="font-semibold">Operational alerts</h3>
        <p className="text-sm text-muted-foreground">Two consecutive failed or recovered checks trigger one transition. No repeated reminders. Destinations are the existing connected Slack team self-DM or configured operational admin emails—not customers. Current setting: {data.alertConfig.mode} / {data.alertConfig.destination}.</p>
        {data.incidents.map(incident => <p key={incident.key} className="text-sm">{incident.key}: {incident.state} · delivery {incident.delivery} · {new Date(incident.changed_at).toLocaleString()}</p>)}
        {canEdit("monitoring") && <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">Alert mode <select className="rounded border bg-background p-2" value={selectedMode} onChange={e => setMode(e.target.value)}>
              <option value="off">Disabled</option><option value="dry-run">Dry-run (no delivery)</option><option value="live">Live operational delivery</option>
            </select></label>
            <label className="text-sm">Destination <select className="rounded border bg-background p-2" value={selectedDestination} onChange={e => setDestination(e.target.value)}>
              <option value="slack">Existing Slack connection</option><option value="email">Existing admin emails</option>
            </select></label>
            <Button variant="outline" disabled={saving} onClick={configure}>{selectedMode === "live" ? "Enable operational delivery" : "Save alert configuration"}</Button>
            <Button variant="outline" disabled={saving} onClick={test}>Test without sending</Button>
          </div>
          <p role="status" className="text-sm">{notice}</p>
        </div>}
      </>}
    </CardContent>
  </Card>;
}