import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package, RefreshCw, ExternalLink, Loader2, AlertTriangle, CheckCircle2, Edit2, Check, X, Settings2, Users, BellRing,
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

interface InventorySettings {
  lowStockThreshold: { value: number; source: "db" | "default" };
}

interface WishlistDemand {
  productId: number;
  productName: string;
  waitingCustomerCount: number;
  pendingCustomerCount: number;
  notifiedCustomerCount: number;
  lastAddedAt: string | null;
  lastNotifiedRestockAt: string | null;
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

async function fetchInventorySettings(): Promise<InventorySettings> {
  const res = await fetch(`${BASE}/api/admin/inventory-settings`, { headers: getAuthHeaders() ?? {} });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<InventorySettings>;
}

async function fetchWishlistDemand(): Promise<WishlistDemand[]> {
  const res = await fetch(`${BASE}/api/uc/admin/inventory/wishlist-demand`, {
    headers: getAuthHeaders() ?? {},
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<WishlistDemand[]>;
}

async function saveInventorySettings(lowStockThreshold: number): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/inventory-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(getAuthHeaders() ?? {}) },
    body: JSON.stringify({ lowStockThreshold }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
}

// ─── Stock status badge ───────────────────────────────────────────────────────

function StockStatusBadge({ status, qty, threshold }: { status: string; qty: number; threshold: number }) {
  if (status === "outofstock" || qty === 0) {
    return <Badge variant="destructive">Out of stock</Badge>;
  }
  if (qty <= threshold) {
    return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/30">Low stock</Badge>;
  }
  if (status === "instock") {
    return <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 dark:bg-green-950/30">In stock</Badge>;
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

// ─── Alert Settings panel ─────────────────────────────────────────────────────

function AlertSettingsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["inventory-settings"],
    queryFn: fetchInventorySettings,
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: () => saveInventorySettings(Number(draft)),
    onSuccess: () => {
      toast({ title: "Settings saved", description: `Low-stock alert threshold set to ${draft} units.` });
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["inventory-settings"] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const currentThreshold = data?.lowStockThreshold.value ?? 5;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Settings2 className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Alert Settings</h2>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground">
            Send a stock alert email when a product's quantity reaches this level or below (0 = out-of-stock only).
            Alerts fire daily at 04:30 UTC and immediately after a manual stock edit.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">Threshold:</span>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : editing ? (
            <>
              <Input
                type="number"
                min={0}
                max={10000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-7 w-20 font-mono text-sm"
                disabled={saveMutation.isPending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !saveMutation.isPending) saveMutation.mutate();
                  if (e.key === "Escape") setEditing(false);
                }}
                autoFocus
              />
              <span className="text-sm text-muted-foreground">units</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || draft === ""}>
                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-green-600" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)} disabled={saveMutation.isPending}>
                <X className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </>
          ) : (
            <>
              <span className="font-mono text-sm font-medium">{currentThreshold}</span>
              <span className="text-sm text-muted-foreground">units</span>
              <button
                onClick={() => { setDraft(String(currentThreshold)); setEditing(true); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Edit threshold"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
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

  const { data: settings } = useQuery({
    queryKey: ["inventory-settings"],
    queryFn: fetchInventorySettings,
    staleTime: 60_000,
  });

  const {
    data: wishlistDemand,
    isLoading: wishlistDemandLoading,
    error: wishlistDemandError,
  } = useQuery({
    queryKey: ["uc-inventory-wishlist-demand"],
    queryFn: fetchWishlistDemand,
    staleTime: 30_000,
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
  const threshold = settings?.lowStockThreshold.value ?? 5;
  const lastFetched = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  const outOfStockCount = products.filter((p) => p.stockQuantity === 0).length;
  const lowStockCount   = products.filter((p) => p.stockQuantity > 0 && p.stockQuantity <= threshold).length;

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
            onClick={() => {
              void qc.invalidateQueries({ queryKey: ["uc-inventory"] });
              void qc.invalidateQueries({ queryKey: ["uc-inventory-wishlist-demand"] });
            }}
            disabled={isLoading || wishlistDemandLoading}
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

      {/* Stock summary banners */}
      {!isLoading && !error && (outOfStockCount > 0 || lowStockCount > 0) && (
        <div className="flex gap-3 flex-wrap">
          {outOfStockCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span><strong>{outOfStockCount}</strong> product{outOfStockCount !== 1 ? "s" : ""} out of stock</span>
            </div>
          )}
          {lowStockCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span><strong>{lowStockCount}</strong> product{lowStockCount !== 1 ? "s" : ""} low on stock (≤ {threshold} units)</span>
            </div>
          )}
        </div>
      )}

      {/* Alert Settings */}
      <AlertSettingsPanel />

      {/* Restock demand */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b px-4 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Users className="w-4 h-4 text-muted-foreground" /> Restock demand
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Customers waiting for products to come back in stock.
            </p>
          </div>
          {wishlistDemand && wishlistDemand.length > 0 && (
            <Badge variant="secondary" className="shrink-0">
              {wishlistDemand.reduce((total, item) => total + item.waitingCustomerCount, 0)} waiting
            </Badge>
          )}
        </div>

        {wishlistDemandLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading restock demand…
          </div>
        ) : wishlistDemandError ? (
          <div className="px-4 py-6 text-sm text-destructive">
            Failed to load restock demand: {(wishlistDemandError as Error).message}
          </div>
        ) : wishlistDemand && wishlistDemand.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead>Notification cycle</TableHead>
                <TableHead className="text-right">Latest activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wishlistDemand.map((item) => (
                <TableRow key={item.productId}>
                  <TableCell className="font-medium">
                    <span className="block max-w-[280px] truncate">{item.productName}</span>
                    <span className="text-xs text-muted-foreground">ID: {item.productId}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold">{item.waitingCustomerCount}</span>
                    <span className="ml-1 text-sm text-muted-foreground">
                      customer{item.waitingCustomerCount !== 1 ? "s" : ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.pendingCustomerCount > 0 ? (
                        <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                          <BellRing className="w-3 h-3" />
                          {item.pendingCustomerCount} pending
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-green-300 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400">
                          <CheckCircle2 className="w-3 h-3" />
                          All notified
                        </Badge>
                      )}
                      {item.notifiedCustomerCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {item.notifiedCustomerCount} notified this cycle
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    <span className="block">
                      Added {item.lastAddedAt ? new Date(item.lastAddedAt).toLocaleDateString() : "—"}
                    </span>
                    <span className="block">
                      {item.lastNotifiedRestockAt
                        ? `Notified ${new Date(item.lastNotifiedRestockAt).toLocaleDateString()}`
                        : "No restock notification yet"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No customers are currently waiting for a restock.
          </div>
        )}
      </section>

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
                <TableRow
                  key={product.id}
                  className={
                    product.stockQuantity === 0
                      ? "bg-destructive/5"
                      : product.stockQuantity <= threshold
                      ? "bg-amber-50/50 dark:bg-amber-950/10"
                      : ""
                  }
                >
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
                    <StockStatusBadge status={product.stockStatus} qty={product.stockQuantity} threshold={threshold} />
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
