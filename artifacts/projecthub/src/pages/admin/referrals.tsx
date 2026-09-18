import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, ChevronLeft, ChevronRight, History, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAuthHeaders } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";

const base = () => API_ORIGIN;

interface ThresholdChange {
  actorTeamUserId: string;
  actorName: string;
  actorEmail: string;
  previousValue: number;
  newValue: number;
  changedAt: string;
}

interface ReferralsSettings {
  settlementFailureThreshold: number;
  latestThresholdChange: ThresholdChange | null;
  settlementFailures: Array<{
    orderId: number;
    attempts: number;
    lastError: string;
    nextAttemptAt: string | null;
    alertedAt: string | null;
  }>;
  referrals: Array<{
    id: number;
    code: string;
    ownerEmail: string;
    ownerName: string;
    referredCount: number;
    conversions: number;
  }>;
}

interface ThresholdHistory {
  changes: ThresholdChange[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

function normalizeChange(value: Record<string, unknown> | null): ThresholdChange | null {
  if (!value) return null;
  return {
    actorTeamUserId: String(value.actorTeamUserId ?? value.actor_team_user_id),
    actorName: String(value.actorName ?? value.actor_name),
    actorEmail: String(value.actorEmail ?? value.actor_email),
    previousValue: Number(value.previousValue ?? value.previous_value),
    newValue: Number(value.newValue ?? value.new_value),
    changedAt: String(value.changedAt ?? value.changed_at),
  };
}

async function fetchSettings(): Promise<ReferralsSettings> {
  const response = await fetch(`${base()}/api/uc/admin/referrals`, {
    headers: getAuthHeaders() ?? {},
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? `Request failed (${response.status})`));
  return {
    settlementFailureThreshold: Number(body.settlementFailureThreshold ?? 3),
    latestThresholdChange: normalizeChange(
      (body.latestThresholdChange as Record<string, unknown> | null) ?? null,
    ),
    settlementFailures: Array.isArray(body.settlementFailures)
      ? body.settlementFailures.map((value) => {
          const row = value as Record<string, unknown>;
          return {
            orderId: Number(row.orderId ?? row.order_id),
            attempts: Number(row.attempts),
            lastError: String(row.lastError ?? row.last_error ?? "Unknown error"),
            nextAttemptAt: (row.nextAttemptAt ?? row.next_attempt_at) as string | null,
            alertedAt: (row.alertedAt ?? row.alerted_at) as string | null,
          };
        })
      : [],
    referrals: Array.isArray(body.referrals)
      ? body.referrals.map((value) => {
          const row = value as Record<string, unknown>;
          return {
            id: Number(row.id),
            code: String(row.code),
            ownerEmail: String(row.ownerEmail ?? row.owner_email),
            ownerName: String(row.ownerName ?? row.owner_name),
            referredCount: Number(row.referredCount ?? row.referred_count),
            conversions: Number(row.conversions),
          };
        })
      : [],
  };
}

async function updateSettings(failureAlertThreshold: number): Promise<void> {
  const response = await fetch(`${base()}/api/uc/admin/referrals/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(getAuthHeaders() ?? {}) },
    body: JSON.stringify({ failureAlertThreshold }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? `Request failed (${response.status})`));
}

async function fetchThresholdHistory(page: number): Promise<ThresholdHistory> {
  const response = await fetch(
    `${base()}/api/uc/admin/referrals/threshold-history?page=${page}&pageSize=10`,
    { headers: getAuthHeaders() ?? {} },
  );
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? `Request failed (${response.status})`));
  const pagination = body.pagination as Record<string, unknown>;
  return {
    changes: Array.isArray(body.changes)
      ? body.changes
          .map((change) => normalizeChange(change as Record<string, unknown>))
          .filter((change): change is ThresholdChange => change !== null)
      : [],
    pagination: {
      page: Number(pagination.page),
      pageSize: Number(pagination.pageSize),
      total: Number(pagination.total),
      totalPages: Number(pagination.totalPages),
    },
  };
}

export default function AdminReferralsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-referrals"],
    queryFn: fetchSettings,
  });
  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-referrals"] });
    },
  });
  const history = useQuery({
    queryKey: ["admin-referral-threshold-history", historyPage],
    queryFn: () => fetchThresholdHistory(historyPage),
    enabled: historyOpen,
  });
  const value = draft ?? data?.settlementFailureThreshold ?? 3;
  const valid = Number.isInteger(value) && value >= 1 && value <= 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BellRing className="h-6 w-6" /> Referral support
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control when the team is warned about referral rewards that remain stuck.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading settings…
        </p>
      ) : error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load referral settings."}
        </div>
      ) : data ? (
        <section className="space-y-5 rounded-lg border bg-card p-5">
          <div>
            <h2 className="font-semibold">Failure alert threshold</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Send the referral support alert after this many failed settlement attempts.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Label className="space-y-2">
              <span>Attempts</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={value}
                onChange={(event) => setDraft(Number(event.target.value))}
                className="w-28"
                disabled={save.isPending}
              />
            </Label>
            <Button
              className="gap-2"
              disabled={!valid || draft === null || save.isPending}
              onClick={() => save.mutate(value)}
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </div>
          {save.isError && (
            <p className="text-sm text-destructive">
              {save.error instanceof Error ? save.error.message : "Could not save the threshold."}
            </p>
          )}
          <div className="rounded-md border bg-muted/40 p-4 text-sm">
            <h3 className="font-medium">Latest threshold change</h3>
            {data.latestThresholdChange ? (
              <p className="mt-1 text-muted-foreground">
                <span className="font-medium text-foreground">{data.latestThresholdChange.actorName}</span>
                {" "}({data.latestThresholdChange.actorEmail}) changed the threshold from{" "}
                <span className="font-medium text-foreground">{data.latestThresholdChange.previousValue}</span>
                {" "}to{" "}
                <span className="font-medium text-foreground">{data.latestThresholdChange.newValue}</span>
                {" "}on {new Date(data.latestThresholdChange.changedAt).toLocaleString()}.
              </p>
            ) : (
              <p className="mt-1 text-muted-foreground">No threshold changes have been recorded yet.</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 gap-2"
              onClick={() => setHistoryOpen((open) => !open)}
              data-testid="button-toggle-threshold-history"
            >
              <History className="h-4 w-4" />
              {historyOpen ? "Hide change history" : "View change history"}
            </Button>
            {historyOpen && (
              <div className="mt-4 border-t pt-4" data-testid="section-threshold-history">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-medium">Threshold change history</h4>
                  {history.data && (
                    <span className="text-xs text-muted-foreground" data-testid="text-threshold-history-total">
                      {history.data.pagination.total} recorded change{history.data.pagination.total === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {history.isLoading ? (
                  <p className="mt-3 text-muted-foreground" data-testid="status-threshold-history-loading">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading history…
                  </p>
                ) : history.error ? (
                  <p className="mt-3 text-destructive" data-testid="status-threshold-history-error">
                    {history.error instanceof Error ? history.error.message : "Could not load threshold history."}
                  </p>
                ) : history.data?.changes.length ? (
                  <div className="mt-3 space-y-2">
                    {history.data.changes.map((change) => (
                      <article
                        key={`${change.changedAt}-${change.actorTeamUserId}-${change.newValue}`}
                        className="rounded-md border bg-background p-3"
                        data-testid={`card-threshold-change-${change.changedAt}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{change.actorName}</p>
                            <p className="text-xs text-muted-foreground">{change.actorEmail}</p>
                          </div>
                          <time className="text-xs text-muted-foreground" dateTime={change.changedAt}>
                            {new Date(change.changedAt).toLocaleString()}
                          </time>
                        </div>
                        <p className="mt-2 text-muted-foreground">
                          Changed from <span className="font-medium text-foreground">{change.previousValue}</span>
                          {" "}to <span className="font-medium text-foreground">{change.newValue}</span>
                        </p>
                      </article>
                    ))}
                    <div className="flex items-center justify-between pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={historyPage <= 1 || history.isFetching}
                        onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                        data-testid="button-threshold-history-previous"
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                      </Button>
                      <span className="text-xs text-muted-foreground" data-testid="text-threshold-history-page">
                        Page {history.data.pagination.page} of {history.data.pagination.totalPages}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          historyPage >= history.data.pagination.totalPages || history.isFetching
                        }
                        onClick={() => setHistoryPage((page) => page + 1)}
                        data-testid="button-threshold-history-next"
                      >
                        Next <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-muted-foreground" data-testid="status-threshold-history-empty">
                    No threshold changes have been recorded yet.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <h3 className="font-medium">Referral settlements needing attention</h3>
            {data.settlementFailures.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No referral settlements have reached the current failure threshold.
              </p>
            ) : (
              data.settlementFailures.map((failure) => (
                <article key={failure.orderId} className="rounded-md border p-4 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">Order #{failure.orderId}</span>
                    <span>{failure.attempts} failed attempts</span>
                  </div>
                  <p className="mt-2 break-words text-muted-foreground">{failure.lastError}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {failure.alertedAt
                      ? `Team alerted ${new Date(failure.alertedAt).toLocaleString()}`
                      : failure.nextAttemptAt
                        ? `Next retry ${new Date(failure.nextAttemptAt).toLocaleString()}`
                        : "Retry pending"}
                  </p>
                </article>
              ))
            )}
          </div>
          <div className="space-y-3">
            <h3 className="font-medium">Referral records</h3>
            {data.referrals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No referral records have been created yet.</p>
            ) : (
              data.referrals.map((referral) => (
                <article key={referral.id} className="rounded-md border p-4 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{referral.code}</span>
                    <span>{referral.conversions} successful conversions</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {referral.ownerName || referral.ownerEmail} · {referral.referredCount} referred customers
                  </p>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}