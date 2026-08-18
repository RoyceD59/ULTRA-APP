import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gift, Loader2, ToggleLeft, ToggleRight, Search, CheckCircle2,
  Download, ChevronRight, Users, ArrowUpDown, ArrowUp, ArrowDown,
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
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
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

interface CustomerBalance {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  balance: number;
}

interface LedgerEntry {
  id: number;
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  points: number;
  reason: string;
  eventType: string;
  grantedBy: string | null;
  createdAt: string;
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

async function fetchBalances(search: string): Promise<CustomerBalance[]> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`${base()}/api/uc/admin/rewards/balances${params}`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch balances: ${res.status}`);
  const data = await res.json() as { customers: CustomerBalance[] };
  return data.customers;
}

async function fetchLedger(userId: number): Promise<LedgerEntry[]> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");
  const res = await fetch(`${base()}/api/uc/admin/rewards/ledger?userId=${userId}`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch ledger: ${res.status}`);
  const data = await res.json() as { ledger: LedgerEntry[] };
  return data.ledger;
}

// ─── Rules Table Row ──────────────────────────────────────────────────────────

function RuleRow({ rule, onSaved }: { rule: RewardsRule; onSaved: (r: RewardsRule) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [pointsInput, setPointsInput] = useState(String(rule.pointsValue));

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

// ─── Ledger Drawer ────────────────────────────────────────────────────────────

function LedgerDrawer({
  customer,
  open,
  onClose,
}: {
  customer: CustomerBalance | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();

  const { data: ledger = [], isLoading } = useQuery({
    queryKey: ["rewards-ledger", customer?.userId],
    queryFn: () => fetchLedger(customer!.userId),
    enabled: open && customer != null,
  });

  function downloadCsv(userId?: number) {
    const headers = getAuthHeaders();
    if (!headers) { toast({ title: "Not authenticated", variant: "destructive" }); return; }
    const params = userId ? `userId=${userId}&export=1` : `export=1`;
    fetch(`${base()}/api/uc/admin/rewards/ledger?${params}`, { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = userId ? `rewards-ledger-user${userId}.csv` : "rewards-ledger.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err: Error) => toast({ title: "Export failed", description: err.message, variant: "destructive" }));
  }

  if (!customer) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="text-base">
            {customer.firstName} {customer.lastName}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {customer.email} · {customer.phone || "no phone"} · <strong>{customer.balance} pts</strong>
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between px-6 py-3 border-b bg-muted/30">
          <span className="text-sm text-muted-foreground">Full points history</span>
          <Button size="sm" variant="outline" onClick={() => downloadCsv(customer.userId)}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading ledger…
            </div>
          ) : ledger.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">No entries found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Granted by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <span className={entry.points >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                        {entry.points >= 0 ? "+" : ""}{entry.points}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm max-w-48 truncate" title={entry.reason}>
                      {entry.reason}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs font-mono">{entry.eventType}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.grantedBy ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Customer Balances Section ────────────────────────────────────────────────

type SortKey = "name" | "email" | "phone" | "balance";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="w-3.5 h-3.5 ml-1 opacity-40" />;
  return sortDir === "asc"
    ? <ArrowUp className="w-3.5 h-3.5 ml-1" />
    : <ArrowDown className="w-3.5 h-3.5 ml-1" />;
}

function CustomerBalancesSection() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerBalance | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("balance");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 350);
  }, []);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["rewards-balances", debouncedSearch],
    queryFn: () => fetchBalances(debouncedSearch),
  });

  // Client-side sort applied on top of server data
  const sorted = [...customers].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "name") {
      cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    } else if (sortKey === "email") {
      cmp = a.email.localeCompare(b.email);
    } else if (sortKey === "phone") {
      cmp = (a.phone || "").localeCompare(b.phone || "");
    } else {
      cmp = a.balance - b.balance;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggleSort(col: SortKey) {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir(col === "balance" ? "desc" : "asc");
    }
  }

  function downloadFullCsv() {
    const headers = getAuthHeaders();
    if (!headers) { toast({ title: "Not authenticated", variant: "destructive" }); return; }
    fetch(`${base()}/api/uc/admin/rewards/ledger?export=1`, { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "rewards-ledger.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err: Error) => toast({ title: "Export failed", description: err.message, variant: "destructive" }));
  }

  const SortHead = ({ col, children, className }: { col: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={className}>
      <button
        className="flex items-center select-none hover:text-foreground transition-colors"
        onClick={() => toggleSort(col)}
      >
        {children}
        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
      </button>
    </TableHead>
  );

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="w-4 h-4" /> Customer Balances
            </h2>
            <p className="text-sm text-muted-foreground">
              All customers with their reward balance. Click a column header to sort; click a row to view the full ledger.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={downloadFullCsv}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export Full Ledger CSV
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead col="name">Customer</SortHead>
                <SortHead col="email">Email</SortHead>
                <SortHead col="phone">Phone</SortHead>
                <SortHead col="balance" className="text-right">Balance</SortHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                  </TableCell>
                </TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    {debouncedSearch ? "No customers match your search." : "No customers found."}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((c) => (
                  <TableRow
                    key={c.userId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedCustomer(c)}
                  >
                    <TableCell className="font-medium">
                      {c.firstName} {c.lastName}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.phone || "—"}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {Number(c.balance).toLocaleString()} pts
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <LedgerDrawer
        customer={selectedCustomer}
        open={selectedCustomer != null}
        onClose={() => setSelectedCustomer(null)}
      />
    </>
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
          Configure reward rules, manually award points, and monitor customer balances.
        </p>
      </div>

      {/* Customer Balances */}
      <CustomerBalancesSection />

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
