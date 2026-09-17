import { useEffect, useState } from "react";
import { Bot, Copy, KeyRound, RefreshCw, ShieldAlert, ShieldCheck, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-base";
import { getAuthHeaders } from "@/lib/team-auth";

const SCOPES = ["companion.monitor.read", "companion.users.read", "interactions.read", "alison.read"] as const;
type Client = { id: string; name: string; scopes: string[]; status: string; expiresAt?: string | null; lastUsedAt?: string | null; createdAt: string };

async function request(path: string, init?: RequestInit) {
  const res = await fetch(apiUrl(path), { ...init, headers: { ...(getAuthHeaders() ?? {}), ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export default function AgentOperationsPage() {
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([SCOPES[0]]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => request("/oauth/clients").then((data) => setClients(data.clients ?? [])).catch((e: Error) => toast({ title: "Could not load agent clients", description: e.message, variant: "destructive" }));
  useEffect(() => { void load(); }, []);
  const create = async () => {
    setBusy(true);
    try {
      const data = await request("/oauth/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, scopes }) });
      setSecret(data.clientSecret); setName(""); await load();
      toast({ title: "Agent client created", description: "Copy the secret now. It will not be shown again." });
    } catch (e) { toast({ title: "Could not create client", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const mutateClient = async (id: string, path: string) => {
    try { const data = await request(`/oauth/clients/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(path === "suspend" ? { status: "suspended" } : {}) }); if (data.clientSecret) setSecret(data.clientSecret); await load(); }
    catch (e) { toast({ title: "Client update failed", description: (e as Error).message, variant: "destructive" }); }
  };
  return <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
    <div className="flex items-start gap-3"><Bot className="w-7 h-7 text-primary mt-1" /><div><h1 className="text-2xl font-semibold">Agent operations</h1><p className="text-sm text-muted-foreground mt-1">Private ProjectHub access for approved back-office agents. Companion customers never see this area.</p></div></div>
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div><h2 className="font-semibold">Register a confidential service client</h2><p className="text-sm text-muted-foreground">Read-only scopes are available in v1. Secrets are displayed once and stored only as hashes.</p></div>
      <div className="flex flex-col md:flex-row gap-3"><Input data-testid="input-agent-name" placeholder="Agent name" value={name} onChange={(e) => setName(e.target.value)} /><Button data-testid="button-create-agent" disabled={busy || !name.trim() || !scopes.length} onClick={() => void create()}><KeyRound className="w-4 h-4 mr-2" />Create client</Button></div>
      <div className="flex flex-wrap gap-2">{SCOPES.map((scope) => <label key={scope} className="flex items-center gap-2 text-xs border rounded px-2 py-1"><input type="checkbox" checked={scopes.includes(scope)} onChange={(e) => setScopes((s) => e.target.checked ? [...s, scope] : s.filter((x) => x !== scope))} />{scope}</label>)}</div>
      {secret && <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3"><p className="text-sm font-medium flex items-center gap-2"><ShieldAlert className="w-4 h-4" />Copy this secret now</p><div className="flex gap-2 mt-2"><Input readOnly value={secret} data-testid="input-agent-secret" /><Button variant="outline" onClick={() => void navigator.clipboard?.writeText(secret)}><Copy className="w-4 h-4" /></Button></div></div>}
    </div>
    <div className="rounded-lg border bg-card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Client</th><th className="p-3">Scopes</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{clients.map((client) => <tr key={client.id} className="border-b last:border-0"><td className="p-3"><div className="font-medium">{client.name}</div><code className="text-xs text-muted-foreground">{client.id}</code></td><td className="p-3"><div className="flex flex-wrap gap-1">{client.scopes.map((s) => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>)}</div></td><td className="p-3">{client.status === "active" ? <Badge><ShieldCheck className="w-3 h-3 mr-1" />Active</Badge> : <Badge variant="destructive">{client.status}</Badge>}</td><td className="p-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => void mutateClient(client.id, "rotate")}><RefreshCw className="w-3 h-3 mr-1" />Rotate</Button>{client.status === "active" && <Button size="sm" variant="outline" onClick={() => void mutateClient(client.id, "suspend")}><Ban className="w-3 h-3 mr-1" />Suspend</Button>}</td></tr>)}</tbody></table>{!clients.length && <p className="p-6 text-sm text-muted-foreground">No private agent clients registered.</p>}</div>
  </div>;
}