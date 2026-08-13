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
  Wrench, RefreshCw, Lock, AlertCircle, LogOut, Download, Image, Video, X,
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

interface TicketCardProps {
  ticket: AdminTicket;
  token: string;
  onUpdate: (updated: AdminTicket) => void;
}

function TicketCard({ ticket, token, onUpdate }: TicketCardProps) {
  const [updating, setUpdating] = useState(false);
  const [error, setError]       = useState("");

  async function changeStatus(newStatus: string) {
    if (newStatus === ticket.status || updating) return;
    setUpdating(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/api/uc/admin/tickets/${ticket.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      const updated = await res.json() as AdminTicket;
      onUpdate(updated);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setUpdating(false);
    }
  }

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
        {/* Status controls */}
        <div className="flex items-center gap-1.5 pt-1 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Move to:</span>
          {STATUSES.map(s => (
            <button
              key={s}
              disabled={s === ticket.status || updating}
              onClick={() => changeStatus(s)}
              className={[
                "text-xs px-2.5 py-0.5 rounded-full border transition-colors",
                s === ticket.status
                  ? `${statusColor(s)} border-transparent cursor-default opacity-70`
                  : "border-border hover:bg-muted disabled:opacity-40 cursor-pointer",
              ].join(" ")}
            >
              {statusLabel(s)}
            </button>
          ))}
          {updating && <span className="text-xs text-muted-foreground animate-pulse ml-1">Saving…</span>}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
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
  const [fromDate, setFromDate] = useState("");
  const [toDate,   setToDate]   = useState("");
  const [localTickets, setLocalTickets] = useState<AdminTicket[] | null>(null);

  function buildParams() {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate)   params.set("to",   toDate);
    return params;
  }

  const { data: tickets, isLoading, isError, refetch, isFetching } = useQuery<AdminTicket[]>({
    queryKey: ["admin-tickets", token, statusFilter, fromDate, toDate],
    queryFn: async () => {
      const params = buildParams();
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

  // Sync local copy whenever the query result changes
  useEffect(() => { setLocalTickets(tickets ?? null); }, [tickets]);

  function handleTicketUpdate(updated: AdminTicket) {
    setLocalTickets(prev => {
      if (!prev) return prev;
      // When a status filter is active, remove the ticket if it no longer matches
      if (statusFilter !== "all" && updated.status !== statusFilter) {
        return prev.filter(t => t.id !== updated.id);
      }
      return prev.map(t => (t.id === updated.id ? updated : t));
    });
  }

  const displayTickets = localTickets ?? tickets;

  async function downloadCsv() {
    setExporting(true);
    try {
      const params = buildParams();
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

      {/* Filters row: status tabs + date range */}
      <div className="space-y-3">
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
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="tickets-from" className="text-sm text-muted-foreground whitespace-nowrap">From</Label>
            <Input
              id="tickets-from"
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-40 h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="tickets-to" className="text-sm text-muted-foreground whitespace-nowrap">To</Label>
            <Input
              id="tickets-to"
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
      </div>

      {isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading tickets…</div>
      )}
      {isError && (
        <div className="text-destructive text-sm py-12 text-center">
          Failed to load tickets. Please refresh or sign in again.
        </div>
      )}
      {displayTickets && displayTickets.length === 0 && !isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">
          {statusFilter !== "all" ? `No ${statusLabel(statusFilter).toLowerCase()} tickets.` : "No tickets yet."}
        </div>
      )}
      {displayTickets && displayTickets.length > 0 && (
        <div className="space-y-3">
          {displayTickets.map(t => (
            <TicketCard key={t.id} ticket={t} token={token} onUpdate={handleTicketUpdate} />
          ))}
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
