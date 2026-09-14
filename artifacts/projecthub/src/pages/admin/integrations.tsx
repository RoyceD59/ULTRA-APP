import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Webhook, RefreshCw, Loader2, CheckCircle2, AlertCircle, Link2Off,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { isTeamAdmin, getAuthHeaders } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";

const BASE = API_ORIGIN;

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntegrationsData {
  n8nInventoryWebhook: {
    isSet: boolean;
    /** Hostname only (never the path, which may contain bearer tokens). */
    hostname: string | null;
    updatedAt: string | null;
  };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchIntegrations(): Promise<IntegrationsData> {
  const res = await fetch(`${BASE}/api/admin/integrations`, { headers: getAuthHeaders() ?? {} });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<IntegrationsData>;
}

async function saveIntegrations(payload: { n8nInventoryWebhookUrl: string }): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/integrations`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(getAuthHeaders() ?? {}) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
}

// ─── n8n Webhook Card ─────────────────────────────────────────────────────────

function N8nWebhookCard({ data }: { data: IntegrationsData }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { n8nInventoryWebhook: wh } = data;

  const [showInput, setShowInput] = useState(false);
  const [url, setUrl] = useState("");

  const mutation = useMutation({
    mutationFn: () => saveIntegrations({ n8nInventoryWebhookUrl: url }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-integrations"] });
      toast({
        title: "Webhook URL saved",
        description: "The n8n inventory sync URL has been updated. Use 'Sync now' on the Inventory page to trigger it.",
      });
      setUrl("");
      setShowInput(false);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => saveIntegrations({ n8nInventoryWebhookUrl: "" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-integrations"] });
      toast({ title: "Webhook URL removed" });
      setShowInput(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to clear", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Webhook className="w-4 h-4 text-primary" />
            n8n Inventory Sync Webhook
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            When the "Sync now" button is pressed on the Inventory page, this n8n webhook URL
            is triggered via POST request. n8n then runs its inventory-sync automation to pull
            live stock data from WooCommerce and update any connected systems.
          </p>
        </div>
        {wh.isSet ? (
          <Badge variant="default" className="gap-1 text-xs flex-shrink-0">
            <CheckCircle2 className="w-3 h-3" /> Configured
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1 text-xs flex-shrink-0">
            <AlertCircle className="w-3 h-3" /> Not configured
          </Badge>
        )}
      </div>

      {wh.isSet && (
        <div className="rounded-md bg-muted/50 border px-4 py-3 text-sm text-muted-foreground flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            {wh.hostname
              ? <p>Webhook configured at <code className="font-mono text-xs">{wh.hostname}</code></p>
              : <p>Webhook configured</p>
            }
            {wh.updatedAt && (
              <p className="text-xs mt-0.5">Last updated {new Date(wh.updatedAt).toLocaleString()}</p>
            )}
          </div>
        </div>
      )}

      {!wh.isSet && (
        <div className="rounded-md bg-muted/50 border px-4 py-3 text-sm text-muted-foreground">
          No webhook URL configured. The "Sync now" button on the Inventory page will return an error
          until a URL is set here. You can find the webhook URL in your n8n workflow's trigger node.
        </div>
      )}

      {showInput ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="n8n-url">
              {wh.isSet ? "New webhook URL (replaces current)" : "n8n webhook URL"}
            </Label>
            <Input
              id="n8n-url"
              type="url"
              placeholder="https://your-n8n.example.com/webhook/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={mutation.isPending}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Copy the "Webhook URL" from the Webhook trigger node in your n8n inventory-sync workflow.
              It must start with <code className="font-mono">https://</code>.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => { setShowInput(false); setUrl(""); }}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !url.trim().startsWith("http")}
            >
              {mutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving…</>
                : wh.isSet ? "Update URL" : "Save URL"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setShowInput(true)}
          >
            <RefreshCw className="w-4 h-4" />
            {wh.isSet ? "Update URL" : "Set URL"}
          </Button>
          {wh.isSet && (
            <Button
              variant="ghost"
              className="gap-2 text-destructive hover:text-destructive"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
            >
              {clearMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Link2Off className="w-4 h-4" />}
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminIntegrationsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-integrations"],
    queryFn: fetchIntegrations,
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
          <Webhook className="w-6 h-6" /> Integrations
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure third-party automation and integration settings. Changes take effect immediately.
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
        <N8nWebhookCard data={data} />
      ) : null}
    </div>
  );
}
