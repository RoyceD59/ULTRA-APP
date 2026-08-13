/**
 * UC Maintenance Tickets — ProjectHub team view
 *
 * Admin-gated page. Lets the team view and filter maintenance ticket submissions
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
  Wrench, RefreshCw, Lock, AlertCircle, LogOut, Download, Image, Video,
} from "lucide-react";
import { formatRelativeDate } from "@/components/shared/badges";
import { getTeamToken } from "@/lib/team-auth";

const BASE      = import.meta.env.BASE_URL.replace(/\/$/, "");
const TOKEN_KEY = "uc_tickets_admin_token";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminTicket {
  id: string;
  userId: string;
  productModel: string;
  issueDescription: string;
  preferredContactTime: string;
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

      const checkRes = await fetch(`${BASE}/api/uc/admin/tickets`, {
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
          <CardTitle className="text-xl">Sign in to view Tickets</CardTitle>
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
    case "submitted":   return "bg-blue-100 text-blue-800";
    case "in_progress": return "bg-amber-100 text-amber-800";
    case "resolved":    return "bg-green-100 text-green-800";
    default:            return "bg-gray-100 text-gray-700";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "submitted":   return "Submitted";
    case "in_progress": return "In Progress";
    case "resolved":    return "Resolved";
    default:            return status;
  }
}

// ─── Ticket Card ──────────────────────────────────────────────────────────────

function TicketCard({ ticket }: { ticket: AdminTicket }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug line-clamp-1">
              #{ticket.id} — {ticket.productModel || "Unknown model"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatRelativeDate(ticket.createdAt)} · User {ticket.userId.slice(0, 8)}…
            </p>
          </div>
          <Badge className={`${statusColor(ticket.status)} border-0 shrink-0 text-xs`}>
            {statusLabel(ticket.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {ticket.issueDescription && (
          <p className="text-muted-foreground line-clamp-3">{ticket.issueDescription}</p>
        )}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {ticket.preferredContactTime && (
            <span>Preferred contact: <span className="text-foreground">{ticket.preferredContactTime}</span></span>
          )}
          {ticket.photos.length > 0 && (
            <span className="flex items-center gap-1">
              <Image className="w-3 h-3" />{ticket.photos.length}
            </span>
          )}
          {ticket.videos.length > 0 && (
            <span className="flex items-center gap-1">
              <Video className="w-3 h-3" />{ticket.videos.length}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tickets list ──────────────────────────────────────────────────────────────

const STATUSES = ["submitted", "in_progress", "resolved"] as const;
type StatusFilter = (typeof STATUSES)[number] | "all";

function TicketsList({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [exporting, setExporting] = useState(false);

  const { data: tickets, isLoading, isError, refetch, isFetching } = useQuery<AdminTicket[]>({
    queryKey: ["admin-tickets", token, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const url = `${BASE}/api/uc/admin/tickets${params.size ? `?${params}` : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        sessionStorage.removeItem(TOKEN_KEY);
        onLogout();
        return [];
      }
      if (!res.ok) throw new Error("Failed to load tickets");
      return res.json() as Promise<AdminTicket[]>;
    },
    refetchOnWindowFocus: false,
  });

  async function downloadCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const url = `${BASE}/api/uc/admin/tickets.csv${params.size ? `?${params}` : ""}`;
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
      anchor.download = `tickets-${dateStr}.csv`;
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
            <Wrench className="w-6 h-6" />
            Maintenance Tickets
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Customer maintenance requests from the Companion app.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCsv}
            disabled={exporting || isLoading}
            title="Download visible tickets as CSV"
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
        <div className="text-muted-foreground text-sm py-12 text-center">Loading tickets…</div>
      )}
      {isError && (
        <div className="text-destructive text-sm py-12 text-center">
          Failed to load tickets. Please refresh or sign in again.
        </div>
      )}
      {tickets && tickets.length === 0 && !isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">
          {statusFilter !== "all" ? `No ${statusLabel(statusFilter).toLowerCase()} tickets.` : "No tickets yet."}
        </div>
      )}
      {tickets && tickets.length > 0 && (
        <div className="space-y-3">
          {tickets.map(t => <TicketCard key={t.id} ticket={t} />)}
        </div>
      )}
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function TicketsPage() {
  const [token, setToken] = useState<string | null>(() =>
    getTeamToken() ?? sessionStorage.getItem(TOKEN_KEY)
  );

  useEffect(() => {
    if (!token) sessionStorage.removeItem(TOKEN_KEY);
  }, [token]);

  if (!token) {
    return <LoginGate onToken={setToken} />;
  }

  return <TicketsList token={token} onLogout={() => setToken(null)} />;
}
