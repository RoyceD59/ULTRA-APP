import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gift, Loader2, ToggleLeft, ToggleRight, Search, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders, isTeamAdmin } from "@/lib/team-auth";

const base = () => import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RewardsRule {
  id: number;
  eventType: string;
  label: string;
  pointsValue: number;
  active: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

interface GrantResult {
  entry: { id: number; userId: number; points: number; reason: string; createdAt: string };
  customer: { id: number; email: string; firstName: string; phone: string };
  newBalance: number;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function listRules(): Promise<RewardsRule[]> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${base()}/api/uc/admin/rewards/rules`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch rules: ${res.status}`);
  const data = await res.json() as { rules: RewardsRule[] };
  return data.rules;
}

async function patchRule(id: number, updates: { pointsValue?: number; active?: boolean }, email: string): Promise<RewardsRule> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${base()}/api/uc/admin/rewards/rules/${id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ...updates, updatedBy: email }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? "Update failed");
  }
  const data = await res.json() as { rule: RewardsRule };
  return data.rule;
}

async function grantPoints(payload: {
  lookup: string; points: number; reason: string; grantedBy: string;
}): Promise<GrantResult> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${base()}/api/uc/admin/rewards/grant`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? "Grant failed");
  }
  return res.json() as Promise<GrantResult>;
}

// ─── Rules Table Row ──────────────────────────────────────────────────────────

function RuleRow({ rule, onSaved }: { rule: RewardsRule; onSaved: (r: RewardsRule) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [pointsInput, setPointsInput] = useState(String(rule.pointsValue));

  const { email } = { email: "" }; // grantedBy tracked at page level

  const mutation = useMutation({
    mutationFn: (updates: { pointsValue?: number; active?: boolean }) =>
      patchRule(rule.id, updates, ""),
    onSuccess: (updated) => {
      onSaved(updated);
      setEditing(false);
      toast({ title: "Rule updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  function handlePointsSave() {
    const v = parseInt(pointsInput, 10);
    if (isNaN(v) || v < 0) {
      toast({ title: "Invalid value", description: "Points must be a non-negative integer.", variant: "destructive" });
      return;
    }
    mutation.mutate({ pointsValue: v });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{rule.label}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{rule.eventType}</TableCell>
      <TableCell>
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={pointsInput}
              onChange={(e) => setPointsInput(e.target.value)}
              className="w-24 h-8 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") handlePointsSave(); if (e.key === "Escape") setEditing(false); }}
              autoFocus
            />
            <Button size="sm" className="h-8" onClick={handlePointsSave} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => { setPointsInput(String(rule.pointsValue)); setEditing(false); }}>
              Cancel
            </Button>
          </div>
        ) : (
          <button
            className="font-semibold text-primary hover:underline cursor-pointer"
            onClick={() => setEditing(true)}
            title="Click to edit"
          >
            {rule.pointsValue} pts
          </button>
        )}
      </TableCell>
      <TableCell>
        <button
          onClick={() => mutation.mutate({ active: !rule.active })}
          disabled={mutation.isPending}
          className="flex items-center gap-1.5 text-sm"
          title={rule.active ? "Click to deactivate" : "Click to activate"}
        >
          {rule.active
            ? <ToggleRight className="w-5 h-5 text-green-500" />
            : <ToggleLeft className="w-5 h-5 text-muted-foreground" />}
          <Badge variant={rule.active ? "default" : "secondary"} className="text-xs">
            {rule.active ? "Active" : "Inactive"}
          </Badge>
        </button>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {rule.updatedBy ?? "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(rule.updatedAt).toLocaleDateString()}
      </TableCell>
    </TableRow>
  );
}

// ─── Manual Award Form ────────────────────────────────────────────────────────

const REASON_PRESETS = [
  "Filter replacement reward",
  "Qualifying product purchase",
  "Referral bonus",
  "Promotional award",
  "Customer goodwill gesture",
  "Other",
];

function AwardForm() {
  const { toast } = useToast();
  const [lookup, setLookup]   = useState("");
  const [points, setPoints]   = useState("");
  const [reason, setReason]   = useState("");
  const [customReason, setCustomReason] = useState("");
  const [result, setResult]   = useState<GrantResult | null>(null);

  const effectiveReason = reason === "Other" ? customReason.trim() : reason;

  const mutation = useMutation({
    mutationFn: () => grantPoints({
      lookup: lookup.trim(),
      points: parseInt(points, 10),
      reason: effectiveReason,
      grantedBy: "",
    }),
    onSuccess: (data) => {
      setResult(data);
      setLookup("");
      setPoints("");
      setReason("");
      setCustomReason("");
      toast({
        title: `${data.entry.points} points awarded to ${data.customer.firstName}`,
        description: `New balance: ${data.newBalance} pts`,
      });
    },
    onError: (err: Error) => toast({ title: "Award failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit = lookup.trim() && points && !isNaN(parseInt(points, 10)) && parseInt(points, 10) > 0 && effectiveReason;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Account lookup */}
        <div className="space-y-2">
          <Label htmlFor="award-lookup">Account (phone, email, or QR string)</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="award-lookup"
              placeholder="e.g. +254712345678 or user@email.com or uc-rewards:…"
              value={lookup}
              onChange={(e) => { setLookup(e.target.value); setResult(null); }}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Enter a phone number, email address, or scan/paste the QR value from the app.
          </p>
        </div>

        {/* Points */}
        <div className="space-y-2">
          <Label htmlFor="award-points">Points to award</Label>
          <Input
            id="award-points"
            type="number"
            min={1}
            placeholder="e.g. 100"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </div>

        {/* Reason */}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="award-reason">Reason</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger id="award-reason">
              <SelectValue placeholder="Select a reason…" />
            </SelectTrigger>
            <SelectContent>
              {REASON_PRESETS.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {reason === "Other" && (
            <Input
              placeholder="Describe the reason…"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
            />
          )}
        </div>
      </div>

      {/* Success result */}
      {result && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-green-800">
              {result.entry.points} points awarded to {result.customer.firstName} ({result.customer.email})
            </p>
            <p className="text-green-700">New balance: <strong>{result.newBalance} pts</strong></p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Awarding…</>
            : "Award points"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminRewardsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rules = [], isLoading, refetch } = useQuery({
    queryKey: ["rewards-rules"],
    queryFn: listRules,
  });

  const [localRules, setLocalRules] = useState<RewardsRule[] | null>(null);
  const displayRules = localRules ?? rules;

  function handleRuleSaved(updated: RewardsRule) {
    setLocalRules((prev) => {
      const base = prev ?? rules;
      return base.map((r) => (r.id === updated.id ? updated : r));
    });
    void qc.invalidateQueries({ queryKey: ["rewards-rules"] });
  }

  if (!isTeamAdmin()) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        You don't have permission to view this page.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gift className="w-6 h-6" /> UC Rewards
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure reward rules and manually award points to customers.
        </p>
      </div>

      {/* Rules table */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Reward Rules</h2>
        <p className="text-sm text-muted-foreground">
          Click a points value to edit it inline. Toggle the status badge to activate or deactivate a rule.
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading rules…
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Type key</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last updated by</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRules.map((rule) => (
                  <RuleRow key={rule.id} rule={rule} onSaved={handleRuleSaved} />
                ))}
                {displayRules.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No reward rules configured yet. Seed the database to add default rules.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Manual award */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Award Points Manually</h2>
        <p className="text-sm text-muted-foreground">
          Look up a customer account and credit points with a reason. The entry will appear in their ledger immediately.
        </p>
        <div className="rounded-lg border bg-card p-6">
          <AwardForm />
        </div>
      </div>
    </div>
  );
}
