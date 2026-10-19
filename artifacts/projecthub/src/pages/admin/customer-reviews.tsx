import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RefreshCw, RotateCcw, Search, ShieldAlert, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, isTeamAdmin, refreshTeamUser } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Sentiment = "Positive" | "Neutral" | "Negative";
type AiSentiment = Sentiment | "Mixed";
type Status = "pending" | "processing" | "completed" | "failed" | "unavailable";
interface Review {
  id: string | number; productId: string | number; productName: string; authorName: string; rating: number;
  title: string | null; body: string | null; media: { url: string; type: "photo" | "video" }[];
  createdAt: string; editedAt: string | null; ratingSentiment: Sentiment; disagreement: boolean;
  analysis: { status: Status; category?: AiSentiment; explanation?: string; themes?: string[]; analyzedAt?: string; error?: string };
}
interface Resp {
  reviews: Review[]; total: number; page: number; limit: number;
  counts: { rating: Record<Sentiment, number>; ai: Record<AiSentiment, number>; status: Record<Status, number>; disagreements: number };
  products: { id: string | number; name: string }[];
}
interface Filters { productId: string; rating: string; ratingSentiment: string; aiSentiment: string; status: string; disagreement: string; search: string }
const EMPTY: Filters = { productId: "", rating: "", ratingSentiment: "", aiSentiment: "", status: "", disagreement: "", search: "" };
const LIMIT = 20;
const STATUSES: Status[] = ["pending", "processing", "completed", "failed", "unavailable"];

function safeUrl(url: string): string | null {
  try {
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
    return `${API_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
  } catch { return null; }
}
const fmt = (s: string) => { const d = new Date(s); return isNaN(+d) ? "Unknown" : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
const tone = (s: string) => s === "Positive" ? "border-emerald-500/50 text-emerald-700" : s === "Negative" ? "border-destructive/50 text-destructive" : s === "Mixed" ? "border-amber-500/60 text-amber-700" : "border-border text-muted-foreground";

function Sel({ label, value, onChange, options, id }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; id: string }) {
  return <label className={cn("text-xs text-muted-foreground space-y-1 block", id === "product" && "col-span-2")}>{label}
    <select data-testid={`select-${id}`} value={value} onChange={(e) => onChange(e.target.value)} className="block w-full h-9 rounded-md border bg-background px-2 text-sm text-foreground">
      <option value="">All</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select></label>;
}

function ReviewCard({ r, onRetry, retrying }: { r: Review; onRetry: () => void; retrying: boolean }) {
  const [open, setOpen] = useState(false);
  const a = r.analysis;
  const body = r.body ?? "";
  const long = body.length > 240;
  return <Card data-testid={`card-review-${r.id}`} className={cn(r.disagreement && "border-amber-500/50")}><CardContent className="p-4 space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold break-words">{r.title || "Untitled review"}</p>
        <p className="text-xs text-muted-foreground">{r.productName}{r.productName !== `Product #${r.productId}` && ` · Product #${r.productId}`} · {r.authorName}</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1 text-sm font-medium" aria-label={`${r.rating} of 5 stars`}><Star className="w-4 h-4 fill-current text-amber-500" />{r.rating}/5</span>
        <Badge variant="outline" className={tone(r.ratingSentiment)}>Rating: {r.ratingSentiment}</Badge>
        {a.status === "completed" && a.category && <Badge variant="outline" className={tone(a.category)}>Automated: {a.category}</Badge>}
        {r.disagreement && <Badge variant="outline" className="border-amber-500/60 text-amber-700">Rating and text differ</Badge>}
      </div>
    </div>
    {body && <p className="text-sm whitespace-pre-wrap break-words">{open || !long ? body : `${body.slice(0, 240)}…`}</p>}
    {r.media.length > 0 && <div className="flex flex-wrap gap-2">{r.media.map((m, i) => {
      const u = safeUrl(m.url); if (!u) return null;
      return m.type === "video" && open ? <video key={i} src={u} controls preload="metadata" className="h-40 rounded-md border" />
        : m.type === "photo" && open ? <a key={i} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt={`Review photo ${i + 1}`} loading="lazy" className="h-40 rounded-md border object-cover" /></a>
        : <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="text-xs underline text-primary">{m.type === "video" ? "Video" : "Photo"} {i + 1}</a>;
    })}</div>}
    {(long || r.media.length > 0) && <button data-testid={`button-expand-${r.id}`} onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-primary hover:underline">{open ? <><ChevronUp className="w-3 h-3" />Show less</> : <><ChevronDown className="w-3 h-3" />{long ? "Read full review" : "Show media"}{r.media.length > 0 && ` (${r.media.length} media)`}</>}</button>}
    <div className="rounded-md bg-muted/40 p-3 space-y-1.5 text-xs">
      <p className="font-medium">Automated assessment <span className="font-normal text-muted-foreground">· machine-generated aid for staff, not a verdict; verify against the review.</span></p>
      {a.status === "completed" ? <>
        <p><span className="font-medium">{a.category ?? "No category"}</span>{a.analyzedAt && <span className="text-muted-foreground"> · analysed {fmt(a.analyzedAt)}</span>}</p>
        {a.explanation && <p className="text-muted-foreground">{a.explanation}</p>}
        {a.themes && a.themes.length > 0 && <div className="flex flex-wrap gap-1">{a.themes.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>}
      </> : <p className="text-muted-foreground capitalize">Status: {a.status}{a.status === "failed" && a.error ? ` — ${a.error}` : ""}{a.status === "unavailable" ? " — assessment not available for this review" : ""}</p>}
      {(a.status === "failed" || (a.status === "unavailable" && a.error !== "Deleted account")) && <Button data-testid={`button-retry-${r.id}`} size="sm" variant="outline" disabled={retrying} onClick={onRetry} className="h-7 text-xs gap-1">{retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}Retry assessment</Button>}
    </div>
    <p className="text-[11px] text-muted-foreground">Submitted {fmt(r.createdAt)} · {r.editedAt ? `Last edited ${fmt(r.editedAt)}` : "Last edit time unknown"}</p>
  </CardContent></Card>;
}

export default function CustomerReviewsPage() {
  const { toast } = useToast();
  const [allowed, setAllowed] = useState(isTeamAdmin);
  const [denied, setDenied] = useState(!isTeamAdmin());
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [retrying, setRetrying] = useState<Set<string | number>>(new Set());
  const ctl = useRef<AbortController | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (silent: boolean) => {
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    const my = ++seq.current;
    if (!silent) { setLoading(true); setData(null); }
    const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    (Object.keys(applied) as (keyof Filters)[]).forEach((k) => { const v = applied[k].trim(); if (v) p.set(k, v); });
    try {
      const res = await apiFetch<Resp>(`/admin/customer-reviews?${p}`, { signal: c.signal });
      if (my !== seq.current) return;
      setData(res); setError(null); setUpdated(new Date());
    } catch (e) {
      if (c.signal.aborted || my !== seq.current) return;
      const msg = e instanceof Error ? e.message : "Failed to load";
      if (/\(403\)|forbidden|admin/i.test(msg)) { setDenied(true); setData(null); void refreshTeamUser().then(() => setAllowed(isTeamAdmin())).catch(() => undefined); }
      else { setError(msg); }
    } finally { if (my === seq.current) setLoading(false); }
  }, [applied, page]);

  useEffect(() => {
    if (!allowed || denied) return;
    void load(false);
    const t = window.setInterval(() => void load(true), 15_000);
    return () => { window.clearInterval(t); ctl.current?.abort(); };
  }, [load, allowed, denied]);

  const retry = async (id: string | number) => {
    setRetrying((s) => new Set(s).add(id));
    try { await apiFetch(`/admin/customer-reviews/${id}/retry`, { method: "POST" }); toast({ title: "Retry queued" }); void load(true); }
    catch (e) {
      const message = e instanceof Error ? e.message : "Retry failed";
      if (/\(403\)|forbidden|admin/i.test(message)) {
        setDenied(true); setData(null);
        void refreshTeamUser().then(() => setAllowed(isTeamAdmin())).catch(() => undefined);
      } else { toast({ title: "Retry failed", description: message, variant: "destructive" }); }
    }
    finally { setRetrying((s) => { const n = new Set(s); n.delete(id); return n; }); }
  };

  const apply = (next: Filters) => { setApplied(next); setPage(1); };
  const set = (k: keyof Filters) => (v: string) => { const n = { ...filters, [k]: v }; setFilters(n); if (k !== "search") apply(n); };

  if (!allowed || denied) return <div data-testid="state-denied" className="flex flex-col items-center justify-center h-64 gap-3 text-center"><ShieldAlert className="w-8 h-8 text-muted-foreground" /><p className="text-lg font-semibold">Administrators only</p><p className="text-sm text-muted-foreground max-w-xs">Customer reviews are restricted to administrators.</p></div>;

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const filtered = Object.values(applied).some(Boolean);
  const stat = (label: string, n: number, t = "") => <div key={label} className="rounded-md border px-3 py-2 min-w-24"><p className="text-[11px] text-muted-foreground">{label}</p><p className={cn("text-lg font-semibold", t)}>{n}</p></div>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold tracking-tight">Customer Reviews</h1><p className="text-sm text-muted-foreground mt-1">Internal view. Automated assessments are an aid for staff and are never shown to customers.</p></div>
      <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground" data-testid="text-updated">{updated ? `Updated ${updated.toLocaleTimeString("en-GB")} · auto-refresh 15s` : ""}</span>
        <Button data-testid="button-refresh" variant="outline" size="sm" className="gap-2" onClick={() => void load(true)}><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />Refresh</Button></div>
    </div>

    {data && <div className="space-y-2" data-testid="section-counts">
      <p className="text-xs text-muted-foreground">Counts reflect all {data.total} matching reviews.</p>
      <div className="flex flex-wrap gap-2">
        {(["Positive", "Neutral", "Negative"] as Sentiment[]).map((s) => stat(`Rating ${s}`, data.counts.rating[s]))}
        {(["Positive", "Neutral", "Negative", "Mixed"] as AiSentiment[]).map((s) => stat(`Automated ${s}`, data.counts.ai[s]))}
        {stat("Disagreements", data.counts.disagreements, "text-amber-700")}
      </div>
      <div className="flex flex-wrap gap-2">{STATUSES.map((s) => stat(`Analysis ${s}`, data.counts.status[s]))}</div>
    </div>}

    <form onSubmit={(e) => { e.preventDefault(); apply(filters); }} className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
      <Sel id="product" label="Product" value={filters.productId} onChange={set("productId")} options={(data?.products ?? []).map((p) => [String(p.id), p.name])} />
      <Sel id="rating" label="Stars" value={filters.rating} onChange={set("rating")} options={[1, 2, 3, 4, 5].map((n) => [String(n), `${n}`])} />
      <Sel id="rating-sentiment" label="Rating sentiment" value={filters.ratingSentiment} onChange={set("ratingSentiment")} options={["Positive", "Neutral", "Negative"].map((s) => [s, s])} />
      <Sel id="ai-sentiment" label="Automated assessment" value={filters.aiSentiment} onChange={set("aiSentiment")} options={["Positive", "Neutral", "Negative", "Mixed"].map((s) => [s, s])} />
      <Sel id="status" label="Analysis status" value={filters.status} onChange={set("status")} options={STATUSES.map((s) => [s, s])} />
      <Sel id="disagreement" label="Disagreement" value={filters.disagreement} onChange={set("disagreement")} options={[["true", "Only disagreements"], ["false", "No disagreement"]]} />
      <div className="col-span-2 md:col-span-4 lg:col-span-7 flex gap-2">
        <div className="relative flex-1"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input data-testid="input-search" className="pl-8" placeholder="Search title or review text" value={filters.search} onChange={(e) => set("search")(e.target.value)} /></div>
        <Button type="submit" data-testid="button-search">Search</Button>
        {filtered && <Button type="button" variant="ghost" data-testid="button-clear" onClick={() => { setFilters(EMPTY); apply(EMPTY); }}>Clear</Button>}
      </div>
    </form>

    {error && <div role="alert" data-testid="state-error" className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><AlertTriangle className="w-4 h-4" /><span className="flex-1">{error}{data ? " — showing last loaded data." : ""}</span><Button size="sm" variant="outline" onClick={() => void load(false)}>Retry</Button></div>}

    {loading && !data ? <div className="space-y-3" data-testid="state-loading">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      : data && data.reviews.length === 0 ? <div data-testid="state-empty" className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">{filtered ? "No reviews match these filters." : "No customer reviews yet."}</div>
      : data && <div className="space-y-3">{data.reviews.map((r) => <ReviewCard key={r.id} r={r} retrying={retrying.has(r.id)} onRetry={() => void retry(r.id)} />)}</div>}

    {data && data.total > 0 && <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">Page {data.page} of {pages} · {data.total} reviews</span>
      <div className="flex gap-2"><Button data-testid="button-prev" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button data-testid="button-next" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
    </div>}
  </div>;
}
