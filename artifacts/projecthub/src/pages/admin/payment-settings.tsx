import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound, RefreshCw, Loader2, CheckCircle2, AlertCircle, ShieldCheck, Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { isTeamAdmin, getAuthHeaders } from "@/lib/team-auth";

const API = "/api";

interface PaymentSettingsData {
  mpesaWebhookSecret: {
    source: "db" | "env" | "none";
    isSet: boolean;
    envHint: string | null;
    updatedAt: string | null;
  };
  teamAlertPhone: {
    source: "db" | "env" | "none";
    isSet: boolean;
    hint: string | null;
    updatedAt: string | null;
  };
}

async function fetchPaymentSettings(): Promise<PaymentSettingsData> {
  const res = await fetch(`${API}/admin/payment-settings`, {
    headers: getAuthHeaders() ?? {},
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<PaymentSettingsData>;
}

async function savePaymentSettings(
  payload: { mpesaWebhookSecret?: string; teamAlertPhone?: string },
): Promise<void> {
  const res = await fetch(`${API}/admin/payment-settings`, {
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

function SourceBadge({ source }: { source: "db" | "env" | "none" }) {
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
    <Badge variant="destructive" className="gap-1 text-xs">
      <AlertCircle className="w-3 h-3" /> Not configured
    </Badge>
  );
}

// ─── Team Alert Phone section ──────────────────────────────────────────────────

function TeamAlertPhoneCard({ data }: { data: PaymentSettingsData }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [showInput, setShowInput] = useState(false);

  const { teamAlertPhone: p } = data;

  const mutation = useMutation({
    mutationFn: () => savePaymentSettings({ teamAlertPhone: phone }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-payment-settings"] });
      toast({
        title: "Phone number saved",
        description: "The team alert phone number has been updated. The next recovery-order SMS will use this number.",
      });
      setPhone("");
      setShowInput(false);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Phone className="w-4 h-4 text-primary" />
            Team Alert Phone Number
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            When a recovery order is detected, an SMS is sent to this number as a
            fallback in case email is temporarily unavailable. Changes take effect
            immediately — no server restart needed.
          </p>
        </div>
        <SourceBadge source={p.source} />
      </div>

      {p.source === "env" && p.hint && (
        <div className="rounded-md bg-muted/50 border px-4 py-3 text-sm text-muted-foreground">
          Currently using the <code className="font-mono text-xs">TEAM_ALERT_PHONE</code> environment variable
          (ends in <code className="font-mono text-xs">{p.hint}</code>).
          Setting a number here will override it — no server restart required.
        </div>
      )}

      {p.source === "none" && (
        <div className="rounded-md bg-muted/50 border px-4 py-3 text-sm text-muted-foreground">
          No alert phone number configured. Recovery-order alerts will be email-only.
          Set a number below to enable SMS fallback.
        </div>
      )}

      {p.source === "db" && p.hint && (
        <div className="rounded-md bg-muted/50 border px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          Alert phone stored in database (ends in <code className="font-mono text-xs">{p.hint}</code>).
          {p.updatedAt && (
            <> Last updated {new Date(p.updatedAt).toLocaleString()}.</>
          )}
        </div>
      )}

      {showInput ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="alert-phone">
              {p.isSet ? "New phone number (replaces current)" : "Alert phone number"}
            </Label>
            <Input
              id="alert-phone"
              type="tel"
              placeholder="e.g. +254712345678 or 0712345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={mutation.isPending}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              International format (+254…) or Kenyan local format (07… / 01…) both work.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => { setShowInput(false); setPhone(""); }}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || phone.trim().length < 7}
            >
              {mutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving…</>
                : p.isSet ? "Update number" : "Set number"}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setShowInput(true)}
          >
            <RefreshCw className="w-4 h-4" />
            {p.isSet ? "Update number" : "Set number"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── M-Pesa Webhook Secret section ────────────────────────────────────────────

function MpesaWebhookSecretCard({ data }: { data: PaymentSettingsData }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [secret, setSecret] = useState("");
  const [showInput, setShowInput] = useState(false);

  const { mpesaWebhookSecret: s } = data;

  const mutation = useMutation({
    mutationFn: () => savePaymentSettings({ mpesaWebhookSecret: secret }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-payment-settings"] });
      toast({ title: "Secret saved", description: "The M-Pesa webhook secret has been updated. New callbacks will use the new secret immediately." });
      setSecret("");
      setShowInput(false);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            M-Pesa Webhook Secret
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Safaricom embeds this token in the callback URL when initiating an STK push.
            The callback handler verifies it before processing any payment, preventing
            forged "paid" callbacks from arbitrary internet clients.
          </p>
        </div>
        <SourceBadge source={s.source} />
      </div>

      {s.source === "env" && s.envHint && (
        <div className="rounded-md bg-muted/50 border px-4 py-3 text-sm text-muted-foreground">
          Currently using the <code className="font-mono text-xs">MPESA_WEBHOOK_SECRET</code> environment variable
          (ends in <code className="font-mono text-xs">{s.envHint}</code>).
          Setting a secret here will override it — no server restart required.
        </div>
      )}

      {s.source === "none" && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          ⚠️ No webhook secret is configured. In production, any internet client can forge
          M-Pesa "paid" callbacks and trigger fraudulent order fulfilment. Set a secret below.
        </div>
      )}

      {s.source === "db" && s.updatedAt && (
        <div className="rounded-md bg-muted/50 border px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          Secret stored and active. Last rotated{" "}
          {new Date(s.updatedAt).toLocaleString()}.
        </div>
      )}

      {showInput ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="mpesa-secret">
              {s.isSet ? "New secret (replaces current)" : "Webhook secret"}
            </Label>
            <Input
              id="mpesa-secret"
              type="password"
              placeholder="Enter a strong random string (min. 16 chars)"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={mutation.isPending}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Use a cryptographically random string of at least 32 characters.
              You can generate one with{" "}
              <code className="font-mono">openssl rand -hex 32</code>.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => { setShowInput(false); setSecret(""); }}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || secret.trim().length < 8}
            >
              {mutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving…</>
                : s.isSet ? "Rotate secret" : "Set secret"}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setShowInput(true)}
          >
            <RefreshCw className="w-4 h-4" />
            {s.isSet ? "Rotate secret" : "Set secret"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPaymentSettingsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-payment-settings"],
    queryFn: fetchPaymentSettings,
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
          <KeyRound className="w-6 h-6" /> Payment Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage payment integration secrets. Changes take effect immediately — no server restart needed.
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
        <>
          <TeamAlertPhoneCard data={data} />
          <MpesaWebhookSecretCard data={data} />
        </>
      ) : null}
    </div>
  );
}
