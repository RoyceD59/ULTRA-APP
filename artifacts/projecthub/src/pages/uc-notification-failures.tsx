/**
 * UC Notification Failures — ProjectHub team view
 *
 * Shows SMS and email sends that failed, pulled from uc_notification_log.
 * Each row has a Retry button that calls POST /api/uc/admin/notification-logs/:id/retry.
 * Rows clear from the list once retry succeeds.
 *
 * Uses the same UC Companion auth token as Orders / Impact pages.
 */
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle, BellOff, Lock, LogOut, RefreshCw,
  Mail, MessageSquare, RotateCcw, CheckCircle2, Filter, Trash2,
} from "lucide-react";
import { formatRelativeDate } from "@/components/shared/badges";
import { useToast } from "@/hooks/use-toast";
import { getTeamToken } from "@/lib/team-auth";

const BASE      = import.meta.env.BASE_URL.replace(/\/$/, "");
const TOKEN_KEY = "uc_notif_admin_token";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationLog {
  id: number;
  channel: "sms" | "email";
  provider: string;
  recipient: string;
  template: string;
  messageBody: string;
  orderId: number | null;
  ticketId: string | null;
  testId: string | null;
  status: "sent" | "failed";
  errorMessage: string | null;
  sentAt: string;
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

      // Verify admin access
      const checkRes = await fetch(`${BASE}/api/uc/admin/notification-logs?limit=1`, {
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
          <CardTitle className="text-xl">Sign in to view Notification Failures</CardTitle>
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

function channelIcon(channel: string) {
  return channel === "sms"
    ? <MessageSquare className="w-3.5 h-3.5" />
    : <Mail className="w-3.5 h-3.5" />;
}

function channelLabel(channel: string) {
  return channel === "sms" ? "SMS" : "Email";
}

function entityLabel(log: NotificationLog): string {
  if (log.orderId)  return `Order #${log.orderId}`;
  if (log.ticketId) return `Ticket ${log.ticketId}`;
  if (log.testId)   return `Water test ${log.testId}`;
  return "—";
}

// ─── Log Row ──────────────────────────────────────────────────────────────────

interface LogRowProps {
  log: NotificationLog;
  token: string;
  onRetrySuccess: (id: number) => void;
}

function LogRow({ log, token, onRetrySuccess }: LogRowProps) {
  const { toast } = useToast();

  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/uc/admin/notification-logs/${log.id}/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Retry failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Retry sent", description: `${channelLabel(log.channel)} to ${log.recipient} queued successfully.` });
      onRetrySuccess(log.id);
    },
    onError: (err: Error) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  const isPending = retryMutation.isPending;
  const isSuccess = retryMutation.isSuccess;

  return (
    <Card className={`transition-opacity ${isSuccess ? "opacity-50" : ""}`}>
      <CardContent className="px-5 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          {/* Left: channel + recipient + template */}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="gap-1 text-xs font-medium capitalize">
                {channelIcon(log.channel)}
                {channelLabel(log.channel)}
              </Badge>
              {log.provider && (
                <span className="text-xs text-muted-foreground">via {log.provider}</span>
              )}
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{entityLabel(log)}</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-medium truncate max-w-xs">{log.recipient}</span>
              {log.template && (
                <Badge variant="secondary" className="text-xs">{log.template}</Badge>
              )}
            </div>

            {/* Error message */}
            {log.errorMessage && (
              <div className="flex items-start gap-1.5 text-xs text-destructive bg-destructive/8 rounded-md px-2.5 py-1.5 mt-1">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span className="break-all">{log.errorMessage}</span>
              </div>
            )}
          </div>

          {/* Right: timestamp + retry */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatRelativeDate(log.sentAt)}
            </span>
            {isSuccess ? (
              <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Retried
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => retryMutation.mutate()}
                disabled={isPending}
                className="gap-1.5 text-xs h-7"
              >
                <RotateCcw className={`w-3 h-3 ${isPending ? "animate-spin" : ""}`} />
                {isPending ? "Retrying…" : "Retry"}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Failures List ────────────────────────────────────────────────────────────

function FailuresList({ token, onLogout }: { token: string; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [channelFilter, setChannelFilter] = useState<"all" | "sms" | "email">("all");
  // Track IDs that have been successfully retried so we can dim/hide them
  const [retriedIds, setRetriedIds] = useState<Set<number>>(new Set());

  const handleRetrySuccess = useCallback((id: number) => {
    setRetriedIds(prev => new Set(prev).add(id));
    // Refetch after a short delay so the row fades before disappearing on next refresh
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["uc-notification-failures", token] });
    }, 1500);
  }, [queryClient, token]);

  // Manual pruning — same cleanup as the nightly 03:00 UTC job, on demand.
  const pruneMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/uc/admin/notification-logs/prune`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Prune failed (${res.status})`);
      }
      return res.json() as Promise<{ deletedSuccess: number; deletedFailure: number; deletedTotal: number }>;
    },
    onSuccess: (result) => {
      toast({
        title: "Pruning complete",
        description: `${result.deletedTotal} old log entr${result.deletedTotal === 1 ? "y" : "ies"} deleted (${result.deletedSuccess} sent, ${result.deletedFailure} failed).`,
      });
      queryClient.invalidateQueries({ queryKey: ["uc-notification-failures", token] });
    },
    onError: (err: Error) => {
      toast({ title: "Pruning failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: logs, isLoading, isError, refetch, isFetching } = useQuery<NotificationLog[]>({
    queryKey: ["uc-notification-failures", token],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/uc/admin/notification-logs?status=failed&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        sessionStorage.removeItem(TOKEN_KEY);
        onLogout();
        return [];
      }
      if (!res.ok) throw new Error("Failed to load notification logs");
      return res.json() as Promise<NotificationLog[]>;
    },
    refetchOnWindowFocus: false,
  });

  const filtered = logs?.filter(log => {
    if (channelFilter !== "all" && log.channel !== channelFilter) return false;
    return true;
  }) ?? [];

  const smsCount   = logs?.filter(l => l.channel === "sms").length   ?? 0;
  const emailCount = logs?.filter(l => l.channel === "email").length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BellOff className="w-6 h-6" />
            Notification Failures
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Failed SMS and email sends — retry from here without opening the database.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => pruneMutation.mutate()}
            disabled={pruneMutation.isPending}
            title="Delete log entries past their retention window now, without waiting for the nightly job"
          >
            <Trash2 className={`w-4 h-4 mr-2 ${pruneMutation.isPending ? "animate-pulse" : ""}`} />
            {pruneMutation.isPending ? "Pruning…" : "Prune now"}
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

      {/* Summary banner */}
      {logs && logs.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-destructive">
              {logs.length} failed send{logs.length !== 1 ? "s" : ""} on record
            </p>
            <p className="text-sm text-destructive/80 mt-0.5">
              {smsCount > 0 && `${smsCount} SMS`}
              {smsCount > 0 && emailCount > 0 && " · "}
              {emailCount > 0 && `${emailCount} email`}
              . Use Retry to re-send immediately; the log updates automatically.
            </p>
          </div>
        </div>
      )}

      {/* Channel filter */}
      {logs && logs.length > 0 && (
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {(["all", "sms", "email"] as const).map(ch => (
            <Button
              key={ch}
              size="sm"
              variant={channelFilter === ch ? "default" : "outline"}
              onClick={() => setChannelFilter(ch)}
              className="h-7 text-xs capitalize gap-1"
            >
              {ch === "all" ? "All channels" : channelLabel(ch)}
              {ch !== "all" && (
                <span className="ml-0.5 opacity-70">
                  ({ch === "sms" ? smsCount : emailCount})
                </span>
              )}
            </Button>
          ))}
        </div>
      )}

      {/* States */}
      {isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">
          Loading notification failures…
        </div>
      )}

      {isError && (
        <div className="text-destructive text-sm py-12 text-center">
          Failed to load notification logs. Please refresh or sign in again.
        </div>
      )}

      {logs && logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          <p className="font-semibold text-lg">No failures on record</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            All SMS and email sends have succeeded. This panel only shows entries with status = failed.
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map(log => (
            <LogRow
              key={log.id}
              log={log}
              token={token}
              onRetrySuccess={handleRetrySuccess}
            />
          ))}
        </div>
      )}

      {logs && logs.length > 0 && filtered.length === 0 && (
        <div className="text-muted-foreground text-sm py-8 text-center">
          No {channelFilter} failures found.
        </div>
      )}
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function UcNotificationFailuresPage() {
  const [token, setToken] = useState<string | null>(() =>
    getTeamToken() ?? sessionStorage.getItem(TOKEN_KEY)
  );

  if (!token) {
    return <LoginGate onToken={setToken} />;
  }

  return <FailuresList token={token} onLogout={() => setToken(null)} />;
}
