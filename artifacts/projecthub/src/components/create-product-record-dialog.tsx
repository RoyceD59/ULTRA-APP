import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  SLOT_LABELS, useCreateProductRecord, useProductRecord,
  type AuthoredRecordSummary, type RecordJson,
} from "@/hooks/use-product-records";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const blankLike = (v: unknown): unknown =>
  typeof v === "number" ? null : typeof v === "boolean" ? false : Array.isArray(v) ? [] : v && typeof v === "object" ? null : "";

/**
 * Creates a new app-owned record using an existing full record as the shape.
 * Identity (code, slug, parent SKU, child SKUs) must be fresh; nothing is guessed by name.
 */
export function CreateProductRecordDialog({ templates }: { templates: AuthoredRecordSummary[] }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [slug, setSlug] = useState("");
  const [parentSku, setParentSku] = useState("");
  const [variants, setVariants] = useState<{ child_sku: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const template = useProductRecord(templateKey || undefined);
  const create = useCreateProductRecord();

  const reset = () => { setTemplateKey(""); setName(""); setCode(""); setSlug(""); setParentSku(""); setVariants([]); setError(null); };

  const submit = () => {
    setError(null);
    const t = template.data?.record;
    if (!t) { setError("Choose a template record and wait for it to load."); return; }
    const ids = { code: code.trim(), slug: slug.trim(), parent_sku: parentSku.trim() };
    if (!name.trim() || !ids.code || !ids.slug || !ids.parent_sku) { setError("Name, code, slug and parent SKU are required."); return; }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(ids.slug)) { setError("Slug must be lowercase letters, numbers and single hyphens."); return; }
    const taken = templates.some(r => r.code === ids.code || r.slug === ids.slug || r.parent_sku === ids.parent_sku);
    if (taken) { setError("Code, slug or parent SKU is already used by another record. Identities must be fresh."); return; }
    const skus = variants.map(v => v.child_sku.trim());
    if (variants.some(v => !v.child_sku.trim() || !v.label.trim())) { setError("Each variant needs a child SKU and a label, or remove it."); return; }
    if (new Set(skus).size !== skus.length || skus.includes(ids.parent_sku)) { setError("Child SKUs must be unique and differ from the parent SKU."); return; }
    const templateSkus = new Set((t.variants ?? []).map(v => v.child_sku));
    if (skus.some(s => templateSkus.has(s))) { setError("Child SKUs cannot reuse the template's SKUs."); return; }

    const proto = (t.variants ?? [])[0];
    const record: RecordJson = {
      ...clone(t),
      ...ids,
      name: name.trim(),
      publishable: false,
      purchasable: false,
      variants: variants.map(v => ({
        ...(proto ? Object.fromEntries(Object.entries(proto).map(([k, x]) => [k, blankLike(x)])) : {}),
        child_sku: v.child_sku.trim(), label: v.label.trim(),
      })),
      images: SLOT_LABELS.map((label, i) => ({
        slot: i + 1, label, file: `images/${ids.parent_sku}_${String(i + 1).padStart(2, "0")}.jpg`, alt: null, approved: false,
      })),
    };
    create.mutate(record, {
      onSuccess: (res) => {
        toast({ title: "Product record created", description: `${res.code} is unpublished, not purchasable and stock is unknown until reviewed.` });
        setOpen(false); reset();
        navigate(`/admin/products/record/${res.record?.slug ?? ids.slug}`);
      },
      onError: (err: Error) => {
        const status = (err as { status?: number }).status;
        setError(status === 409 ? `Identity conflict: ${err.message}` : err.message);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o && !create.isPending) reset(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2" data-testid="button-new-product"><Plus className="w-4 h-4" />New product</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New product record</DialogTitle>
          <DialogDescription>
            Uses an existing record as the page structure. Copy is carried over for you to rewrite; photos, identity and variants are not.
            The new product starts held back, not purchasable, with stock unknown.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="tpl">Template record</Label>
            <select id="tpl" data-testid="select-template" value={templateKey} onChange={e => setTemplateKey(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Choose a record...</option>
              {templates.map(r => <option key={r.code} value={r.slug}>{r.name} ({r.parent_sku})</option>)}
            </select>
            {template.isLoading && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Loading template...</p>}
            {template.isError && <p className="text-xs text-destructive">Template unavailable: {template.error.message}</p>}
          </div>
          <div className="space-y-1"><Label htmlFor="np-name">Product name</Label><Input id="np-name" data-testid="input-name" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="np-code">Code</Label><Input id="np-code" data-testid="input-code" className="font-mono" value={code} onChange={e => setCode(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="np-sku">Parent SKU</Label><Input id="np-sku" data-testid="input-parent-sku" className="font-mono" value={parentSku} onChange={e => setParentSku(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="np-slug">Slug</Label><Input id="np-slug" data-testid="input-slug" className="font-mono" placeholder="e.g. ecosmart-filter-mini" value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} /></div>
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label>Variants (optional)</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => setVariants(v => [...v, { child_sku: "", label: "" }])}><Plus className="w-3 h-3 mr-1" />Add</Button>
            </div>
            {variants.length === 0 && <p className="text-xs text-muted-foreground">No variants. Sold under the parent SKU.</p>}
            {variants.map((v, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label={`Variant ${i + 1} SKU`} placeholder="Child SKU" className="font-mono" value={v.child_sku} onChange={e => setVariants(vs => vs.map((x, n) => n === i ? { ...x, child_sku: e.target.value } : x))} />
                <Input aria-label={`Variant ${i + 1} label`} placeholder="Label" value={v.label} onChange={e => setVariants(vs => vs.map((x, n) => n === i ? { ...x, label: e.target.value } : x))} />
                <Button type="button" size="icon" variant="ghost" aria-label="Remove variant" onClick={() => setVariants(vs => vs.filter((_, n) => n !== i))}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
          {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending || !template.data} data-testid="button-create-record">
            {create.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}{create.isPending ? "Creating..." : "Create held back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
