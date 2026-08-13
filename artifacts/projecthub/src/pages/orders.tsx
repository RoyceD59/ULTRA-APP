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
  LogOut, Copy, Check, ExternalLink, Filter, X,
} from "lucide-react";
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
    case "processing": return "bg-blue-100 text-blue-800";
    case "completed":  return "bg-emerald-100 text-emerald-800";
    case "cancelled":  return "bg-red-100 text-red-800";
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

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({ order }: { order: AdminOrder }) {
  const isRecovery   = order.webhookRecovery;
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
            {order.lineItems.map((item, i) => (
              <li key={i} className="text-sm flex justify-between">
                <span>{item.name} × {item.quantity}</span>
                <span className="text-muted-foreground">{order.currency} {item.total}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 text-sm font-semibold text-right">
          Total: {order.currency} {order.total}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Orders list ──────────────────────────────────────────────────────────────

function OrdersList({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [recoveryOnly, setRecoveryOnly] = useState(false);

  const { data: orders, isLoading, isError, refetch, isFetching } = useQuery<AdminOrder[]>({
    queryKey: ["admin-orders", token],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/uc/admin/orders`, {
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

  const recoveryOrders  = orders?.filter(o => o.webhookRecovery) ?? [];
  const unresolvedCount = recoveryOrders.filter(
    o => o.status !== "completed" && o.status !== "cancelled"
  ).length;
  const visibleOrders   = recoveryOnly ? recoveryOrders : (orders ?? []);

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
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} title="Sign out">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

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
          {recoveryOnly ? "No recovery orders." : "No orders yet."}
        </div>
      )}

      {visibleOrders.length > 0 && (
        <div className="space-y-3">
          {visibleOrders.map(order => (
            <OrderCard key={order.id} order={order} />
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
