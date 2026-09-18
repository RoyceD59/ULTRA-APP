import { useEffect, useState } from "react";
import { FileText, Loader2, Plus, Save, Send, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getAuthHeaders } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";

type GuideSummary = { id: string; slug: string; title: string; summary: string; status: string; version: number };
const empty = { slug: "", title: "", summary: "", category: "Installation", products: "", icon: "document-text-outline", readTime: "3 min read", sections: [] };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_ORIGIN}${path}`, { ...init, headers: { "Content-Type": "application/json", ...getAuthHeaders(), ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error ?? `Request failed (${response.status})`));
  return body;
}

export default function GuidesAdminPage() {
  const [guides, setGuides] = useState<GuideSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [json, setJson] = useState("[]");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const body = await request("/api/uc/admin/guides");
    setGuides(body.guides ?? []);
  };
  useEffect(() => { void load().catch((reason) => setError(String(reason.message ?? reason))); }, []);

  const select = async (id: string) => {
    setBusy(true); setError("");
    try {
      const body = await request(`/api/uc/admin/guides/${id}`);
      const guide = body.guide;
      setSelected(id);
      setForm({ ...empty, ...guide });
      setJson(JSON.stringify(guide.sections ?? [], null, 2));
    } catch (reason) { setError(String((reason as Error).message)); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setError("");
    try {
      const body = await request("/api/uc/admin/guides", { method: "POST", body: JSON.stringify({ title: "New guide", summary: "Draft guide", sections: [] }) });
      await load(); await select(body.guide.id);
    } catch (reason) { setError(String((reason as Error).message)); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const sections = JSON.parse(json);
      await request(`/api/uc/admin/guides/${selected}`, { method: "PUT", body: JSON.stringify({ ...form, sections }) });
      await load();
    } catch (reason) { setError(String((reason as Error).message)); } finally { setBusy(false); }
  };
  const publish = async (action: "publish" | "unpublish") => {
    if (!selected) return;
    setBusy(true); setError("");
    try { await request(`/api/uc/admin/guides/${selected}/${action}`, { method: "POST" }); await load(); await select(selected); }
    catch (reason) { setError(String((reason as Error).message)); } finally { setBusy(false); }
  };

  return <div className="p-6 space-y-6 max-w-6xl">
    <div className="flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">Companion Guides</h1><p className="text-sm text-muted-foreground">Publish cached installation content without making Companion wait for WooCommerce.</p></div>
      <Button onClick={() => void create()} disabled={busy}><Plus className="w-4 h-4 mr-2" />New guide</Button>
    </div>
    {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="rounded-lg border divide-y">
        {guides.map((guide) => <button key={guide.id} onClick={() => void select(guide.id)} className="w-full text-left p-3 hover:bg-muted/50">
          <div className="flex items-center gap-2"><FileText className="w-4 h-4" /><span className="font-medium truncate">{guide.title}</span></div>
          <div className="mt-1 text-xs text-muted-foreground">{guide.status} · v{guide.version}</div>
        </button>)}
        {!guides.length && <div className="p-4 text-sm text-muted-foreground">No guides yet.</div>}
      </div>
      <div className="rounded-lg border p-5 space-y-5">
        {!selected ? <div className="py-16 text-center text-muted-foreground">Select a guide or create a draft.</div> : <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>Slug</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
            <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Summary</Label><Textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
            <div><Label>Products</Label><Input value={form.products} onChange={(e) => setForm({ ...form, products: e.target.value })} /></div>
            <div><Label>Read time</Label><Input value={form.readTime} onChange={(e) => setForm({ ...form, readTime: e.target.value })} /></div>
          </div>
          <div><Label>Sections and media JSON</Label><p className="text-xs text-muted-foreground mb-2">Media kinds: image, animation, or video. Use HTTPS URLs or approved guide object paths. Videos: max 25 MB / 90 seconds; animations: max 8 MB.</p><Textarea className="min-h-[300px] font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} /></div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save draft</Button>
            <Button variant="secondary" onClick={() => void publish("publish")} disabled={busy}><Send className="w-4 h-4 mr-2" />Publish</Button>
            <Button variant="outline" onClick={() => void publish("unpublish")} disabled={busy}><EyeOff className="w-4 h-4 mr-2" />Unpublish</Button>
          </div>
        </>}
      </div>
    </div>
  </div>;
}