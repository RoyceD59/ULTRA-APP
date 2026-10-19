import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Pencil, Plus, Power, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";

const base = () => API_ORIGIN;
type PromotionType = "bonus_points" | "redemption_boost" | "checkout_discount" | "free_shipping" | "free_water_test";
type ValueMode = "fixed" | "percentage";
interface Promotion {
  id: number; code: string; type: PromotionType; effectMode: ValueMode; effectValue: number | string;
  eligibleProductIds?: (number | string)[]; startsAt: string; endsAt?: string | null; active: boolean;
  globalUseLimit?: number | null; perUserUseLimit?: number | null; useCount?: number;
}
interface FormState { code: string; type: PromotionType; valueMode: ValueMode; value: string; products: string; startsAt: string; endsAt: string; globalUseLimit: string; perCustomerUseLimit: string; }
const emptyForm: FormState = { code: "", type: "checkout_discount", valueMode: "percentage", value: "", products: "", startsAt: "", endsAt: "", globalUseLimit: "", perCustomerUseLimit: "" };
function normalizePromotion(row: Promotion & Record<string, unknown>): Promotion {
  return {
    ...row,
    effectMode: (row.effectMode ?? row.effect_mode) as ValueMode,
    effectValue: (row.effectValue ?? row.effect_value) as number | string,
    eligibleProductIds: (row.eligibleProductIds ?? row.eligible_product_ids) as (number | string)[] | undefined,
    startsAt: (row.startsAt ?? row.starts_at) as string,
    endsAt: (row.endsAt ?? row.ends_at ?? null) as string | null,
    globalUseLimit: (row.globalUseLimit ?? row.global_use_limit ?? null) as number | null,
    perUserUseLimit: (row.perUserUseLimit ?? row.per_user_use_limit ?? null) as number | null,
    useCount: (row.useCount ?? row.use_count ?? 0) as number,
  };
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const response = await fetch(`${base()}/api/uc/admin/promotions${path}`, { method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}
function formFor(p: Promotion): FormState {
  return { code: p.code, type: p.type, valueMode: p.effectMode, value: String(p.effectValue), products: (p.eligibleProductIds ?? []).join(", "), startsAt: p.startsAt.slice(0, 16), endsAt: p.endsAt?.slice(0, 16) ?? "", globalUseLimit: p.globalUseLimit == null ? "" : String(p.globalUseLimit), perCustomerUseLimit: p.perUserUseLimit == null ? "" : String(p.perUserUseLimit) };
}
function payload(form: FormState) {
  const numberOrUndefined = (value: string) => value.trim() ? Number(value) : undefined;
   const waived = form.type === "free_shipping" || form.type === "free_water_test";
   return { code: form.code.trim(), type: form.type, effectMode: waived ? "fixed" : form.valueMode, effectValue: waived ? 0 : Number(form.value), eligibleProductIds: form.type === "free_water_test" ? [] : form.products.split(",").map(x => x.trim()).filter(Boolean), startsAt: new Date(form.startsAt).toISOString(), endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null, globalUseLimit: numberOrUndefined(form.globalUseLimit), perUserUseLimit: numberOrUndefined(form.perCustomerUseLimit) };
}
function PromotionForm({ initial, onDone }: { initial?: Promotion; onDone: () => void }) {
  const { toast } = useToast(); const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(initial ? formFor(initial) : emptyForm);
  useEffect(() => setForm(initial ? formFor(initial) : emptyForm), [initial]);
  const update = (key: keyof FormState, value: string) => setForm(current => ({ ...current, [key]: value }));
  const mutation = useMutation({ mutationFn: () => initial ? request<{ promotion: Promotion }>(`/${initial.id}`, "PATCH", payload(form)) : request<{ promotion: Promotion }>("", "POST", payload(form)), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["promotions"] }); toast({ title: initial ? "Promotion updated" : "Promotion created" }); onDone(); }, onError: (e: Error) => toast({ title: "Promotion could not be saved", description: e.message, variant: "destructive" }) });
  const waived = form.type === "free_shipping" || form.type === "free_water_test";
  const valid = form.code.trim() && (waived || Number(form.value) > 0) && form.startsAt && (!form.endsAt || new Date(form.endsAt) > new Date(form.startsAt));
  return <form onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="rounded-lg border bg-card p-4 space-y-4">
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div><Label htmlFor="promo-code">Code</Label><Input id="promo-code" value={form.code} onChange={e => update("code", e.target.value.toUpperCase())} placeholder="CLEAN10" /></div>
      <div><Label>Promotion type</Label><Select value={form.type} onValueChange={v => update("type", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="checkout_discount">Checkout discount</SelectItem><SelectItem value="free_shipping">Free shipping</SelectItem><SelectItem value="free_water_test">Free water test</SelectItem><SelectItem value="bonus_points">Bonus points</SelectItem><SelectItem value="redemption_boost">Redemption boost</SelectItem></SelectContent></Select></div>
      {!waived && <><div><Label>Value mode</Label><Select value={form.valueMode} onValueChange={v => update("valueMode", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="percentage">Percentage</SelectItem></SelectContent></Select></div>
      <div><Label htmlFor="promo-value">Value</Label><Input id="promo-value" type="number" min="0.01" max={form.valueMode === "percentage" ? 100 : undefined} step="0.01" value={form.value} onChange={e => update("value", e.target.value)} /></div></>}
      <div><Label htmlFor="promo-start">Starts</Label><Input id="promo-start" type="datetime-local" value={form.startsAt} onChange={e => update("startsAt", e.target.value)} /></div>
      <div><Label htmlFor="promo-end">Ends (optional)</Label><Input id="promo-end" type="datetime-local" value={form.endsAt} onChange={e => update("endsAt", e.target.value)} /></div>
      <div><Label htmlFor="promo-global-limit">Global use cap</Label><Input id="promo-global-limit" type="number" min="1" value={form.globalUseLimit} onChange={e => update("globalUseLimit", e.target.value)} /></div>
      <div><Label htmlFor="promo-user-limit">Per-customer cap</Label><Input id="promo-user-limit" type="number" min="1" value={form.perCustomerUseLimit} onChange={e => update("perCustomerUseLimit", e.target.value)} /></div>
    </div>
    {waived && <p className="text-sm text-muted-foreground">{form.type === "free_shipping" ? "Waives the delivery charge when the customer selects delivery. Collection is already free." : "Grants a free physical water test at booking. There is no payment or refund stage in this request flow."}</p>}
    {form.type !== "free_water_test" && <div><Label htmlFor="promo-products">Eligible product IDs <span className="text-muted-foreground">(comma-separated; blank means all products)</span></Label><Input id="promo-products" value={form.products} onChange={e => update("products", e.target.value)} placeholder="101, 205" /></div>}
    <div className="grid grid-cols-2 sm:flex gap-2 sm:justify-end"><Button className="min-h-11" type="button" variant="ghost" onClick={onDone}>Cancel</Button><Button className="min-h-11" disabled={!valid || mutation.isPending}>{mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{initial ? "Save changes" : "Create promotion"}</Button></div>
  </form>;
}
export default function AdminPromotionsPage() {
  const { toast } = useToast(); const qc = useQueryClient(); const [editing, setEditing] = useState<Promotion | null | "new">(null);
  const { data = [], isLoading, isError } = useQuery({ queryKey: ["promotions"], queryFn: () => request<{ promotions: (Promotion & Record<string, unknown>)[] }>("/").then(x => x.promotions.map(normalizePromotion)) });
  const toggle = useMutation({ mutationFn: (p: Promotion) => request<{ promotion: Promotion }>(`/${p.id}/${p.active ? "deactivate" : "activate"}`, "POST"), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["promotions"] }); toast({ title: "Promotion status updated" }); }, onError: (e: Error) => toast({ title: "Status could not be updated", description: e.message, variant: "destructive" }) });
  return <div className="space-y-6"><div className="flex flex-col sm:flex-row sm:justify-between gap-3"><div><h1 className="text-2xl font-bold flex gap-2 items-center"><Tag className="w-6 h-6" /> Promotions</h1><p className="text-sm text-muted-foreground mt-1">Control future rewards, redemption, and checkout offers.</p></div><Button className="min-h-11 w-full sm:w-auto" onClick={() => setEditing("new")}><Plus className="w-4 h-4 mr-2" />Create promotion</Button></div>
    {editing && <PromotionForm initial={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
    {isLoading ? <p className="text-sm text-muted-foreground"><Loader2 className="inline w-4 h-4 animate-spin mr-2" />Loading promotions…</p> : isError ? <p className="text-sm text-destructive">Promotions could not be loaded.</p> : data.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No promotions yet. Create one to set a controlled offer.</div> : <div className="grid gap-3">{data.map(p => <article key={p.id} className="rounded-lg border bg-card p-4 space-y-3"><div className="flex flex-col sm:flex-row sm:justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap gap-2 items-center"><code className="font-semibold break-all">{p.code}</code><Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Active" : "Inactive"}</Badge><Badge variant="outline">{p.type.replace(/_/g, " ")}</Badge></div><p className="text-sm mt-2">{p.effectValue} {p.effectMode === "percentage" ? "%" : "fixed"} · {p.eligibleProductIds?.length ? `${p.eligibleProductIds.length} eligible product(s)` : "All products"}</p><p className="text-xs text-muted-foreground mt-1 flex items-start gap-1"><CalendarClock className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{new Date(p.startsAt).toLocaleString()} {p.endsAt ? `– ${new Date(p.endsAt).toLocaleString()}` : "– no end date"}</span></p></div><div className="grid grid-cols-2 sm:flex gap-2"><Button className="min-h-11" size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil className="w-3.5 h-3.5 mr-1" />Edit</Button><Button className="min-h-11" size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(p)}><Power className="w-3.5 h-3.5 mr-1" />{p.active ? "Deactivate" : "Activate"}</Button></div></div><p className="text-xs text-muted-foreground">Uses: {p.useCount ?? 0}{p.globalUseLimit != null ? ` / ${p.globalUseLimit}` : ""}{p.perUserUseLimit != null ? ` · max ${p.perUserUseLimit} per customer` : ""}</p></article>)}</div>}
  </div>;
}