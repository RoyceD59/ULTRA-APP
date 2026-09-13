/**
 * UC Water Test Bookings — ProjectHub team view
 *
 * Admin-gated page. Lets the team view and filter water test booking submissions
 * from the UC Companion app. Includes a "Download CSV" button that respects the
 * active status filter.
 */
import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Droplets, RefreshCw, Lock, AlertCircle, LogOut, Download, Image, Video,
  MapPin, Phone, X,
} from "lucide-react";
import { formatRelativeDate } from "@/components/shared/badges";
import { getTeamToken } from "@/lib/team-auth";

const BASE      = import.meta.env.BASE_URL.replace(/\/$/, "");
const TOKEN_KEY = "uc_water_tests_admin_token";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminWaterTest {
  id: string;
  userId: string;
  name: string;
  address: string;
  phone: string;
  waterSource: string;
  concerns: string;
  photos: string[];
  videos: string[];
  status: string;
  customerStage?: "accepted" | "conducted" | "result_sent" | null;
  customerStageUpdatedAt?: string | null;
  hasResult?: boolean;
  createdAt: string;
}

const CUSTOMER_STAGES = ["accepted", "conducted", "result_sent"] as const;
type CustomerStage = typeof CUSTOMER_STAGES[number];
function customerStageLabel(stage: CustomerStage) {
  return stage === "result_sent" ? "Result sent" : stage.charAt(0).toUpperCase() + stage.slice(1);
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

      const checkRes = await fetch(`${BASE}/api/uc/admin/water-tests`, {
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
          <CardTitle className="text-xl">Sign in to view Water Tests</CardTitle>
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
    case "pending":   return "bg-yellow-100 text-yellow-800";
    case "scheduled": return "bg-blue-100 text-blue-800";
    case "completed": return "bg-green-100 text-green-800";
    default:          return "bg-gray-100 text-gray-700";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "pending":   return "Pending";
    case "scheduled": return "Scheduled";
    case "completed": return "Completed";
    default:          return status;
  }
}

// ─── Water Test Card ──────────────────────────────────────────────────────────

interface WaterTestCardProps {
  test: AdminWaterTest;
  token: string;
  onUpdate: (updated: AdminWaterTest) => void;
}

function WaterTestCard({ test, token, onUpdate }: WaterTestCardProps) {
  const [updating, setUpdating] = useState(false);
  const [error, setError]       = useState("");
  const [saved, setSaved]       = useState(false);
  const [stageSaving, setStageSaving] = useState<CustomerStage | null>(null);
  const [stageResult, setStageResult] = useState("");
  const [stageError, setStageError] = useState("");
  const [deliveryReference, setDeliveryReference] = useState("");
  const stageIdempotencyRef = useRef<{ stage: CustomerStage; key: string } | null>(null);

  // Auto-dismiss the "Saved ✓" confirmation after ~2 seconds
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  async function changeStatus(newStatus: string) {
    if (newStatus === test.status || updating) return;
    setUpdating(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch(`${BASE}/api/uc/admin/water-tests/${test.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      const updated = await res.json() as AdminWaterTest;
      setSaved(true);
      onUpdate(updated);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setUpdating(false);
    }
  }

  async function changeCustomerStage(stage: CustomerStage) {
    if (stageSaving) return;
    setStageSaving(stage); setStageError(""); setStageResult("");
    if (stageIdempotencyRef.current?.stage !== stage) {
      stageIdempotencyRef.current = { stage, key: crypto.randomUUID() };
    }
    try {
      const res = await fetch(`${BASE}/api/uc/admin/water-tests/${test.id}/customer-stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stage, idempotencyKey: stageIdempotencyRef.current.key, ...(deliveryReference.trim() ? { resultDeliveryReference: deliveryReference.trim() } : {}) }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; notification?: { status?: string; message?: string }; push?: { status?: string; message?: string }; customerStage?: string };
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      const push = body.notification ?? body.push;
      setStageResult(push?.status ? `Customer stage saved. Push ${push.status}${push.message ? `: ${push.message}` : ""}.` : "Customer stage saved. Push outcome recorded.");
      onUpdate({ ...test, customerStage: (body.customerStage ?? stage) as CustomerStage });
    } catch (cause) {
      setStageError(cause instanceof Error ? cause.message : "Could not update customer stage.");
    } finally { setStageSaving(null); }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug line-clamp-1">
              #{test.id} — {test.name || "Unknown"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatRelativeDate(test.createdAt)} · User {test.userId.slice(0, 8)}…
            </p>
          </div>
          <Badge className={`${statusColor(test.status)} border-0 shrink-0 text-xs`}>
            {statusLabel(test.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {test.phone && (
            <span className="flex items-center gap-1">
              <Phone className="w-3 h-3" />{test.phone}
            </span>
          )}
          {test.address && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />{test.address}
            </span>
          )}
          {test.waterSource && (
            <span>Source: <span className="text-foreground">{test.waterSource}</span></span>
          )}
        </div>
        {test.concerns && (
          <p className="text-muted-foreground line-clamp-2">{test.concerns}</p>
        )}
        {(test.photos.length > 0 || test.videos.length > 0) && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {test.photos.length > 0 && (
              <span className="flex items-center gap-1">
                <Image className="w-3 h-3" />{test.photos.length}
              </span>
            )}
            {test.videos.length > 0 && (
              <span className="flex items-center gap-1">
                <Video className="w-3 h-3" />{test.videos.length}
              </span>
            )}
          </div>
        )}
        {/* Status controls */}
        <div className="flex items-center gap-1.5 pt-1 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Move to:</span>
          {STATUSES.map(s => (
            <button
              key={s}
              disabled={s === test.status || updating}
              onClick={() => changeStatus(s)}
              className={[
                "min-h-11 sm:min-h-7 text-xs px-2.5 py-0.5 rounded-full border transition-colors",
                s === test.status
                  ? `${statusColor(s)} border-transparent cursor-default opacity-70`
                  : "border-border hover:bg-muted disabled:opacity-40 cursor-pointer",
              ].join(" ")}
            >
              {statusLabel(s)}
            </button>
          ))}
          {updating && <span className="text-xs text-muted-foreground animate-pulse ml-1">Saving…</span>}
          {!updating && saved && (
            <span className="text-xs text-green-600 ml-1" role="status">Saved ✓</span>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="pt-3 mt-3 border-t space-y-2">
          <p className="text-xs font-medium">Customer-facing test update <span className="font-normal text-muted-foreground">— separate from internal booking status</span></p>
          {(!test.hasResult && !deliveryReference) && <div className="max-w-sm"><Label htmlFor={`result-reference-${test.id}`} className="text-xs">Result-delivery reference <span className="text-muted-foreground">(required before Result sent if no result is attached)</span></Label><Input id={`result-reference-${test.id}`} className="h-8 mt-1 text-xs" value={deliveryReference} onChange={event => setDeliveryReference(event.target.value)} placeholder="Result link, file, or delivery note" /></div>}
          <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap">{CUSTOMER_STAGES.map((stage, index) => {
            const current = test.customerStage ? CUSTOMER_STAGES.indexOf(test.customerStage) : -1;
            const needsReference = stage === "result_sent" && !test.hasResult && !deliveryReference.trim();
            return <Button key={stage} size="sm" variant={test.customerStage === stage ? "default" : "outline"} className="min-h-11 sm:min-h-7 text-xs px-1 sm:px-3" disabled={stageSaving !== null || index <= current || needsReference} onClick={() => changeCustomerStage(stage)}>{stageSaving === stage ? "Saving…" : customerStageLabel(stage)}</Button>;
          })}</div>
          {stageResult && <p className="text-xs text-emerald-700" role="status">{stageResult}</p>}
          {stageError && <p className="text-xs text-destructive" role="alert">{stageError}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Water Tests list ──────────────────────────────────────────────────────────

const STATUSES = ["pending", "scheduled", "completed"] as const;
type StatusFilter = (typeof STATUSES)[number] | "all";

function WaterTestsList({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [exporting, setExporting] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate,   setToDate]   = useState("");
  const [localTests, setLocalTests] = useState<AdminWaterTest[] | null>(null);
  const queryClient = useQueryClient();

  function buildParams() {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate)   params.set("to",   toDate);
    return params;
  }

  const queryKey = ["admin-water-tests", token, statusFilter, fromDate, toDate];

  const { data: tests, isLoading, isError, refetch, isFetching } = useQuery<AdminWaterTest[]>({
    queryKey,
    queryFn: async () => {
      const params = buildParams();
      const url = `${BASE}/api/uc/admin/water-tests${params.size ? `?${params}` : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        sessionStorage.removeItem(TOKEN_KEY);
        onLogout();
        return [];
      }
      if (!res.ok) throw new Error("Failed to load water tests");
      return res.json() as Promise<AdminWaterTest[]>;
    },
    refetchOnWindowFocus: false,
  });

  // Sync local copy whenever the query result changes
  useEffect(() => { setLocalTests(tests ?? null); }, [tests]);

  async function handleTestUpdate(updated: AdminWaterTest) {
    // Cancel any in-flight background refetch BEFORE writing to the cache.
    // Without this, a refetch that started before the PATCH committed can
    // resolve after setQueryData and overwrite the just-saved status.
    await queryClient.cancelQueries({ queryKey });

    function patch(list: AdminWaterTest[]): AdminWaterTest[] {
      if (statusFilter !== "all" && updated.status !== statusFilter) {
        return list.filter(t => t.id !== updated.id);
      }
      return list.map(t => (t.id === updated.id ? updated : t));
    }

    // Write the PATCH result into the React Query cache (single source of truth).
    queryClient.setQueryData<AdminWaterTest[]>(queryKey, prev => prev ? patch(prev) : prev);
    // Also update local state immediately so the UI doesn't wait for a render cycle.
    setLocalTests(prev => prev ? patch(prev) : prev);
  }

  const displayTests = localTests ?? tests;

  async function downloadCsv() {
    setExporting(true);
    try {
      const params = buildParams();
      const url = `${BASE}/api/uc/admin/water-tests.csv${params.size ? `?${params}` : ""}`;
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
      anchor.download = `water-tests-${dateStr}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(anchor.href);
    } catch {
      // silent — the button will re-enable
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Droplets className="w-6 h-6" />
            Water Test Bookings
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Customer water test booking requests from the Companion app.
          </p>
        </div>
        <div className="grid w-full grid-cols-2 sm:w-auto sm:flex sm:items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCsv}
            disabled={exporting || isLoading}
            title="Download visible water tests as CSV"
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

      {/* Filters row: status tabs + date range */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:flex gap-2">
          {(["all", ...STATUSES] as StatusFilter[]).map(s => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm" className="min-h-11"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "All" : statusLabel(s)}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:flex sm:items-center gap-3">
          <div className="grid grid-cols-[auto_1fr] items-center gap-2">
            <Label htmlFor="wt-from" className="text-sm text-muted-foreground whitespace-nowrap">From</Label>
            <Input
              id="wt-from"
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-full sm:w-40 min-h-11 sm:min-h-8 text-sm"
            />
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-2">
            <Label htmlFor="wt-to" className="text-sm text-muted-foreground whitespace-nowrap">To</Label>
            <Input
              id="wt-to"
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
      </div>

      {isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading water tests…</div>
      )}
      {isError && (
        <div className="text-destructive text-sm py-12 text-center">
          Failed to load water tests. Please refresh or sign in again.
        </div>
      )}
      {displayTests && displayTests.length === 0 && !isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">
          {statusFilter !== "all" ? `No ${statusLabel(statusFilter).toLowerCase()} water tests.` : "No water tests yet."}
        </div>
      )}
      {displayTests && displayTests.length > 0 && (
        <div className="space-y-3">
          {displayTests.map(t => (
            <WaterTestCard key={t.id} test={t} token={token} onUpdate={handleTestUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function WaterTestsPage() {
  const [token, setToken] = useState<string | null>(() =>
    getTeamToken() ?? sessionStorage.getItem(TOKEN_KEY)
  );

  useEffect(() => {
    if (!token) sessionStorage.removeItem(TOKEN_KEY);
  }, [token]);

  if (!token) {
    return <LoginGate onToken={setToken} />;
  }

  return <WaterTestsList token={token} onLogout={() => setToken(null)} />;
}
