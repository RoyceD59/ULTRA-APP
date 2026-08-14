/**
 * UC Orders — ProjectHub team view
 *
 * Admin-gated page. Uses the same UC Companion email+password credentials
 * as the Impact and Alison Feedback pages. Token stored in sessionStorage.
 *
 * Highlights webhook recovery orders with an amber "Webhook recovery" badge
 * so the team knows to enrich and fulfil them manually.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ShoppingBag, AlertTriangle, Package, RefreshCw, Lock, AlertCircle,
  LogOut, Copy, Check, ExternalLink, Filter, X, Download,
  CheckCircle2, XCircle, Undo2, Trash2, BellOff,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatRelativeDate } from "@/components/shared/badges";
import { getTeamToken } from "@/lib/team-auth";

const BASE      = import.meta.env.BASE_URL.replace(/\/$/, "");
const TOKEN_KEY = "uc_orders_admin_token";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminOrder {
  id: number;
  userId: string;
  status: string;
  dateCreated: string;
  total: string;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  webhookRecovery: boolean;
  lineItems: { productId: number; name: string; quantity: number; total: string }[];
}

interface ReminderGapItem {
  productId: number;
  name: string;
  quantity: number;
  reason: "missing-lifespan" | "unknown-product";
}

interface ReminderGapReport {
  source: string;
  checkedAt: string;
  checkedOrders: number;
  orders: { id: number; userId: string; status: string; dateCreated: string; gapItems: ReminderGapItem[] }[];
}

// ─── Login Gate ───────────────────────────────────────────────────────────────

function LoginGate({ onToken }: { onToken: (t: string) => void }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [busy,     setBusy]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true); setError("");
    try {
      const loginRes = await fetch(`${BASE}/api/uc/auth/login`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: email.trim(), password }),
      });
      if (loginRes.status === 401) { setError("Incorrect email or password."); return; }
      if (!loginRes.ok) { setError(`Login failed (${loginRes.status}). Try again.`); return; }

      const { token } = await loginRes.json() as { token: string };
      if (!token) { setError("No token returned. Please try again."); return; }

      // Verify the token has admin access by hitting the admin orders endpoint
      const checkRes = await fetch(`${BASE}/api/uc/admin/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkRes.status === 401 || checkRes.status === 403) {
        setError("Your account does not have admin access. Contact the UCFilters team.");
        return;
      }
      if (!checkRes.ok) { setError(`Server error (${checkRes.status}). Try again.`); return; }

      sessionStorage.setItem(TOKEN_KEY, token);
      onToken(token);
    } catch {
      setError("Could not reach the server. Is the API running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Sign in to view Orders</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Use your UCFilters admin account (same credentials as the Companion app).
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email" type="email" autoComplete="email"
                placeholder="you@ucfilters.com"
                value={email} onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password" type="password" autoComplete="current-password"
                placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={!email.trim() || !password || busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  switch (status) {
    case "pending":    return "bg-amber-100 text-amber-800";
    case "processing": return "bg-blue-100 text-blue-800";
    case "paid":       return "bg-emerald-100 text-emerald-800";
    case "completed":  return "bg-emerald-100 text-emerald-800";
    case "declined":   return "bg-red-100 text-red-800";
    case "cancelled":  return "bg-red-100 text-red-800";
    case "refunded":   return "bg-violet-100 text-violet-800";
    default:           return "bg-muted text-muted-foreground";
  }
}

function paymentMethodLabel(method: string) {
  if (method === "paystack") return "Paystack";
  if (method === "mpesa")    return "M-Pesa";
  if (method === "stripe")   return "Stripe";
  return method;
}

/** True when the userId string looks like an email address. */
function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Copy-to-clipboard button with tick confirmation. */
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available — silently ignore
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={`Copy ${label ?? value}`}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied
        ? <Check className="w-3 h-3 text-emerald-600" />
        : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── Order actions (admin-only mutations) ─────────────────────────────────────

function OrderActions({
  order, token, onChanged,
}: { order: AdminOrder; token: string; onChanged: () => void }) {
  const [busy,  setBusy]  = useState<string | null>(null);
  const [error, setError] = useState("");

  const isRefunded = order.status === "refunded";
  const isPaystack = order.paymentMethod === "paystack" && !!order.paymentReference;

  async function call(method: string, path: string, body?: unknown): Promise<boolean> {
    setError("");
    try {
      const res = await fetch(`${BASE}/api/uc/admin/orders/${order.id}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        setError(data?.error ?? `Request failed (${res.status})`);
        return false;
      }
      onChanged();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    }
  }

  async function setStatus(status: string) {
    setBusy(status);
    await call("PATCH", "/status", { status });
    setBusy(null);
  }

  async function refund() {
    setBusy("refund");
    await call("POST", "/refund");
    setBusy(null);
  }

  async function remove() {
    setBusy("delete");
    await call("DELETE", "");
    setBusy(null);
  }

  return (
    <div className="mt-3 pt-3 border-t space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {!isRefunded && order.status !== "paid" && (
          <Button
            variant="outline" size="sm"
            onClick={() => setStatus("paid")}
            disabled={busy !== null}
            className="h-7 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            {busy === "paid" ? "Saving…" : "Mark paid"}
          </Button>
        )}
        {!isRefunded && order.status !== "declined" && (
          <Button
            variant="outline" size="sm"
            onClick={() => setStatus("declined")}
            disabled={busy !== null}
            className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50"
          >
            <XCircle className="w-3.5 h-3.5 mr-1" />
            {busy === "declined" ? "Saving…" : "Mark declined"}
          </Button>
        )}

        {/* Refund — real Paystack refund for card payments; confirmation required */}
        {!isRefunded && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline" size="sm"
                disabled={busy !== null}
                className="h-7 text-xs text-violet-700 border-violet-300 hover:bg-violet-50"
              >
                <Undo2 className="w-3.5 h-3.5 mr-1" />
                {busy === "refund" ? "Refunding…" : "Refund"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Refund order #{order.id}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {isPaystack ? (
                    <>
                      This sends a <strong>real refund of {order.currency} {order.total}</strong>{" "}
                      through Paystack to the customer's card. This cannot be undone.
                    </>
                  ) : (
                    <>
                      This marks the order as refunded for record-keeping only.{" "}
                      {paymentMethodLabel(order.paymentMethod)} reversals must be sent to the
                      customer manually — this does not move any money.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={refund}
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  {isPaystack ? "Send Paystack refund" : "Mark refunded"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* Delete — permanent, confirmation required */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost" size="sm"
              disabled={busy !== null}
              className="h-7 text-xs text-muted-foreground hover:text-destructive ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              {busy === "delete" ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete order #{order.id}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the order and its line items from the app database.
                It does not touch any payment — refund first if money needs to move.
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={remove}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete permanently
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-md p-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({
  order, token, onChanged, gapItems,
}: { order: AdminOrder; token: string; onChanged: () => void; gapItems?: ReminderGapItem[] }) {
  const isRecovery   = order.webhookRecovery;
  const hasGap       = !!gapItems && gapItems.length > 0;
  const gapProductIds = new Set((gapItems ?? []).map(g => g.productId));
  const hasReference = !!order.paymentReference;
  const customerIsEmail = isEmail(order.userId);

  return (
    <Card className={isRecovery ? "border-amber-400" : ""}>
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold">Order #{order.id}</span>
            {/* Webhook recovery badge — persisted flag, never derived from heuristics */}
            {isRecovery && (
              <Badge className="bg-amber-500 text-white hover:bg-amber-600 gap-1 text-xs font-medium">
                <AlertTriangle className="w-3 h-3" />
                Webhook recovery
              </Badge>
            )}
            {/* Reminder-gap badge — this customer will get NO replacement
                reminder because a purchased product has no lifespan set */}
            {hasGap && (
              <Badge
                className="bg-orange-100 text-orange-800 hover:bg-orange-200 gap-1 text-xs font-medium border border-orange-300"
                title="No replacement reminder will be scheduled — a purchased product has no lifespan set"
              >
                <BellOff className="w-3 h-3" />
                No reminder
              </Badge>
            )}
            <Badge className={`text-xs font-medium capitalize ${statusColor(order.status)}`}>
              {order.status}
            </Badge>
          </div>
          <span className="text-muted-foreground text-xs">
            {formatRelativeDate(order.dateCreated)}
          </span>
        </div>

        {/* Customer row */}
        <p className="text-xs text-muted-foreground mt-1">
          {customerIsEmail ? "Customer email" : "Customer"}:{" "}
          <span className="font-mono">{order.userId}</span>
          {" · "}{paymentMethodLabel(order.paymentMethod)}
        </p>

        {/* Paystack reference — own row so it's easy to spot and copy */}
        {hasReference && (
          <div className={`flex items-center gap-2 mt-1.5 flex-wrap ${
            isRecovery ? "rounded-md bg-amber-50 border border-amber-200 px-2 py-1.5" : ""
          }`}>
            <span className="text-xs text-muted-foreground">
              {paymentMethodLabel(order.paymentMethod)} ref:
            </span>
            <span className="font-mono text-xs font-medium">{order.paymentReference}</span>
            <CopyButton value={order.paymentReference} label="reference" />
            {order.paymentMethod === "paystack" && (
              <a
                href={`https://dashboard.paystack.com/#/transactions?reference=${encodeURIComponent(order.paymentReference)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Open in Paystack
              </a>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="px-5 pb-4">
        {order.lineItems.length === 0 ? (
          <p className="text-muted-foreground text-sm italic flex items-center gap-1.5">
            <Package className="w-4 h-4" />
            No line items — enrichment required before dispatch
          </p>
        ) : (
          <ul className="space-y-0.5">
            {order.lineItems.map((item, i) => {
              const itemGap = gapProductIds.has(item.productId)
                ? gapItems?.find(g => g.productId === item.productId)
                : undefined;
              return (
                <li key={i} className="text-sm flex justify-between gap-2">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    {item.name} × {item.quantity}
                    {itemGap && (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5"
                        title={itemGap.reason === "unknown-product"
                          ? "Product not found in the catalogue — lifespan can't be resolved"
                          : "Product has no filter_lifespan_days set in the store"}
                      >
                        <BellOff className="w-3 h-3" />
                        {itemGap.reason === "unknown-product" ? "not in catalogue" : "no lifespan set"}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">{order.currency} {item.total}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-2 text-sm font-semibold text-right">
          Total: {order.currency} {order.total}
        </div>
        <OrderActions order={order} token={token} onChanged={onChanged} />
      </CardContent>
    </Card>
  );
}

// ─── Orders list ──────────────────────────────────────────────────────────────

function OrdersList({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [gapsOnly,     setGapsOnly]     = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate,   setToDate]   = useState("");

  function buildParams(extra?: Record<string, string>) {
    const params = new URLSearchParams(extra);
    if (fromDate) params.set("from", fromDate);
    if (toDate)   params.set("to",   toDate);
    return params;
  }

  async function downloadCsv() {
    setExporting(true);
    try {
      const params = buildParams();
      const url = `${BASE}/api/uc/admin/orders.csv${params.size ? `?${params}` : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        sessionStorage.removeItem(TOKEN_KEY);
        onLogout();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob    = await res.blob();
      const dateStr = new Date().toISOString().slice(0, 10);
      const anchor  = document.createElement("a");
      anchor.href     = URL.createObjectURL(blob);
      anchor.download = `orders-${dateStr}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(anchor.href);
    } catch {
      // silent — button re-enables
    } finally {
      setExporting(false);
    }
  }

  const { data: orders, isLoading, isError, refetch, isFetching } = useQuery<AdminOrder[]>({
    queryKey: ["admin-orders", token, fromDate, toDate],
    queryFn: async () => {
      const params = buildParams();
      const url = `${BASE}/api/uc/admin/orders${params.size ? `?${params}` : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        // Token expired or revoked — force re-login
        sessionStorage.removeItem(TOKEN_KEY);
        onLogout();
        return [];
      }
      if (!res.ok) throw new Error("Failed to load orders");
      return res.json() as Promise<AdminOrder[]>;
    },
    refetchOnWindowFocus: false,
  });

  // Reminder-gap report — orders whose products have no lifespan set and so
  // will never produce a replacement reminder. Loaded independently of the
  // main list; failure of this report never blocks the orders view.
  const { data: gapReport } = useQuery<ReminderGapReport | null>({
    queryKey: ["admin-order-reminder-gaps", token],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/uc/admin/orders/reminder-gaps`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null; // report unavailable — orders list still works
      return res.json() as Promise<ReminderGapReport>;
    },
    refetchOnWindowFocus: false,
  });

  const gapsByOrderId = new Map<number, ReminderGapItem[]>(
    (gapReport?.orders ?? []).map(o => [o.id, o.gapItems])
  );
  const gapProductNames = [...new Set(
    (gapReport?.orders ?? []).flatMap(o => o.gapItems.map(g => g.name))
  )];

  const recoveryOrders  = orders?.filter(o => o.webhookRecovery) ?? [];
  const unresolvedCount = recoveryOrders.filter(
    o => o.status !== "completed" && o.status !== "cancelled"
  ).length;

  // Status chips — fixed order, only statuses present in the data are shown
  const STATUS_ORDER = ["pending", "processing", "paid", "declined", "completed", "cancelled", "refunded"];
  const statusCounts = new Map<string, number>();
  for (const o of orders ?? []) {
    statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1);
  }
  const chipStatuses = [
    ...STATUS_ORDER.filter(s => statusCounts.has(s)),
    ...[...statusCounts.keys()].filter(s => !STATUS_ORDER.includes(s)).sort(),
  ];

  let baseOrders = recoveryOnly ? recoveryOrders : (orders ?? []);
  if (gapsOnly) baseOrders = baseOrders.filter(o => gapsByOrderId.has(o.id));
  const visibleOrders = statusFilter ? baseOrders.filter(o => o.status === statusFilter) : baseOrders;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingBag className="w-6 h-6" />
            Orders
            {unresolvedCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-bold px-2 py-0.5 min-w-[1.25rem]">
                {unresolvedCount}
              </span>
            )}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            All app orders — review webhook recovery orders before dispatch.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Recovery-only filter toggle */}
          <Button
            variant={recoveryOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setRecoveryOnly(v => !v)}
            className={recoveryOnly ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-500" : ""}
            title={recoveryOnly ? "Showing recovery orders only — click to show all" : "Filter to recovery orders only"}
          >
            {recoveryOnly
              ? <><X className="w-4 h-4 mr-1.5" />Recovery only</>
              : <><Filter className="w-4 h-4 mr-1.5" />Recovery only</>}
            {!recoveryOnly && recoveryOrders.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5 min-w-[1.1rem]">
                {recoveryOrders.length}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCsv}
            disabled={exporting || isLoading}
            title="Download all orders as CSV"
          >
            <Download className={`w-4 h-4 mr-2 ${exporting ? "animate-pulse" : ""}`} />
            {exporting ? "Downloading…" : "Download CSV"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} title="Sign out">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Date range picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label htmlFor="orders-from" className="text-sm text-muted-foreground whitespace-nowrap">From</Label>
          <Input
            id="orders-from"
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="w-40 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="orders-to" className="text-sm text-muted-foreground whitespace-nowrap">To</Label>
          <Input
            id="orders-to"
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="w-40 h-8 text-sm"
          />
        </div>
        {(fromDate || toDate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFromDate(""); setToDate(""); }}
            className="h-8 px-2 text-muted-foreground"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Clear dates
          </Button>
        )}
      </div>

      {/* Status filter chips — client-side, counts reflect loaded orders */}
      {chipStatuses.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setStatusFilter(null)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              statusFilter === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({orders?.length ?? 0})
          </button>
          {chipStatuses.map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(s => (s === status ? null : status))}
              className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize transition-colors ${statusColor(status)} ${
                statusFilter === status ? "ring-2 ring-primary ring-offset-1" : "opacity-80 hover:opacity-100"
              }`}
            >
              {status} ({statusCounts.get(status)})
            </button>
          ))}
        </div>
      )}

      {/* Reminder-gap banner — orders that will never get a replacement
          reminder because a purchased product has no lifespan set */}
      {gapReport && gapReport.orders.length > 0 && !gapsOnly && (
        <div
          className="rounded-lg border border-orange-300 bg-orange-50 p-4 flex items-start gap-3 cursor-pointer hover:bg-orange-100 transition-colors"
          onClick={() => setGapsOnly(true)}
          title="Click to filter to orders with no reminder scheduled"
        >
          <BellOff className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-orange-800">
              {gapReport.orders.length} order{gapReport.orders.length > 1 ? "s" : ""} will get no replacement reminder
            </p>
            <p className="text-orange-700 text-sm mt-0.5">
              The purchased product{gapProductNames.length > 1 ? "s have" : " has"} no lifespan set in the
              store, so no replacement reminder will ever be scheduled for these customers.
              Product{gapProductNames.length > 1 ? "s" : ""} causing the gap:{" "}
              <span className="font-medium">{gapProductNames.join(", ")}</span>.
              Add a <span className="font-mono text-xs">filter_lifespan_days</span> value in WooCommerce to fix.
            </p>
          </div>
          <span className="text-xs text-orange-600 font-medium whitespace-nowrap">View only →</span>
        </div>
      )}
      {gapsOnly && (
        <div className="flex items-center gap-2">
          <Badge className="bg-orange-100 text-orange-800 border border-orange-300 gap-1">
            <BellOff className="w-3 h-3" />
            Showing orders with no reminder
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => setGapsOnly(false)}>
            <X className="w-4 h-4 mr-1" />Show all
          </Button>
        </div>
      )}

      {/* Recovery alert banner */}
      {recoveryOrders.length > 0 && !recoveryOnly && (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-start gap-3 cursor-pointer hover:bg-amber-100 transition-colors"
          onClick={() => setRecoveryOnly(true)}
          title="Click to filter to recovery orders"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-amber-800">
              {recoveryOrders.length} webhook recovery order{recoveryOrders.length > 1 ? "s" : ""} need attention
            </p>
            <p className="text-amber-700 text-sm mt-0.5">
              These orders were created automatically because the customer paid but the app lost
              connectivity. Use the Paystack reference to verify payment, then contact the customer
              to confirm items and address before dispatch.
            </p>
          </div>
          <span className="text-xs text-amber-600 font-medium whitespace-nowrap">View only →</span>
        </div>
      )}

      {isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading orders…</div>
      )}

      {isError && (
        <div className="text-destructive text-sm py-12 text-center">
          Failed to load orders. Please refresh or sign in again.
        </div>
      )}

      {orders && visibleOrders.length === 0 && !isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">
          {statusFilter
            ? `No ${statusFilter} orders${recoveryOnly ? " in recovery" : ""}.`
            : recoveryOnly ? "No recovery orders." : "No orders yet."}
        </div>
      )}

      {visibleOrders.length > 0 && (
        <div className="space-y-3">
          {visibleOrders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              token={token}
              onChanged={() => refetch()}
              gapItems={gapsByOrderId.get(order.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [token, setToken] = useState<string | null>(() =>
    getTeamToken() ?? sessionStorage.getItem(TOKEN_KEY)
  );

  // Keep token state in sync with sessionStorage (e.g. after forced logout)
  useEffect(() => {
    if (!token) sessionStorage.removeItem(TOKEN_KEY);
  }, [token]);

  if (!token) {
    return <LoginGate onToken={setToken} />;
  }

  return <OrdersList token={token} onLogout={() => setToken(null)} />;
}
