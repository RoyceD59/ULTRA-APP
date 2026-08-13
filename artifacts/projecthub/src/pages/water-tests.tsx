/**
 * UC Water Test Bookings — ProjectHub team view
 *
 * Admin-gated page. Lets the team view and filter water test booking submissions
 * from the UC Companion app. Includes a "Download CSV" button that respects the
 * active status filter.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Droplets, RefreshCw, Lock, AlertCircle, LogOut, Download, Image, Video,
  MapPin, Phone,
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
  createdAt: string;
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

function WaterTestCard({ test }: { test: AdminWaterTest }) {
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

  const { data: tests, isLoading, isError, refetch, isFetching } = useQuery<AdminWaterTest[]>({
    queryKey: ["admin-water-tests", token, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
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

  async function downloadCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Droplets className="w-6 h-6" />
            Water Test Bookings
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Customer water test booking requests from the Companion app.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} title="Sign out">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["all", ...STATUSES] as StatusFilter[]).map(s => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s === "all" ? "All" : statusLabel(s)}
          </Button>
        ))}
      </div>

      {isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading water tests…</div>
      )}
      {isError && (
        <div className="text-destructive text-sm py-12 text-center">
          Failed to load water tests. Please refresh or sign in again.
        </div>
      )}
      {tests && tests.length === 0 && !isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">
          {statusFilter !== "all" ? `No ${statusLabel(statusFilter).toLowerCase()} water tests.` : "No water tests yet."}
        </div>
      )}
      {tests && tests.length > 0 && (
        <div className="space-y-3">
          {tests.map(t => <WaterTestCard key={t.id} test={t} />)}
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
