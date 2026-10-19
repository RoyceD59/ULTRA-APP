import { trackEvent } from "@/lib/analytics";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Package, RefreshCw, Loader2, AlertTriangle, CheckCircle2, Edit2, Check, X, Settings2, Users, BellRing, Search, Pencil, HelpCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { isTeamAdmin, getAuthHeaders } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";
import { SkuRegisterPanel } from "@/components/sku-register-panel";
import { RestockRequestsPanel } from "@/components/restock-requests-panel";
import { useProducts, useUpdateProduct, STOCK_LABELS, type StockStatus } from "@/hooks/use-products";

const BASE = API_ORIGIN;

// ─── Types ────────────────────────────────────────────────────────────────────

interface InventoryProduct {
  id: number;
  name: string;
  sku: string;
  /** null = unmanaged quantity, not zero. */
  stockQuantity: number | null;
  stockStatus: StockStatus | string;
  permalink?: string | null;
  syncedAt?: string;
  updatedAt?: string;
}

interface InventoryResponse {
  products: InventoryProduct[];
  source?: string;
}

interface InventorySettings {
  lowStockThreshold: { value: number; source: "db" | "default" };
  restockDemandThreshold: { value: number; source: "db" | "default" };
}

interface WishlistDemand {
  productId: number;
  productName: string;
  waitingCustomerCount: number;
  pendingCustomerCount: number;
  notifiedCustomerCount: number;
  lastAddedAt: string | null;
  lastNotifiedRestockAt: string | null;
  restockDemandAlertedAt: string | null;
}

type StockStatusFilter = "all" | StockStatus;

const STOCK_STATUS_FILTERS: Array<{ value: StockStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "instock", label: "In stock" },
  { value: "outofstock", label: "Out of stock" },
  { value: "onbackorder", label: "On backorder" },
  { value: "unknown", label: "Needs review" },
];

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchInventory(): Promise<InventoryResponse> {
  const res = await fetch(`${BASE}/api/uc/admin/inventory`, { headers: getAuthHeaders() ?? {} });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<InventoryResponse>;
}

async function updateStock(productId: number, stockQuantity: number | null): Promise<void> {
  const res = await fetch(`${BASE}/api/uc/admin/inventory/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(getAuthHeaders() ?? {}) },
    body: JSON.stringify({ stockQuantity }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
  trackEvent("inventory_updated", { productId, stockQuantity: stockQuantity ?? undefined });
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

async function saveInventorySettings(settings: {
  lowStockThreshold?: number;
  restockDemandThreshold?: number;
}): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/inventory-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(getAuthHeaders() ?? {}) },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
}

// ─── Stock status badge ───────────────────────────────────────────────────────

function StockStatusBadge({ status, qty, threshold }: { status: string; qty: number | null; threshold: number }) {
  if (status === "unknown") {
    return <Badge variant="outline" className="gap-1 text-slate-700 border-slate-300 bg-slate-50 dark:bg-slate-900/40" data-testid="status-stock-unknown"><HelpCircle className="w-3 h-3" />Stock unknown</Badge>;
  }
  if (status === "outofstock" || qty === 0) {
    return <Badge variant="destructive">Out of stock</Badge>;
  }
  if (status === "onbackorder") return <Badge variant="secondary">On backorder</Badge>;
  if (qty !== null && qty <= threshold) {
    return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/30">Low stock</Badge>;
  }
  if (status === "instock") {
    return <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 dark:bg-green-950/30">{qty === null ? "In stock (unmanaged)" : "In stock"}</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

// ─── Inline stock editor ──────────────────────────────────────────────────────

function InlinePriceEditor({
  productId,
  productName,
  field,
  currentValue,
}: {
  productId: number;
  productName: string;
  field: "regularPrice";
  currentValue: string;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentValue || "");
  const inputRef = useRef<HTMLInputElement>(null);
  const updateProduct = useUpdateProduct();

  if (!editing) {
    return (
      <div className="flex items-center gap-2 group">
        <span className="font-mono text-sm">{currentValue || "—"}</span>
        <button
          onClick={() => { setValue(currentValue || ""); setEditing(true); setTimeout(() => inputRef.current?.select(), 0); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          title={`Edit ${field}`}
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
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-7 w-20 font-mono text-sm"
        disabled={updateProduct.isPending}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !updateProduct.isPending) {
            updateProduct.mutate({ id: productId, data: { [field]: value } }, {
              onSuccess: () => {
                toast({ title: "Price updated", description: `${productName}: ${field} set to ${value || "empty"}.` });
                setEditing(false);
              },
              onError: (err: Error) => {
                toast({ title: "Update failed", description: err.message, variant: "destructive" });
              }
            });
          }
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        disabled={updateProduct.isPending}
        onClick={() => {
          updateProduct.mutate({ id: productId, data: { [field]: value } }, {
            onSuccess: () => {
              toast({ title: "Price updated", description: `${productName}: ${field} set to ${value || "empty"}.` });
              setEditing(false);
            },
            onError: (err: Error) => {
              toast({ title: "Update failed", description: err.message, variant: "destructive" });
            }
          });
        }}
      >
        {updateProduct.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-green-600" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        disabled={updateProduct.isPending}
        onClick={() => setEditing(false)}
      >
        <X className="w-3.5 h-3.5 text-destructive" />
      </Button>
    </div>
  );
}

function InlineStockStatusEditor({
  productId,
  productName,
  currentStatus,
}: {
  productId: number;
  productName: string;
  currentStatus: string;
}) {
  const { toast } = useToast();
  const updateProduct = useUpdateProduct();
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-center gap-2 group">
        <span className="text-sm">{STOCK_LABELS[currentStatus as StockStatus] ?? currentStatus}</span>
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          title="Edit stock status"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const handleUpdate = (status: StockStatus) => {
    updateProduct.mutate({ id: productId, data: { stockStatus: status } }, {
      onSuccess: () => {
        toast({ title: "Status updated", description: `${productName}: stock status set to ${status}.` });
        setEditing(false);
      },
      onError: (err: Error) => {
        toast({ title: "Update failed", description: err.message, variant: "destructive" });
        setEditing(false);
      }
    });
  };

  return (
    <div className="flex items-center gap-1">
      <select
        className="h-7 px-1 text-sm border rounded"
        value={currentStatus}
        onChange={(e) => handleUpdate(e.target.value as StockStatus)}
        disabled={updateProduct.isPending}
        onBlur={() => setEditing(false)}
      >
        <option value="instock">In stock</option>
        <option value="outofstock">Out of stock</option>
        <option value="onbackorder">On backorder</option>
        {currentStatus === "unknown" && <option value="unknown" disabled>Stock unknown (choose a reviewed state)</option>}
      </select>
      {updateProduct.isPending && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
    </div>
  );
}

function InlineStockEditor({
  product,
  onSaved,
}: {
  product: InventoryProduct;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(product.stockQuantity === null ? "" : String(product.stockQuantity));
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const t = value.trim();
      if (t !== "" && (!/^\d+$/.test(t))) throw new Error("Quantity must be a whole number of 0 or more, or blank for unmanaged.");
      return updateStock(product.id, t === "" ? null : Number(t));
    },
    onSuccess: () => {
      toast({ title: "Stock saved", description: `${product.name}: ${value.trim() === "" ? "quantity is now unmanaged" : `managed quantity set to ${value.trim()}`}.` });
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
        <span className="font-mono text-sm">{product.stockQuantity === null ? <span className="font-sans text-xs text-muted-foreground">Unmanaged</span> : product.stockQuantity}</span>
        <button
          onClick={() => { setValue(product.stockQuantity === null ? "" : String(product.stockQuantity)); setEditing(true); setTimeout(() => inputRef.current?.select(), 0); }}
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
        placeholder="Unmanaged"
        aria-label="Managed quantity, blank for unmanaged"
        onChange={(e) => setValue(e.target.value)}
        className="h-7 w-24 font-mono text-sm"
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
        disabled={mutation.isPending}
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

// ─── Alert Settings panel ─────────────────────────────────────────────────────

function AlertSettingsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<"stock" | "demand" | null>(null);
  const [draft, setDraft] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["inventory-settings"],
    queryFn: fetchInventorySettings,
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: ({ type, value }: { type: "stock" | "demand"; value: number }) =>
      saveInventorySettings(
        type === "stock"
          ? { lowStockThreshold: value }
          : { restockDemandThreshold: value },
      ),
    onSuccess: (_data, variables) => {
      toast({
        title: "Settings saved",
        description: variables.type === "stock"
          ? `Low-stock alert threshold set to ${variables.value} units.`
          : `Restock-demand alert threshold set to ${variables.value} waiting customers.`,
      });
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["inventory-settings"] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const currentStockThreshold = data?.lowStockThreshold.value ?? 5;
  const currentDemandThreshold = data?.restockDemandThreshold.value ?? 5;
  const save = (type: "stock" | "demand") => {
    saveMutation.mutate({ type, value: Number(draft) });
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Settings2 className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Alert Settings</h2>
      </div>

      <div className="flex items-center gap-3 flex-wrap border-b pb-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Low stock</p>
          <p className="text-sm text-muted-foreground">
            Send a stock alert email when a product's quantity reaches this level or below (0 = out-of-stock only).
            Alerts fire daily at 04:30 UTC and immediately after a manual stock edit.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">Threshold:</span>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : editing === "stock" ? (
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
                  if (e.key === "Enter" && !saveMutation.isPending) save("stock");
                  if (e.key === "Escape") setEditing(null);
                }}
                autoFocus
              />
              <span className="text-sm text-muted-foreground">units</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => save("stock")} disabled={saveMutation.isPending || draft === ""}>
                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-green-600" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(null)} disabled={saveMutation.isPending}>
                <X className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </>
          ) : (
            <>
              <span className="font-mono text-sm font-medium">{currentStockThreshold}</span>
              <span className="text-sm text-muted-foreground">units</span>
              <button
                onClick={() => { setDraft(String(currentStockThreshold)); setEditing("stock"); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Edit low-stock threshold"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap pt-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Restock demand</p>
          <p className="text-sm text-muted-foreground">
            Alert the team once when this many customers are waiting for an out-of-stock product.
            The alert re-arms after the product is restocked or demand falls below the threshold.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">Threshold:</span>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : editing === "demand" ? (
            <>
              <Input
                type="number"
                min={1}
                max={10000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-7 w-20 font-mono text-sm"
                disabled={saveMutation.isPending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !saveMutation.isPending) save("demand");
                  if (e.key === "Escape") setEditing(null);
                }}
                autoFocus
              />
              <span className="text-sm text-muted-foreground">customers</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => save("demand")} disabled={saveMutation.isPending || draft === ""}>
                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-green-600" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(null)} disabled={saveMutation.isPending}>
                <X className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </>
          ) : (
            <>
              <span className="font-mono text-sm font-medium">{currentDemandThreshold}</span>
              <span className="text-sm text-muted-foreground">customers</span>
              <button
                onClick={() => { setDraft(String(currentDemandThreshold)); setEditing("demand"); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Edit restock-demand threshold"
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
  const [statusFilter, setStatusFilter] = useState<StockStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: fullProductsData } = useProducts();
  const fullProducts = fullProductsData ?? [];
  const fullProductMap = new Map(fullProducts.map(p => [p.id, p]));

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

  if (!isTeamAdmin()) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        You don't have permission to view this page.
      </div>
    );
  }

  const products = data?.products ?? [];
  const threshold = settings?.lowStockThreshold.value ?? 5;
  const restockDemandThreshold = settings?.restockDemandThreshold.value ?? 5;
  const lastFetched = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  const outOfStockCount = products.filter((p) => p.stockStatus !== "unknown" && (p.stockStatus === "outofstock" || p.stockQuantity === 0)).length;
  const lowStockCount   = products.filter((p) => p.stockStatus !== "unknown" && p.stockQuantity !== null && p.stockQuantity > 0 && p.stockQuantity <= threshold).length;
  const unknownCount    = products.filter((p) => p.stockStatus === "unknown").length;
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const filteredProducts = products.filter((product) => {
    const matchesSearch = normalizedSearch === ""
      || product.name.toLocaleLowerCase().includes(normalizedSearch)
      || product.sku.toLocaleLowerCase().includes(normalizedSearch);
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "outofstock"
        ? product.stockStatus === "outofstock" || (product.stockStatus !== "unknown" && product.stockQuantity === 0)
        : statusFilter === "instock"
          ? product.stockStatus === "instock" && product.stockQuantity !== 0
          : product.stockStatus === statusFilter);

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" /> Inventory
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and adjust app-owned stock for every UC product. Quantity blank means unmanaged; stock unknown means a staff review is still needed before the item can be sold.
          </p>
          {lastFetched && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Product records fetched at {lastFetched}
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
        </div>
      </div>

      {/* Stock summary banners */}
      {!isLoading && !error && (outOfStockCount > 0 || lowStockCount > 0 || unknownCount > 0) && (
        <div className="flex gap-3 flex-wrap">
          {unknownCount > 0 && (
            <button type="button" onClick={() => setStatusFilter("unknown")} data-testid="button-filter-unknown" className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 dark:bg-slate-900/40 px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100">
              <HelpCircle className="w-4 h-4 shrink-0" />
              <span><strong>{unknownCount}</strong> product{unknownCount !== 1 ? "s" : ""} awaiting stock review. Not sellable until reviewed.</span>
            </button>
          )}
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
              Customers waiting for products to come back in stock. The team is alerted at{" "}
              {restockDemandThreshold} waiting customer{restockDemandThreshold === 1 ? "" : "s"}.
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
                      {item.restockDemandAlertedAt ? (
                        <Badge variant="outline" className="gap-1 border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400">
                          <AlertTriangle className="w-3 h-3" />
                          Demand alert sent
                        </Badge>
                      ) : item.waitingCustomerCount >= restockDemandThreshold ? (
                        <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                          <BellRing className="w-3 h-3" />
                          Demand alert pending
                        </Badge>
                      ) : null}
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

      <RestockRequestsPanel />

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
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">Filter products by stock status</legend>
              {STOCK_STATUS_FILTERS.map((filter) => (
                <label
                  key={filter.value}
                  className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                    statusFilter === filter.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name="inventory-stock-status"
                    value={filter.value}
                    checked={statusFilter === filter.value}
                    onChange={() => setStatusFilter(filter.value)}
                    className="sr-only"
                  />
                  {filter.label}
                </label>
              ))}
            </fieldset>

            <div className="relative w-full lg:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by product name or SKU"
                aria-label="Search inventory by product name or SKU"
                className="pl-9"
              />
            </div>
          </div>
          <div className="border-b px-4 py-2 text-xs text-muted-foreground">
            Showing {filteredProducts.length} of {products.length} product{products.length === 1 ? "" : "s"}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead title="Authoritative record price. Discounts come from promotions.">Price (KES)</TableHead>
                <TableHead>Stock qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((product) => {
                const fullProduct = fullProductMap.get(product.id);
                return (
                <TableRow
                  key={product.id}
                  className={
                    product.stockStatus === "unknown"
                      ? "bg-slate-50/60 dark:bg-slate-900/20"
                      : product.stockQuantity === 0
                      ? "bg-destructive/5"
                      : product.stockQuantity !== null && product.stockQuantity <= threshold
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
                    {fullProduct ? (
                      <InlinePriceEditor
                        productId={product.id}
                        productName={product.name}
                        field="regularPrice"
                        currentValue={fullProduct.regularPrice}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <InlineStockEditor
                      product={product}
                      onSaved={() => {
                        void qc.invalidateQueries({ queryKey: ["uc-inventory"] });
                        void qc.invalidateQueries({ queryKey: ["uc-products"] });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      <StockStatusBadge status={fullProduct?.stockStatus || product.stockStatus} qty={product.stockQuantity} threshold={threshold} />
                      <InlineStockStatusEditor
                        productId={product.id}
                        productName={product.name}
                        currentStatus={fullProduct?.stockStatus || product.stockStatus}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" asChild className="h-8 text-xs">
                        <Link href={`/admin/products/${product.id}`}>
                          <Pencil className="w-3 h-3 mr-1" />
                          Edit
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
              {filteredProducts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    {products.length === 0
                      ? "No products found."
                      : "No products match the selected filters."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {products.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {products.length} product{products.length !== 1 ? "s" : ""} · Hover a quantity to edit inline · Blank quantity saves as unmanaged
        </p>
      )}

      <SkuRegisterPanel />
    </div>
  );
}
