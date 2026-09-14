import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2, CheckCircle2, AlertCircle, ShieldCheck, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { isTeamAdmin, getAuthHeaders } from "@/lib/team-auth";
import { API_BASE_URL } from "@/lib/api-base";

const API = API_BASE_URL;

interface RetentionField {
  value: number;
  source: "db" | "env" | "default";
  updatedAt: string | null;
}

interface NotificationSettingsData {
  successRetentionDays: RetentionField;
  failureRetentionDays: RetentionField;
}

async function fetchNotificationSettings(): Promise<NotificationSettingsData> {
  const res = await fetch(`${API}/admin/notification-settings`, {
    headers: getAuthHeaders() ?? {},
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<NotificationSettingsData>;
}

async function saveNotificationSettings(payload: {
  successRetentionDays?: number;
  failureRetentionDays?: number;
}): Promise<void> {
  const res = await fetch(`${API}/admin/notification-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(getAuthHeaders() ?? {}) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
}

// ─── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: "db" | "env" | "default" }) {
  if (source === "db") {
    return (
      <Badge variant="default" className="gap-1 text-xs">
        <ShieldCheck className="w-3 h-3" /> Stored in database
      </Badge>
    );
  }
  if (source === "env") {
    return (
      <Badge variant="secondary" className="gap-1 text-xs">
        <AlertCircle className="w-3 h-3" /> Using environment variable
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs">
      <AlertCircle className="w-3 h-3" /> Using built-in default
    </Badge>
  );
}

// ─── Retention settings form ───────────────────────────────────────────────────

function RetentionSettingsCard({ data }: { data: NotificationSettingsData }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [successDays, setSuccessDays] = useState(String(data.successRetentionDays.value));
  const [failureDays, setFailureDays] = useState(String(data.failureRetentionDays.value));

  const mutation = useMutation({
    mutationFn: () =>
      saveNotificationSettings({
        successRetentionDays: parseInt(successDays, 10),
        failureRetentionDays: parseInt(failureDays, 10),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-notification-settings"] });
      toast({
        title: "Retention windows saved",
        description:
          "The notification log pruning schedule will use the new values from the next nightly run.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const successVal = parseInt(successDays, 10);
  const failureVal = parseInt(failureDays, 10);
  const isValid =
    Number.isInteger(successVal) && successVal >= 1 && successVal <= 3650 &&
    Number.isInteger(failureVal) && failureVal >= 1 && failureVal <= 3650;

  const { successRetentionDays: s, failureRetentionDays: f } = data;
  const lastUpdated = s.source === "db" && s.updatedAt ? s.updatedAt : null;

  return (
    <div className="rounded-lg border bg-card p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            Notification Log Retention
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Control how long notification logs are kept before the nightly pruning job removes them.
            Successful sends are kept for a shorter window; failed sends are kept longer so the team
            can investigate and retry. Changes take effect at the next 03:00 UTC pruning run.
          </p>
        </div>
      </div>

      {lastUpdated && (
        <div className="rounded-md bg-muted/50 border px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          Last updated {new Date(lastUpdated).toLocaleString()}.
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Successful sends */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="success-days" className="text-sm font-medium">
              Successful sends (days)
            </Label>
            <SourceBadge source={s.source} />
          </div>
          <Input
            id="success-days"
            type="number"
            min={1}
            max={3650}
            value={successDays}
            onChange={(e) => setSuccessDays(e.target.value)}
            disabled={mutation.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Logs for successfully delivered notifications are pruned after this many days.
            Default: <strong>30</strong>.
          </p>
        </div>

        {/* Failed sends */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="failure-days" className="text-sm font-medium">
              Failed sends (days)
            </Label>
            <SourceBadge source={f.source} />
          </div>
          <Input
            id="failure-days"
            type="number"
            min={1}
            max={3650}
            value={failureDays}
            onChange={(e) => setFailureDays(e.target.value)}
            disabled={mutation.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Logs for failed delivery attempts are kept longer so the team has time to investigate.
            Default: <strong>90</strong>.
          </p>
        </div>
      </div>

      <div>
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !isValid}
          className="gap-2"
        >
          {mutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
          ) : (
            <><Save className="w-4 h-4" />Save retention windows</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminNotificationSettingsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-notification-settings"],
    queryFn: fetchNotificationSettings,
  });

  if (!isTeamAdmin()) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        You don't have permission to view this page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="w-6 h-6" /> Notification Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how long notification logs are retained. Changes do not require a server restart.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading settings…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive">
          Failed to load settings: {(error as Error).message}
        </div>
      ) : data ? (
        <RetentionSettingsCard data={data} />
      ) : null}
    </div>
  );
}
