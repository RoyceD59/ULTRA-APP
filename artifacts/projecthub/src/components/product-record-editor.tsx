import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2, UploadCloud, AlertTriangle, Archive, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { API_ORIGIN } from "@/lib/api-base";
import { requestUploadUrl, useAddProductMedia, type Product, type ProductMedia } from "@/hooks/use-products";
import {
  IMMUTABLE_KEYS, SLOT_LABELS, isConflict, useProductRecord, useSaveProductRecord, useArchiveProductRecord,
  type RecordImage, type RecordJson,
} from "@/hooks/use-product-records";

type Json = unknown;
const pretty = (k: string) => k.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const imgSrc = (s: string) => (s.startsWith("http") || s.startsWith("data:") ? s : `${API_ORIGIN}${s}`);

/** Recursive structured editor: strings, numbers, nulls, lists and nested groups. */
function Field({ label, value, onChange, locked }: { label: string; value: Json; onChange: (v: Json) => void; locked?: boolean }) {
  if (typeof value === "string") {
    const long = value.length > 70 || value.includes("\n");
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {long ? <Textarea disabled={locked} rows={Math.min(8, Math.ceil(value.length / 80) + 1)} value={value} onChange={e => onChange(e.target.value)} />
          : <Input disabled={locked} value={value} onChange={e => onChange(e.target.value)} />}
      </div>
    );
  }
  if (value === null && !/price|days|quantity/i.test(label)) {
    return <div className="space-y-1"><Label className="text-xs">{label} (empty)</Label><Input disabled={locked} value="" onChange={e => onChange(e.target.value || null)} /></div>;
  }
  if (typeof value === "number" || value === null) {
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{label}{value === null ? " (empty)" : ""}</Label>
        <Input disabled={locked} inputMode="decimal" value={value ?? ""} placeholder="Empty"
          onChange={e => { const t = e.target.value.trim(); onChange(t === "" ? null : Number.isFinite(Number(t)) ? Number(t) : value); }} />
      </div>
    );
  }
  if (typeof value === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={locked} checked={value} onChange={e => onChange(e.target.checked)} /> {label}
      </label>
    );
  }
  if (Array.isArray(value)) {
    const proto = value.length ? (typeof value[0] === "object" ? Object.fromEntries(Object.keys(value[0] as object).map(k => [k, ""])) : "") : "";
    return (
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{label}</Label>
          {!locked && <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, clone(proto)])}><Plus className="w-3 h-3 mr-1" />Add</Button>}
        </div>
        {value.map((item, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1"><Field label={`${i + 1}`} value={item} locked={locked} onChange={v => onChange(value.map((x, n) => (n === i ? v : x)))} /></div>
            {!locked && <Button type="button" size="icon" variant="ghost" aria-label="Remove" onClick={() => onChange(value.filter((_, n) => n !== i))}><Trash2 className="w-4 h-4" /></Button>}
          </div>
        ))}
        {value.length === 0 && <p className="text-xs text-muted-foreground">Empty list.</p>}
      </div>
    );
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, Json>;
    return (
      <div className="space-y-3 rounded-md border bg-muted/30 p-3">
        <Label className="text-sm font-medium">{label}</Label>
        {Object.keys(obj).map(k => (
          <Field key={k} label={pretty(k)} value={obj[k]} locked={locked || /(^|_)sku$/.test(k)} onChange={v => onChange({ ...obj, [k]: v })} />
        ))}
      </div>
    );
  }
  return null;
}

function StructuredGroup({ value, onApply }: { value: Record<string, any>; onApply: (v: Record<string, any>) => void }) {
  const serialized = JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState("");
  useEffect(() => { setText(serialized); setError(""); }, [serialized]);
  return <details className="rounded-md border p-3">
    <summary className="cursor-pointer text-sm">Structured fields (advanced)</summary>
    <p className="text-xs text-muted-foreground my-2">Use JSON for nullable objects or empty lists. Apply to the form, then Save page record. The server validates the complete v2.4 record.</p>
    <Textarea aria-label="Structured group JSON" rows={10} value={text} onChange={e => setText(e.target.value)} className="font-mono text-xs" />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => {
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
          Object.keys(parsed).some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !Object.hasOwn(parsed, k)))
          throw new Error("Retain exactly the displayed group keys.");
        onApply(parsed); setError("");
      } catch (e) { setError(`Not applied: ${(e as Error).message}`); }
    }}>Apply JSON to form</Button>
  </details>;
}

const GROUPS: { id: string; title: string; keys: string[] }[] = [
  { id: "publication", title: "Name, publication and record price", keys: ["name", "publishable", "purchasable", "availability", "price_kes"] },
  { id: "copy", title: "Page copy", keys: ["opening", "summary"] },
  { id: "specs", title: "Specifications", keys: ["specs"] },
  { id: "benefits", title: "Benefits", keys: ["benefits"] },
  { id: "suit", title: "Suitability", keys: ["suitability"] },
  { id: "pkg", title: "Package", keys: ["package"] },
  { id: "own", title: "Ownership and service", keys: ["ownership", "service"] },
  { id: "faq", title: "FAQ", keys: ["faq"] },
  { id: "evidence", title: "Evidence and limitations", keys: ["evidence"] },
  { id: "seo", title: "SEO", keys: ["seo"] },
];

type Variant = RecordJson["variants"][number];

/** Add/remove variants. Saved child SKUs keep their identity and cannot be renamed. */
function VariantsEditor({ variants, lockedSkus, onChange }: { variants: Variant[]; lockedSkus: Set<string>; onChange: (v: Variant[]) => void }) {
  const proto: Variant = variants.length
    ? Object.fromEntries(Object.entries(variants[0]).map(([k, v]) => [k, typeof v === "number" ? null : typeof v === "boolean" ? false : Array.isArray(v) ? [] : v && typeof v === "object" ? null : ""])) as Variant
    : { child_sku: "", label: "" };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">Variants</h3>
          <p className="text-xs text-muted-foreground">Saved SKUs are locked. Remove a variant to retire it; add a new one with a fresh unique SKU. New variants start with stock unknown.</p>
        </div>
        <Button type="button" size="sm" variant="outline" data-testid="button-add-variant" onClick={() => onChange([...variants, clone(proto)])}><Plus className="w-3 h-3 mr-1" />Add variant</Button>
      </div>
      {variants.length === 0 && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No variants. The product sells under its parent SKU.</p>}
      {variants.map((v, i) => {
        const locked = lockedSkus.has(v.child_sku);
        return (
          <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto] items-end" data-testid={`row-variant-${i}`}>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Child SKU {locked && "(locked)"}</Label>
              <Input value={v.child_sku} disabled={locked} className="font-mono" onChange={e => onChange(variants.map((x, n) => n === i ? { ...x, child_sku: e.target.value.trim() } : x))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Label</Label>
              <Input value={v.label} onChange={e => onChange(variants.map((x, n) => n === i ? { ...x, label: e.target.value } : x))} />
            </div>
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove variant ${v.label || i + 1}`} onClick={() => {
              if (locked && !window.confirm(`Remove saved variant ${v.child_sku}? Its history is kept, but it will no longer be offered.`)) return;
              onChange(variants.filter((_, n) => n !== i));
            }}><Trash2 className="w-4 h-4" /></Button>
          </div>
        );
      })}
    </div>
  );
}

export function ProductRecordEditor({ sku, product, media = [] }: { sku: string; product?: Product; media?: ProductMedia[] }) {
  const { toast } = useToast();
  const query = useProductRecord(sku);
  const save = useSaveProductRecord(sku);
  const addMedia = useAddProductMedia();
  const archive = useArchiveProductRecord();
  const [, navigate] = useLocation();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecordJson | null>(null);
  const [group, setGroup] = useState("copy");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const loadedRev = useRef<string | number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadSlot = useRef<number>(0);

  useEffect(() => {
    if (query.data && loadedRev.current !== query.data.revision) {
      loadedRev.current = query.data.revision;
      setDraft(clone(query.data.record));
    }
  }, [query.data]);

  const files = useMemo(() => {
    const set = new Map<string, string>();
    for (const i of product?.images ?? []) set.set(i.src, "Catalogue");
    for (const m of media) if (m.type === "photo") set.set(m.url, "Team upload");
    return [...set.entries()];
  }, [product, media]);

  if (query.isLoading) return <div className="flex items-center gap-2 text-muted-foreground p-4"><Loader2 className="w-4 h-4 animate-spin" />Loading page record...</div>;
  if (query.isError || !draft || !query.data) {
    return (
      <Card><CardContent className="p-4 text-sm space-y-2">
        <p className="text-muted-foreground">No editable page record for {sku}: {query.error?.message ?? "not found"}.</p>
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button>
      </CardContent></Card>
    );
  }

  const set = (key: string, v: Json) => setDraft(d => (d ? { ...d, [key]: v } : d));
  const images = [...(draft.images ?? [])].sort((a, b) => a.slot - b.slot);
  const bySlot = (n: number) => images.find(i => i.slot === n);
  const setImages = (next: RecordImage[]) =>
    set("images", [...next].sort((a, b) => a.slot - b.slot).map(im => ({ ...im, label: SLOT_LABELS[im.slot - 1] ?? im.label })));
  const patchSlot = (slot: number, p: Partial<RecordImage>) => setImages(images.map(im => (im.slot === slot ? { ...im, ...p } : im)));
  // Swap with the neighbouring slot (empty or not); other slots never shift.
  const move = (slot: number, d: number) => {
    const to = slot + d;
    if (to < 1 || to > 6) return;
    setImages(images.map(im => (im.slot === slot ? { ...im, slot: to } : im.slot === to ? { ...im, slot } : im)));
  };
  const colours = (draft.variants ?? []).map(v => v.label);
  const mapped = !!product;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const idx = uploadSlot.current; setUploading(idx);
    try {
      const { uploadURL, objectPath, reference } = await requestUploadUrl({ name: file.name, size: file.size, contentType: file.type });
      const put = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error("Upload to storage failed");
      const url = reference || `/api/storage${objectPath}`;
      if (!product) throw new Error("No commerce product is mapped; uploads are unavailable.");
      await addMedia.mutateAsync({ id: product.id, url, type: "photo", alt: file.name });
      if (!bySlot(idx)) setImages([...images, { slot: idx, label: SLOT_LABELS[idx - 1], file: url, alt: "", approved: false }]);
      else patchSlot(idx, { file: url, alt: "", approved: false, child_sku: undefined, pictured_colour: undefined });
      toast({ title: "Photo attached", description: "Set its alt text, then save the page record." });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setUploading(null); e.target.value = ""; }
  };

  const submit = () => {
    setError(null); setConflict(false); setSavedAt(null);
    const skus = (draft.variants ?? []).map(v => String(v.child_sku ?? "").trim());
    if (skus.some(x => !x)) { setError("Every variant needs a child SKU and label before saving."); return; }
    if (new Set(skus).size !== skus.length || skus.includes(draft.parent_sku)) { setError("Child SKUs must be unique and different from the parent SKU."); return; }
    const missingAlt = images.find(i => i.approved && !i.alt?.trim());
    if (missingAlt) { setError(`Photo ${missingAlt.slot} (${SLOT_LABELS[missingAlt.slot - 1]}) needs alt text.`); return; }
    save.mutate({ revision: query.data!.revision, record: draft }, {
      onSuccess: () => { setSavedAt(new Date().toLocaleTimeString()); toast({ title: "Product record saved", description: "Shared record updated. Publication still follows the publishable flag." }); },
      onError: (err: Error) => { if (isConflict(err)) setConflict(true); else setError(err.message); },
    });
  };

  const priceMismatch = !!product && draft.price_kes !== null && Number(product.price) !== draft.price_kes;
  const statusBadge = (label: string, ok: boolean) => <Badge variant={ok ? "default" : "secondary"}>{label}</Badge>;
  const evidence = draft.evidence as { claims?: { status: string }[] } | undefined;
  const g = GROUPS.find(x => x.id === group)!;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Product record</CardTitle>
            <CardDescription>Shared app-owned record: page copy, photos, variants and the authoritative retail price. Revision {String(query.data.revision)}.</CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" data-testid="button-archive-record" disabled={archive.isPending || save.isPending} className="gap-2" onClick={() => {
              if (!window.confirm(`Archive ${draft.name ?? draft.code}? It will be hidden from the catalogue. Orders, filters and history stay intact.`)) return;
              archive.mutate(draft.code, {
                onSuccess: () => { toast({ title: "Product archived", description: `${draft.code} is archived. History is preserved.` }); navigate("/admin/products"); },
                onError: (err: Error) => setError(`Archive failed: ${err.message}`),
              });
            }}>
              {archive.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}Archive
            </Button>
            <Button onClick={submit} disabled={save.isPending || archive.isPending} className="gap-2" data-testid="button-save-record">
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{save.isPending ? "Saving..." : "Save product record"}
            </Button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap pt-2">
          {statusBadge(draft.publishable ? "Publishable" : "Held back", !!draft.publishable)}
          {statusBadge(draft.purchasable ? "Purchasable" : "Not purchasable", !!draft.purchasable)}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 pt-2" data-testid="panel-publication">
          {([
            ["publishable", "Published on Companion", "Shows the product page to customers."],
            ["purchasable", "Available to buy", "Allows checkout. Stock must still be reviewed; unknown stock is never sold."],
          ] as const).map(([key, label, hint]) => {
            const on = !!draft[key];
            return (
              <label key={key} className="flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer">
                <input type="checkbox" className="mt-1" data-testid={`toggle-${key}`} checked={on} disabled={save.isPending || archive.isPending}
                  onChange={e => {
                    const next = e.target.checked;
                    const msg = next
                      ? `${label}: turn on for ${draft.name ?? draft.code}? This saves the whole record now, including any unsaved edits.`
                      : `${label}: turn off for ${draft.name ?? draft.code}? This saves the whole record now, including any unsaved edits.`;
                    if (!window.confirm(msg)) return;
                    const updated = { ...draft, [key]: next } as RecordJson;
                    setDraft(updated); setError(null); setConflict(false); setSavedAt(null);
                    save.mutate({ revision: query.data!.revision, record: updated }, {
                      onSuccess: () => { setSavedAt(new Date().toLocaleTimeString()); toast({ title: "Saved", description: `${label} is now ${next ? "on" : "off"}.` }); },
                      onError: (err: Error) => { setDraft(d => d ? { ...d, [key]: !next } : d); if (isConflict(err)) setConflict(true); else setError(`${label} not changed: ${err.message}`); },
                    });
                  }} />
                <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
              </label>
            );
          })}
          {evidence?.claims && <Badge variant="outline">{evidence.claims.filter(c => ["verified", "manufacturer", "customer_reported"].includes(c.status)).length} of {evidence.claims.length} claims public</Badge>}
          <Badge variant="outline">Identity locked: {draft.code} / {draft.slug} / {draft.parent_sku}</Badge>
        </div>
        {!product && <div className="rounded-md border p-3 text-sm text-muted-foreground">No operational product is linked to this record yet, so stock and photo uploads are unavailable here. Page copy, variants and price can still be edited. New records start unpublished with stock unknown.</div>}
        {priceMismatch && product && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Record price KES {draft.price_kes} differs from the operational listing price KES {product?.price}. The record price is authoritative for Companion checkout. Reload after saving to confirm both match.</span>
          </div>
        )}
        {conflict && <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive flex items-center justify-between gap-2">
          <span>Someone else saved this record. Reload to get the latest version; your unsaved edits will be replaced.</span>
          <Button size="sm" variant="outline" onClick={() => { loadedRev.current = null; setConflict(false); query.refetch(); }}>Reload</Button></div>}
        {savedAt && !error && !conflict && <div role="status" className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 dark:bg-green-950/20 p-3 text-sm text-green-800 dark:text-green-300"><CheckCircle2 className="w-4 h-4" />Saved at {savedAt}.</div>}
        {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <h3 className="font-medium">Photos (six slots)</h3>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SLOT_LABELS.map((label, i) => {
              const slot = i + 1;
              const im = bySlot(slot);
              return (
                <div key={label} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between"><Badge variant="outline">{i + 1}. {label}</Badge>
                    {im && <div className="flex gap-1">
                      <Button type="button" size="icon" variant="ghost" aria-label="Move up" disabled={slot === 1} onClick={() => move(slot, -1)}><ArrowUp className="w-4 h-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label="Move down" disabled={slot === 6} onClick={() => move(slot, 1)}><ArrowDown className="w-4 h-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label="Remove photo" onClick={() => patchSlot(slot, { file: `images/${draft.parent_sku}_${String(slot).padStart(2,'0')}.jpg`, alt: null, approved: false, child_sku: undefined, pictured_colour: undefined })}><Trash2 className="w-4 h-4" /></Button>
                    </div>}
                  </div>
                  {im ? (
                    <>
                      <div className="aspect-[4/3] bg-muted rounded border flex items-center justify-center">{!im.file.startsWith("images/") ? <img src={imgSrc(im.file)} alt={im.alt ?? ""} className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted-foreground">No photo uploaded</span>}</div>
                      <Input aria-label={`Alt text ${label}`} placeholder="Alt text" value={im.alt ?? ""} onChange={e => patchSlot(slot, { alt: e.target.value })} />
                      <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={im.pictured_colour ?? ""}
                        onChange={e => patchSlot(slot, { pictured_colour: e.target.value || undefined, child_sku: (draft.variants ?? []).find(v => v.label === e.target.value)?.child_sku })}>
                        <option value="">No pictured colour</option>
                        {colours.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={files.some(([f]) => f === im.file) ? im.file : ""} onChange={e => e.target.value && patchSlot(slot, { file: e.target.value })}>
                        <option value="">{files.some(([f]) => f === im.file) ? "" : "Current file (not in catalogue)"}</option>
                        {files.map(([f, src], n) => <option key={f} value={f}>{src} image {n + 1}</option>)}
                      </select>
                    </>
                  ) : <p className="text-xs text-muted-foreground">Empty. This slot is hidden on the page.</p>}
                  <Button type="button" size="sm" variant="outline" disabled={!mapped || uploading !== null} title={mapped ? undefined : "No commerce product mapped"} onClick={() => { uploadSlot.current = slot; fileRef.current?.click(); }}>
                    {uploading === slot ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UploadCloud className="w-4 h-4 mr-2" />}{im ? "Replace" : "Upload"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <VariantsEditor
          variants={draft.variants ?? []}
          lockedSkus={new Set((query.data.record.variants ?? []).map(v => v.child_sku))}
          onChange={next => setDraft(d => {
            if (!d) return d;
            const keep = new Set(next.map(v => v.child_sku));
            const imgs = (d.images ?? []).map(im => im.child_sku && !keep.has(im.child_sku) ? { ...im, child_sku: undefined, pictured_colour: undefined } : im);
            return { ...d, variants: next, images: imgs };
          })}
        />

        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap" role="tablist">
            {GROUPS.map(x => <Button key={x.id} type="button" role="tab" aria-selected={x.id === group} size="sm" variant={x.id === group ? "default" : "outline"} onClick={() => setGroup(x.id)}>{x.title}</Button>)}
          </div>
          <div className="space-y-3">
            <StructuredGroup value={Object.fromEntries(g.keys.filter(k => k in draft).map(k => [k, draft[k]]))}
              onApply={values => setDraft(previous => previous ? { ...previous, ...values } : previous)} />
            {g.keys.filter(k => k in draft).map(k => (
              <Field key={k} label={pretty(k)} value={draft[k]} locked={IMMUTABLE_KEYS.includes(k)} onChange={v => set(k, v)} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
