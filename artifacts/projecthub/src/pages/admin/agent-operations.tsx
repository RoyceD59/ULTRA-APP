import { useCallback, useEffect, useState } from "react";
import { Bot, Copy, KeyRound, RefreshCw, ShieldAlert, Ban, Trash2 } from "lucide-react";
import { Link } from "wouter";
import type { AgentClient } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-base";
import { getAuthHeaders } from "@/lib/team-auth";

const SCOPES = ["companion.monitor.read", "companion.users.read", "interactions.read", "alison.read"] as const;
type Credentials = { id: string; name: string; secret: string };

async function request(path: string, init?: RequestInit) {
  const res = await fetch(apiUrl(path), { ...init, headers: { ...(getAuthHeaders() ?? {}), ...(init?.headers ?? {}) } });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const messages: Record<string, string> = {
      client_must_be_inactive: "Suspend this client before deleting it. It may have been reactivated in another session.",
      client_in_use: "This client still has an active token. Suspend it again to revoke tokens before deleting.",
    };
    throw new Error(messages[body?.error] ?? `Request failed (${res.status}). Refresh and try again.`);
  }
  if (!body) throw new Error("The API returned an unexpected response. Please try again.");
  return body;
}

export default function AgentOperationsPage() {
  const { toast } = useToast();
  const [clients, setClients] = useState<AgentClient[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["alison.read"]);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request("/oauth/clients");
      setClients(data.clients);
      setLoadError(false);
    } catch {
      setLoadError(true);
      toast({ title: "Could not load agent clients", description: "Check your connection and refresh the list.", variant: "destructive" });
    } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);
  const create = async (alisonOnly = false) => {
    setBusy(true);
    setCredentials(null);
    try {
      const data = await request("/oauth/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: name.trim() || "Alison conversation viewer", scopes: alisonOnly ? ["alison.read"] : scopes,
      }) });
      setCredentials({ id: data.client.id, name: data.client.name, secret: data.clientSecret });
      setName(""); await load();
      toast({ title: "Agent client created", description: "Copy the secret now. It will not be shown again." });
    } catch (e) { toast({ title: "Could not create client", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const mutateClient = async (id: string, path: string) => {
    setBusy(true);
    if (path === "rotate" || credentials?.id === id) setCredentials(null);
    try {
      const data = await request(`/oauth/clients/${encodeURIComponent(id)}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(path === "suspend" ? { status: "suspended" } : {}) });
      if (data.clientSecret) setCredentials({ id: data.client.id, name: data.client.name, secret: data.clientSecret });
      await load();
      toast({ title: path === "rotate" ? "Secret rotated; previous tokens revoked" : "Client suspended; tokens revoked" });
    }
    catch (e) { toast({ title: "Client update failed", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const removeClient = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setBusy(true);
    try {
      await request(`/oauth/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
      setClients((current) => current.filter((client) => client.id !== id));
      if (credentials?.id === id) setCredentials(null);
      setDeleteTarget(null);
      toast({ title: "Client deleted", description: "Its credentials and tokens are removed. Audit history is retained." });
    } catch (e) {
      toast({ title: "Client not deleted", description: (e as Error).message, variant: "destructive" });
      setDeleteTarget(null);
      await load();
    } finally { setBusy(false); }
  };
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy unavailable", description: "Select and copy the field manually.", variant: "destructive" });
    }
  };
  return <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
    <div className="flex items-start gap-3"><Bot className="w-7 h-7 text-primary mt-1" /><div><h1 className="text-2xl font-semibold">Agent operations</h1><p className="text-sm text-muted-foreground mt-1">Private ProjectHub access for approved back-office agents. Companion customers never see this area.</p></div></div>
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div><h2 className="font-semibold">Register a confidential service client</h2><p className="text-sm text-muted-foreground">Read-only scopes are available in v1. Secrets are displayed once and stored only as hashes.</p></div>
      <div className="space-y-2">
        <Label htmlFor="agent-name">Client name</Label>
        <Input id="agent-name" maxLength={120} data-testid="input-agent-name" placeholder="Alison conversation viewer" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="rounded-md border p-3 space-y-2">
        <p className="text-sm">For Alison conversations, create a viewer with only <code>alison.read</code>.</p>
        <Button data-testid="button-create-alison-viewer" disabled={busy} onClick={() => void create(true)}><KeyRound className="w-4 h-4 mr-2" />Create Alison viewer</Button>
      </div>
      <fieldset disabled={busy} className="space-y-2">
        <legend className="text-sm font-medium">Custom client permissions</legend>
        <div className="flex flex-wrap gap-2">{SCOPES.map((scope) => <label key={scope} className="flex items-center gap-2 text-xs border rounded px-2 py-3"><input type="checkbox" checked={scopes.includes(scope)} onChange={(e) => setScopes((s) => e.target.checked ? [...s, scope] : s.filter((x) => x !== scope))} />{scope}</label>)}</div>
        <Button variant="outline" data-testid="button-create-agent" disabled={busy || !name.trim() || !scopes.length} onClick={() => void create()}>Create custom client</Button>
      </fieldset>
      {credentials && <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 space-y-3" data-testid="agent-credentials">
        <p className="text-sm font-medium flex items-center gap-2"><ShieldAlert className="w-4 h-4 shrink-0" />Copy this matching ID and secret now</p>
        <p className="text-sm break-words">{credentials.name}. The secret is shown only here and is not saved in your browser.</p>
        <div className="space-y-1"><Label htmlFor="agent-issued-id">Client ID</Label><div className="flex gap-2">
          <Input id="agent-issued-id" readOnly value={credentials.id} data-testid="input-agent-issued-id" />
          <Button variant="outline" aria-label="Copy client ID" onClick={() => void copy(credentials.id, "Client ID")}><Copy className="w-4 h-4" /></Button>
        </div></div>
        <div className="space-y-1"><Label htmlFor="agent-issued-secret">Client secret</Label><div className="flex gap-2">
          <Input id="agent-issued-secret" autoComplete="off" readOnly value={credentials.secret} data-testid="input-agent-secret" />
          <Button variant="outline" aria-label="Copy client secret" onClick={() => void copy(credentials.secret, "Client secret")}><Copy className="w-4 h-4" /></Button>
        </div></div>
        <p className="text-sm">Use this pair in <Link className="underline" href="/alison-conversations">Alison conversations</Link> in the same environment. Save the secret securely before leaving this page.</p>
        <Button size="sm" variant="ghost" onClick={() => setCredentials(null)}>Dismiss credentials</Button>
      </div>}
    </div>
    <section className="rounded-lg border bg-card" aria-labelledby="registered-clients">
      <div className="p-4 border-b flex flex-wrap items-center justify-between gap-2">
        <h2 id="registered-clients" className="font-semibold">Registered clients</h2>
        <Button variant="outline" disabled={busy || loading} onClick={() => void load()}><RefreshCw className="w-4 h-4 mr-2" />Refresh list</Button>
      </div>
      <p className="p-4 text-sm text-muted-foreground">Suspend unused clients before deleting. Rotation replaces the secret, revokes tokens and reactivates the client, but does not extend its expiry.</p>
      {loading && <p className="p-4 text-sm" role="status">Loading clients…</p>}
      {loadError && <p className="p-4 text-sm text-destructive" role="alert">The list could not be refreshed. Refresh before changing clients.</p>}
      {!loading && !loadError && !clients.length && <p className="p-4 text-sm">No private agent clients registered.</p>}
      {clients.map((client) => <article key={client.id} data-testid={`agent-client-${client.id}`} className="border-t p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><h3 className="font-medium break-words">{client.name}</h3><code className="text-xs text-muted-foreground break-all">{client.id}</code></div>
          <Badge variant={client.status === "active" ? "secondary" : "destructive"}>{client.status}</Badge>
        </div>
        <div className="flex flex-wrap gap-1">{client.scopes.map((scope) => <Badge key={scope} variant="outline" className="text-xs break-all">{scope}</Badge>)}</div>
        <p className="text-xs text-muted-foreground">Last token issued: {client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString() : "Never"}. Expiry: {client.expiresAt ? new Date(client.expiresAt).toLocaleString() : "None"}.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || loadError || loading} aria-label={`Rotate secret for ${client.name}`} onClick={() => void mutateClient(client.id, "rotate")}><RefreshCw className="w-3 h-3 mr-1" />Rotate</Button>
          {client.status === "active" ? <Button variant="outline" disabled={busy || loadError || loading} aria-label={`Suspend ${client.name}`} onClick={() => void mutateClient(client.id, "suspend")}><Ban className="w-3 h-3 mr-1" />Suspend</Button>
            : <Button variant="destructive" disabled={busy || loadError || loading} aria-label={`Delete ${client.name}`} onClick={() => setDeleteTarget(client)}><Trash2 className="w-3 h-3 mr-1" />Delete</Button>}
        </div>
      </article>)}
    </section>
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !busy) setDeleteTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this client permanently?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            Delete {deleteTarget?.name} ({deleteTarget?.id}) and its credentials and tokens. This cannot be undone.
            No agent should still depend on this client. The server will refuse deletion if it is active or still has a live token. Audit history will be kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void removeClient(); }}>{busy ? "Deleting…" : "Delete permanently"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}