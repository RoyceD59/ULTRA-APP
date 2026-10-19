import { useGetMonitoringSnapshot, getGetMonitoringSnapshotQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Gauge, Globe, CreditCard, CheckCircle2, AlertTriangle, XCircle,
  RefreshCw, ShoppingBag, BellOff, ArrowRight, Server,
} from "lucide-react";
import { formatRelativeDate } from "@/components/shared/badges";
import { RuntimeDiagnosticsPanel } from "@/components/monitoring/RuntimeDiagnosticsPanel";

const REFRESH_MS = 60_000;

// ─── Small display helpers ─────────────────────────────────────────────────────

function StatusPill({ ok, label }: { ok: boolean | null; label?: string }) {
  if (ok === null) return <span className="rounded-full bg-amber-500/10 text-amber-600 px-2.5 py-1 text-xs font-semibold">UNKNOWN / STALE</span>;
  return ok ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      {label ?? "UP"}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 px-2.5 py-1 text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      {label ?? "DOWN"}
    </span>
  );
}

function ServiceIcon({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
  if (status === "warn") return <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />;
  return <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />;
}

function HistoryBars({ history }: { history: Array<{ at: string; ok: boolean | null; responseMs?: number | null }> }) {
  if (!history.length) return null;
  return (
    <div className="flex items-end gap-[3px]" aria-label="Recent checks, oldest to newest">
      {history.map((p, i) => (
        <div
          key={i}
          title={`${new Date(p.at).toLocaleTimeString()} — ${p.ok ? `up${p.responseMs != null ? `, ${p.responseMs} ms` : ""}` : "down"}`}
          className={`w-1.5 rounded-sm ${p.ok ? "bg-emerald-500/80 h-5" : "bg-red-500 h-7"}`}
        />
      ))}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function MonitoringPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, isFetching, dataUpdatedAt } = useGetMonitoringSnapshot({
    query: {
      queryKey: getGetMonitoringSnapshotQueryKey(),
      refetchInterval: REFRESH_MS,
      refetchIntervalInBackground: false,
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetMonitoringSnapshotQueryKey() });

  return (
    <div className="space-y-8 animate-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Gauge className="w-8 h-8 text-primary" />
            Monitoring
          </h1>
          <p className="text-muted-foreground mt-1 text-lg">
            Live health of the store, app, payments, and background services.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-xs text-muted-foreground">
              Updated {formatRelativeDate(new Date(dataUpdatedAt).toISOString())} · auto-refreshes every minute
            </span>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={refresh} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="py-16 text-center border-2 border-dashed rounded-lg bg-muted/20">
          <XCircle className="w-12 h-12 text-destructive/60 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground">Couldn't load monitoring data</h3>
          <p className="text-muted-foreground mb-4">The API may be restarting — try again in a moment.</p>
          <Button variant="outline" onClick={refresh} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Try again
          </Button>
        </div>
      ) : (
        <>
          {/* Site checks */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {data.site.map((check) => {
              const upCount = check.history.filter((h) => h.ok).length;
              const uptimePct = check.history.length
                ? Math.round((upCount / check.history.length) * 1000) / 10
                : null;
              return (
                <Card key={check.key} className="overflow-hidden">
                  <CardHeader className="pb-3 border-b bg-muted/10">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Globe className="w-5 h-5 text-muted-foreground" />
                        {check.label}
                      </CardTitle>
                       <StatusPill ok={!check.checkedAt || Date.now()-Date.parse(check.checkedAt)>120000 ? null : check.ok} />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{check.url}</p>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-4">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground text-xs block mb-1">Response time</span>
                        <span className="font-semibold">
                          {check.responseMs != null ? `${check.responseMs} ms` : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block mb-1">HTTP status</span>
                        <span className="font-semibold">{check.httpStatus ?? "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block mb-1">Last checked</span>
                         <span className="font-semibold">{check.checkedAt ? formatRelativeDate(check.checkedAt) : "Unknown"}</span>
                      </div>
                    </div>
                    {check.error && (
                      <p className="text-xs text-destructive font-medium">{check.error}</p>
                    )}
                     <p className="text-xs text-muted-foreground">{check.coverage}</p>
                    <div className="flex items-end justify-between gap-4 pt-1">
                      <HistoryBars history={check.history} />
                      {uptimePct != null && check.history.length > 1 && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {uptimePct}% of last {check.history.length} checks
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Payment readiness */}
            <Card>
              <CardHeader className="pb-3 border-b bg-muted/10">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CreditCard className="w-5 h-5 text-muted-foreground" />
                   Payment configuration (not delivery verification)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="divide-y">
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-sm font-medium">Paystack (cards & mobile money)</span>
                    {data.payments.paystack
                      ? <Badge variant="secondary">Credentials present · unverified</Badge>
                      : <Badge variant="destructive">Not configured</Badge>}
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-sm font-medium">M-Pesa</span>
                    {data.payments.mpesaMode === "live"
                      ? <Badge variant="secondary">Credentials present · unverified</Badge>
                      : <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15">Demo mode</Badge>}
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-sm font-medium">Stripe</span>
                    {data.payments.stripe
                      ? <Badge variant="secondary">Enabled · unverified</Badge>
                      : <Badge variant="secondary">Off</Badge>}
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-sm font-medium">Cash on delivery</span>
                    <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15">Always on</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Services */}
            <Card>
              <CardHeader className="pb-3 border-b bg-muted/10">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Server className="w-5 h-5 text-muted-foreground" />
                  Services
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="divide-y">
                  {data.services.map((svc) => (
                    <div key={svc.name} className="flex items-start gap-3 py-2.5">
                      <div className="mt-0.5"><ServiceIcon status={svc.status} /></div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-tight">{svc.name}</p>
                        <p className="text-xs text-muted-foreground">{svc.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Problem feed */}
          <Card>
            <CardHeader className="pb-3 border-b bg-muted/10">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="w-5 h-5 text-muted-foreground" />
                Needs attention
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Link href="/orders">
                  <button className="w-full flex items-center gap-3 rounded-lg border p-4 text-left hover:bg-accent/50 transition-colors">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-muted">
                      <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">
                        {data.problems.recoveryOrders === null ? "Recovery order count unknown" : data.problems.recoveryOrders > 0
                          ? `${data.problems.recoveryOrders} unresolved recovery order${data.problems.recoveryOrders > 1 ? "s" : ""}`
                          : "No unresolved recovery orders"}
                      </p>
                      <p className="text-xs text-muted-foreground">Orders rebuilt from missed webhooks</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </button>
                </Link>
                <Link href="/uc-notifications">
                  <button className="w-full flex items-center gap-3 rounded-lg border p-4 text-left hover:bg-accent/50 transition-colors">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-muted">
                      <BellOff className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">
                        {data.problems.notificationFailures7d === null ? "Notification failure count unknown" : data.problems.notificationFailures7d > 0
                          ? `${data.problems.notificationFailures7d} failed notification${data.problems.notificationFailures7d > 1 ? "s" : ""} (7 days)`
                          : "No failed notifications (7 days)"}
                      </p>
                      <p className="text-xs text-muted-foreground">SMS & email delivery failures</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </>
      )}
      <RuntimeDiagnosticsPanel />
    </div>
  );
}
