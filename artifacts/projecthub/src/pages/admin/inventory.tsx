import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package, RefreshCw, ExternalLink, Loader2, AlertTriangle, CheckCircle2, Edit2, Check, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { isTeamAdmin, getAuthHeaders } from "@/lib/team-auth";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InventoryProduct {
  id: number;
  name: string;
  sku: string;
  stockQuantity: number;
  stockStatus: string;
  permalink: string | null;
  syncedAt: string;
}

interface InventoryResponse {
  products: InventoryProduct[];
  source: "woocommerce" | "mock";
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchInventory(): Promise<InventoryResponse> {
  const res = await fetch(`${BASE}/api/uc/admin/inventory`, { headers: getAuthHeaders() ?? {} });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<InventoryResponse>;
}

async function updateStock(productId: number, stockQuantity: number): Promise<void> {
  const res = await fetch(`${BASE}/api/uc/admin/inventory/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(getAuthHeaders() ?? {}) },
    body: JSON.stringify({ stockQuantity }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
}

async function triggerSync(): Promise<void> {
  const res = await fetch(`${BASE}/api/uc/admin/inventory/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(getAuthHeaders() ?? {}) },
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
}

// ─── Stock status badge ───────────────────────────────────────────────────────

function StockStatusBadge({ status }: { status: string }) {
  if (status === "instock") {
    return <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 dark:bg-green-950/30">In stock</Badge>;
  }
  if (status === "outofstock") {
    return <Badge variant="destructive">Out of stock</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

// ─── Inline stock editor ──────────────────────────────────────────────────────

function InlineStockEditor({
  product,
  onSaved,
}: {
  product: InventoryProduct;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(product.stockQuantity));
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () => updateStock(product.id, Number(value)),
    onSuccess: () => {
      toast({ title: "Stock updated", description: `${product.name}: quantity set to ${value}.` });
      setEditing(false);
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  if (!editing) {
    return (
      <div className="flex items-center gap-2 group">
        <span className="font-mono text-sm">{product.stockQuantity}</span>
        <button
          onClick={() => { setValue(String(product.stockQuantity)); setEditing(true); setTimeout(() => inputRef.current?.select(), 0); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          title="Edit stock quantity"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={inputRef}
        type="number"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-7 w-20 font-mono text-sm"
        disabled={mutation.isPending}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !mutation.isPending) mutation.mutate();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        disabled={mutation.isPending || value === ""}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-green-600" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        disabled={mutation.isPending}
        onClick={() => setEditing(false)}
      >
        <X className="w-3.5 h-3.5 text-destructive" />
      </Button>
    </div>
  );
}

// ─── WooCommerce product edit URL ─────────────────────────────────────────────

function wcAdminUrl(productId: number, permalink: string | null): string {
  if (permalink) {
    try {
      const base = new URL(permalink).origin;
      return `${base}/wp-admin/post.php?post=${productId}&action=edit`;
    } catch {
      /* fall through */
    }
  }
  return `https://www.ucfilters.com/wp-admin/post.php?post=${productId}&action=edit`;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminInventoryPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["uc-inventory"],
    queryFn: fetchInventory,
    staleTime: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      toast({ title: "Sync triggered", description: "n8n inventory sync has been started successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  if (!isTeamAdmin()) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        You don't have permission to view this page.
      </div>
    );
  }

  const products = data?.products ?? [];
  const lastFetched = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" /> Inventory
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            View and adjust stock levels for all UC products. Changes are written back to WooCommerce immediately.
          </p>
          {lastFetched && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {data?.source === "mock" ? (
                <span className="text-amber-600 flex items-center gap-1 mt-1">
                  <AlertTriangle className="w-3 h-3" /> Showing mock data — WooCommerce credentials not configured
                </span>
              ) : (
                <span className="flex items-center gap-1 mt-1 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="w-3 h-3" /> Live from WooCommerce · fetched at {lastFetched}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => void qc.invalidateQueries({ queryKey: ["uc-inventory"] })}
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            className="gap-2"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            title="Trigger the n8n inventory sync automation"
          >
            {syncMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Syncing…</>
            ) : (
              <><RefreshCw className="w-4 h-4" /> Sync now</>
            )}
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading inventory…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive">
          Failed to load inventory: {(error as Error).message}
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Stock qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">WooCommerce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium max-w-[240px]">
                    <span className="truncate block">{product.name}</span>
                    <span className="text-xs text-muted-foreground">ID: {product.id}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {product.sku || "—"}
                  </TableCell>
                  <TableCell>
                    <InlineStockEditor
                      product={product}
                      onSaved={() => void qc.invalidateQueries({ queryKey: ["uc-inventory"] })}
                    />
                  </TableCell>
                  <TableCell>
                    <StockStatusBadge status={product.stockStatus} />
                  </TableCell>
                  <TableCell className="text-right">
                    <a
                      href={wcAdminUrl(product.id, product.permalink)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Edit <ExternalLink className="w-3 h-3" />
                    </a>
                  </TableCell>
                </TableRow>
              ))}
              {products.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    No products found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {products.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {products.length} product{products.length !== 1 ? "s" : ""} · Hover a quantity to edit inline · Click "Sync now" to trigger n8n
        </p>
      )}
    </div>
  );
}
