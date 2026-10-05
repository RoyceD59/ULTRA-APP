/**
 * UC Orders — ProjectHub team view
 *
 * Admin-gated page. Uses the same UC Companion email+password credentials
 * as the Impact and Alison Feedback pages. Token stored in sessionStorage.
 *
 * Highlights webhook recovery orders with an amber "Webhook recovery" badge
 * so the team knows to enrich and fulfil them manually.
 */
import { useState, useEffect, useRef } from "react";
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
import { API_ORIGIN } from "@/lib/api-base";
import { OrderDetailsDialog } from "@/components/orders/OrderDetailsDialog";
import { RecoveryEnrichmentDialog } from "@/components/orders/RecoveryEnrichmentDialog";

const BASE      = API_ORIGIN;
const TOKEN_KEY = "uc_orders_admin_token";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminOrder {
  checkoutState?: string | null;
  paymentStatus?: string;
  synchronizationStatus?: string;
  paymentConfirmedAt?: string | null;
  wcOrderId?: number | null;
  shippingAddress?: Record<string, string>;
  recoveryEnrichedAt?: string | null;
  discountAmount?: number;
  promoCode?: string;
  id: number;
  userId: string;
  status: string;
  dateCreated: string;
  total: string;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  codCollectionStatus?: "awaiting_collection" | "collected" | null;
  codCollectedBy?: string | null;
  codCollectedAt?: string | null;
  codWcSyncStatus?: "pending" | "succeeded" | "failed" | null;
  codWcSyncError?: string | null;
  codWcSyncAttemptedAt?: string | null;
  codWcSyncAttemptCount?: number;
  webhookRecovery: boolean;
  customerStage?: "accepted" | "shipped" | "delivered" | null;
  customerStageUpdatedAt?: string | null;
  lineItems: { productId: number; name: string; quantity: number; total: string }[];
}

const CUSTOMER_STAGES = ["accepted", "shipped", "delivered"] as const;
type CustomerStage = typeof CUSTOMER_STAGES[number];
function customerStageLabel(stage: CustomerStage) { return stage.charAt(0).toUpperCase() + stage.slice(1); }

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
    case "dispatched": return "bg-blue-100 text-blue-800";
    case "paid":       return "bg-emerald-100 text-emerald-800";
    case "completed":  return "bg-emerald-100 text-emerald-800";
    case "declined":   return "bg-red-100 text-red-800";
    case "cancelled":  return "bg-red-100 text-red-800";
    case "refunded":   return "bg-violet-100 text-violet-800";
    default:           return "bg-muted text-muted-foreground";
  }
}

function paymentMethodLabel(method: string) {
  if (method === "cod")      return "Cash on delivery";
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
  const isCodAwaitingCollection = order.paymentMethod === "cod" && order.codCollectionStatus === "awaiting_collection";
  const collectionIdempotencyRef = useRef<string | null>(null);

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
    await call("PATCH", status === "dispatched" ? "" : "/status", { status });
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

  async function confirmCashCollection() {
    setBusy("cod-collection");
    collectionIdempotencyRef.current ??= crypto.randomUUID();
    await call("POST", "/cod-collection", { idempotencyKey: collectionIdempotencyRef.current });
    setBusy(null);
  }

  return (
    <div className="mt-3 pt-3 border-t space-y-2">
      <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
        {order.webhookRecovery && (
          <RecoveryEnrichmentDialog order={order} token={token} onChanged={onChanged} disabled={busy !== null || isRefunded} />
        )}
        {order.webhookRecovery && (["processing", "completed"] as const).map(status => (
          <Button key={status} variant="outline" size="sm" className="min-h-11 sm:min-h-7 text-xs"
            disabled={busy !== null || isRefunded || order.status === status || (status === "processing" && order.status === "completed")}
            onClick={() => setStatus(status)}>
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            {busy === status ? "Saving…" : `Mark ${status}`}
          </Button>
        ))}
        {!isRefunded && !["dispatched", "completed", "cancelled", "declined"].includes(order.status) && (
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-7 text-xs"
            disabled={busy !== null || (order.webhookRecovery && !order.recoveryEnrichedAt)}
            onClick={() => setStatus("dispatched")}>
            <Package className="w-3.5 h-3.5 mr-1" />
            {busy === "dispatched" ? "Saving…" : "Mark dispatched"}
          </Button>
        )}
        {!isRefunded && !["paid", "dispatched", "completed"].includes(order.status) && (
          <Button
            variant="outline" size="sm"
            onClick={() => setStatus("paid")}
            disabled={busy !== null}
            className="min-h-11 sm:min-h-7 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
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
            className="min-h-11 sm:min-h-7 text-xs text-red-700 border-red-300 hover:bg-red-50"
          >
            <XCircle className="w-3.5 h-3.5 mr-1" />
            {busy === "declined" ? "Saving…" : "Mark declined"}
          </Button>
        )}

        {isCodAwaitingCollection && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline" size="sm" disabled={busy !== null}
                className="min-h-11 sm:min-h-7 text-xs text-amber-800 border-amber-300 hover:bg-amber-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                {busy === "cod-collection" ? "Confirming…" : "Confirm cash collected"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm cash collection for order #{order.id}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Confirm only after cash has been received. This records your account and the collection time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmCashCollection}>Confirm collection</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* Refund — real Paystack refund for card payments; confirmation required */}
        {!isRefunded && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline" size="sm"
                disabled={busy !== null}
                className="min-h-11 sm:min-h-7 text-xs text-violet-700 border-violet-300 hover:bg-violet-50"
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
              className="min-h-11 sm:min-h-7 text-xs text-muted-foreground hover:text-destructive sm:ml-auto"
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
      {order.webhookRecovery && <p className="text-xs text-muted-foreground">
        {order.recoveryEnrichedAt
          ? `Enriched ${new Date(order.recoveryEnrichedAt).toLocaleString()}${order.status === "dispatched" ? " — dispatched." : ["paid", "pending", "processing"].includes(order.status) ? " — ready to dispatch." : " — details confirmed."}`
          : "Save enrichment to confirm items and shipping before dispatch."}
        {" "}Internal status only; customer delivery updates are separate.
      </p>}

      {error && (
        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-md p-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

/** This is intentionally separate from payment/fulfilment status above. */
function CustomerStageActions({ order, token, onChanged }: { order: AdminOrder; token: string; onChanged: () => void }) {
  const [pending, setPending] = useState<CustomerStage | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  // Keep the key for a retry of this exact stage action; a different stage is
  // a separate customer notification and must receive a new key.
  const idempotencyRef = useRef<{ stage: CustomerStage; key: string } | null>(null);
  const currentIndex = order.customerStage ? CUSTOMER_STAGES.indexOf(order.customerStage) : -1;
  async function advance(stage: CustomerStage) {
    setPending(stage); setError(""); setResult("");
    if (idempotencyRef.current?.stage !== stage) {
      idempotencyRef.current = { stage, key: crypto.randomUUID() };
    }
    try {
      const response = await fetch(`${BASE}/api/uc/admin/orders/${order.id}/customer-stage`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stage, idempotencyKey: idempotencyRef.current.key }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; notification?: { status?: string; message?: string }; push?: { status?: string; message?: string }; customerStage?: string };
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      const notification = body.notification ?? body.push;
      setResult(notification?.status ? `Customer stage saved. Push ${notification.status}${notification.message ? `: ${notification.message}` : ""}.` : "Customer stage saved. Push outcome recorded.");
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update customer stage."); }
    finally { setPending(null); }
  }
  return <div className="mt-3 pt-3 border-t space-y-2">
    <p className="text-xs font-medium">Customer-facing delivery update <span className="font-normal text-muted-foreground">— separate from internal order status</span></p>
    <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap">{CUSTOMER_STAGES.map((stage, index) => <Button key={stage} size="sm" variant={order.customerStage === stage ? "default" : "outline"} className="min-h-11 sm:min-h-7 text-xs" disabled={pending !== null || index <= currentIndex} onClick={() => advance(stage)}>{pending === stage ? "Saving…" : customerStageLabel(stage)}</Button>)}</div>
    {result && <p className="text-xs text-emerald-700" role="status">{result}</p>}
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
  </div>;
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
  const [receiptState, setReceiptState] = useState<"idle" | "busy" | "error">("idle");

  async function downloadReceipt() {
    setReceiptState("busy");
    try {
      const res = await fetch(`${BASE}/api/uc/admin/orders/${order.id}/receipt.json`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        // Token expired or revoked — same handling as the CSV export
        sessionStorage.removeItem(TOKEN_KEY);
        window.location.reload();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { receipt?: { serial?: string } };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `${data.receipt?.serial ?? `order-${order.id}`}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(anchor.href);
      setReceiptState("idle");
    } catch {
      setReceiptState("error");
      setTimeout(() => setReceiptState("idle"), 4000);
    }
  }

  return (
    <Card className={isRecovery ? "border-amber-400" : ""}>
      <CardHeader className="pb-2 pt-4 px-4 sm:px-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold">Order #{order.id}</span>
            {!!order.checkoutState && <Badge variant="outline">Checkout: {order.checkoutState.replaceAll("_", " ")}</Badge>}
            {!!order.paymentStatus && <Badge variant="outline">Payment: {order.paymentStatus.replaceAll("_", " ")}</Badge>}
            {order.synchronizationStatus === "reconciliation_required" && <Badge variant="destructive">Synchronization needs review — do not resubmit payment</Badge>}
            {order.synchronizationStatus === "local_only" && <Badge variant="outline">Accepted locally</Badge>}
            {!!order.shippingAddress?.fulfillment && <Badge variant="outline">{order.shippingAddress.fulfillment === "collection" ? "Free collection" : "Delivery"}</Badge>}
            {/* Webhook recovery badge — persisted flag, never derived from heuristics */}
            {isRecovery && (
              <Badge className="border-amber-300 bg-amber-100 text-amber-950 hover:bg-amber-100 gap-1 text-xs font-medium">
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
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
            {order.paymentMethod === "cod" && (
              <Badge className={order.codCollectionStatus === "collected"
                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                : "bg-amber-100 text-amber-800 hover:bg-amber-100"}>
                {order.codCollectionStatus === "collected" ? "Cash collected" : "Awaiting cash collection"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-xs">
              {formatRelativeDate(order.dateCreated)}
            </span>
            <OrderDetailsDialog order={order} />
          </div>
        </div>

        {/* Customer row */}
        <p className="text-xs text-muted-foreground mt-1">
          {customerIsEmail ? "Customer email" : "Customer"}:{" "}
          <span className="font-mono break-all">{order.userId}</span>
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
            <span className="font-mono text-xs font-medium break-all">{order.paymentReference}</span>
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
        {order.paymentMethod === "cod" && order.codCollectionStatus === "collected" && (
          <div className="mt-1.5 space-y-1">
            <p className="text-xs text-emerald-700">
              Cash collected by <span className="font-medium">{order.codCollectedBy ?? "Unknown"}</span>
              {order.codCollectedAt ? ` on ${new Date(order.codCollectedAt).toLocaleString()}` : ""}.
            </p>
            {order.codWcSyncStatus === "failed" && (
              <p className="text-xs text-amber-800" role="alert">
                WooCommerce still needs payment-status sync (attempt {order.codWcSyncAttemptCount ?? 0}).
                {order.codWcSyncError ? ` ${order.codWcSyncError}` : ""}
              </p>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="px-4 sm:px-5 pb-4">
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
                <li key={i} className="text-sm flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
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
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 px-2 text-xs ${receiptState === "error" ? "text-destructive" : "text-muted-foreground"}`}
            title="Download a structured receipt (JSON) for bookkeeping / inventory / CRM import"
            disabled={receiptState === "busy"}
            onClick={downloadReceipt}
          >
            {receiptState === "error"
              ? <AlertCircle className="w-3 h-3 mr-1" />
              : <Download className={`w-3 h-3 mr-1 ${receiptState === "busy" ? "animate-pulse" : ""}`} />}
            {receiptState === "error" ? "Failed — retry" : "Receipt"}
          </Button>
          <div className="text-sm font-semibold text-right">
            Total: {order.currency} {order.total}
            {order.shippingAddress?.shippingAmount !== undefined && <span className="text-xs ml-2">Shipping: KES {order.shippingAddress.shippingAmount}</span>}
            {!!order.discountAmount && <span className="text-xs ml-2">Discount: KES {order.discountAmount} {order.promoCode}</span>}
          </div>
        </div>
        <OrderActions order={order} token={token} onChanged={onChanged} />
        <CustomerStageActions order={order} token={token} onChanged={onChanged} />
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
      if (statusFilter) params.set("status", statusFilter);
      if (recoveryOnly) params.set("webhookRecovery", "true");
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
    refetchInterval: 30_000,
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
    o => !["processing", "completed", "cancelled"].includes(o.status)
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
  const [diagnosticError, setDiagnosticError] = useState("");
  async function downloadDiagnostics() {
    setDiagnosticError("");
    const ids = visibleOrders.slice(0, 100).map(o => o.id);
    if (!ids.length) { setDiagnosticError("Clear your filters or select a date range with orders first."); return; }
    try {
      const response = await fetch(`${BASE}/api/uc/admin/orders/reconciliation-report?ids=${ids.join(",")}`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("The report could not be read. No orders were changed.");
      const body = await response.json();
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "checkout-diagnostics.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setDiagnosticError(error instanceof Error ? error.message : "Report unavailable."); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={downloadDiagnostics}>Download read-only checkout diagnostics</Button>
        <span className="text-sm text-muted-foreground">First 100 visible orders only. No payment, ownership or synchronization changes.</span>
        {!!diagnosticError && <p role="alert" className="text-destructive">{diagnosticError}</p>}
        {visibleOrders.length < (orders?.length ?? 0) && <span className="text-sm text-muted-foreground">
          {(orders?.length ?? 0) - visibleOrders.length} orders hidden by the current status/recovery filters.
        </span>}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
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
        <div className="grid w-full grid-cols-2 sm:w-auto sm:flex sm:items-center gap-2">
          {/* Recovery-only filter toggle */}
          <Button
            variant={recoveryOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setRecoveryOnly(v => !v)}
            className={recoveryOnly ? "min-h-11 bg-amber-500 hover:bg-amber-600 text-white border-amber-500" : "min-h-11"}
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
          <Button className="min-h-11" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button className="min-h-11" variant="ghost" size="sm" onClick={onLogout} title="Sign out" aria-label="Sign out">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Date range picker */}
      <div className="grid grid-cols-1 sm:flex sm:items-center gap-3">
        <div className="grid grid-cols-[auto_1fr] items-center gap-2">
          <Label htmlFor="orders-from" className="text-sm text-muted-foreground whitespace-nowrap">From</Label>
          <Input
            id="orders-from"
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="w-full sm:w-40 min-h-11 sm:min-h-8 text-sm"
          />
        </div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-2">
          <Label htmlFor="orders-to" className="text-sm text-muted-foreground whitespace-nowrap">To</Label>
          <Input
            id="orders-to"
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="w-full sm:w-40 min-h-11 sm:min-h-8 text-sm"
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
          <span className="hidden sm:inline text-xs text-orange-600 font-medium whitespace-nowrap">View only →</span>
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
          <span className="hidden sm:inline text-xs text-amber-600 font-medium whitespace-nowrap">View only →</span>
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
              onChanged={() => {
                void refetch();
                window.dispatchEvent(new Event("uc-orders-changed"));
              }}
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
