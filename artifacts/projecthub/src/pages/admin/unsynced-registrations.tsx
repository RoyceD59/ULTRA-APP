/**
 * Admin reconciliation queue.  A contacted row is deliberately different
 * from a row recovered into the database: both remain visible for audit.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Check, CheckCircle2, Copy, Loader2, RefreshCw, UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders, isTeamAdmin } from "@/lib/team-auth";
import {
  clearResolvedRegistrations, getListUcCustomersQueryKey, getListUnsyncedRegistrationsQueryKey,
  recoverUnsyncedRegistration, useListUcCustomers, useListUnsyncedRegistrations,
  type UnsyncedRegistrationRecoveryInput, type UcCustomerSummary,
} from "@workspace/api-client-react";
import { API_ORIGIN } from "@/lib/api-base";

type RecordRow = {
  id?: number | null; firstName?: string; lastName?: string; email: string; phone: string;
  authProvider?: string; createdAt?: string; recordedAt: string; dbPersisted: boolean;
  recoveryStatus?: "pending" | "blocked" | "resolved" | "retryable";
  recoveryReason?: "email_conflict" | "phone_conflict" | "invalid_phone";
  recoveryAttempts?: number; followUpStatus?: "resolved"; resolvedAt?: string;
  targetAccountId?: number; resolvedBy?: string;
};

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function errorText(error: unknown) {
  const data = (error as { data?: { error?: string; code?: string } } | null)?.data;
  return data?.error ?? (error instanceof Error ? error.message : "The server could not complete this action.");
}

function TempPasswordDialog({ password, email, onClose }: { password: string; email: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Account recovered — temporary password</DialogTitle>
          <DialogDescription>
            A temporary password was generated for {email}. Copy it and send it securely.
            It is shown once and is not retained after this dialog closes.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
          <code data-testid="text-recovery-temporary-password" className="flex-1 font-mono select-all">{password}</code>
          <Button data-testid="button-copy-recovery-password" size="sm" variant="ghost" onClick={() => {
            void navigator.clipboard.writeText(password).then(() => setCopied(true));
          }}>{copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</Button>
        </div>
        <DialogFooter><Button data-testid="button-close-recovery-password" onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResolveDialog({ record, onClose, onRecovered }: {
  record: RecordRow; onClose: () => void; onRecovered: (password?: string) => void;
}) {
  const [email, setEmail] = useState(record.email);
  const [phone, setPhone] = useState(record.phone ?? "");
  const [targetSearch, setTargetSearch] = useState("");
  const [target, setTarget] = useState<{ type: "new" } | { type: "existing"; accountId: number }>({ type: "new" });
  const { toast } = useToast();
  const recovery = useMutation({
    mutationFn: async () => {
      const data: UnsyncedRegistrationRecoveryInput = {
        originalEmail: record.email,
        originalPhone: record.phone || undefined,
        correctedEmail: email.trim() || undefined,
        correctedPhone: phone.trim() || undefined,
        recordedAt: record.recordedAt,
        target,
      };
      return recoverUnsyncedRegistration(data) as unknown as Promise<{ tempPassword?: string }>;
    },
    onSuccess: (result) => {
      toast({ title: "Database recovery completed", description: "The registration is now linked and remains visible for audit." });
      onRecovered(result?.tempPassword);
    },
    onError: (error) => toast({ title: "Recovery could not be completed", description: errorText(error), variant: "destructive" }),
  });
  const customersQuery = useListUcCustomers(
    { q: targetSearch || undefined, page: 1, limit: 10 },
    { query: { enabled: targetSearch.trim().length > 1, queryKey: getListUcCustomersQueryKey({ q: targetSearch || undefined, page: 1, limit: 10 }) } },
  );
  const customers = customersQuery.data?.customers ?? [];
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !recovery.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve registration</DialogTitle>
          <DialogDescription>
            Correct the saved identity, preview conflicts, then explicitly link an existing account or create a new account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="recovery-email">Corrected email</Label><Input data-testid="input-recovery-email" id="recovery-email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label htmlFor="recovery-phone">Corrected phone</Label><Input data-testid="input-recovery-phone" id="recovery-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <Label>Target account</Label>
            <div className="flex gap-2">
              <Button type="button" data-testid="button-target-new-account" variant={target.type === "new" ? "default" : "outline"} onClick={() => setTarget({ type: "new" })}>Create new account</Button>
              <Button type="button" data-testid="button-target-existing-account" variant={target.type === "existing" ? "default" : "outline"} onClick={() => setTarget({ type: "existing", accountId: 0 })}>Link existing</Button>
            </div>
            {target.type === "existing" && <>
              <Input data-testid="input-recovery-account-search" placeholder="Search existing account…" value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} />
              <div className="max-h-32 overflow-y-auto rounded border">
                {customers.map((customer: UcCustomerSummary) => (
                  <button type="button" data-testid={`button-select-recovery-account-${customer.id}`} key={customer.id} className={`block w-full p-2 text-left text-sm hover:bg-muted ${target.accountId === customer.id ? "bg-muted" : ""}`} onClick={() => setTarget({ type: "existing", accountId: customer.id })}>
                    {customer.name || customer.email} <span className="text-muted-foreground">({customer.email})</span>
                  </button>
                ))}
                {targetSearch.length > 1 && !customersQuery.isLoading && customers.length === 0 && <p className="p-2 text-xs text-muted-foreground">No matching account.</p>}
              </div>
              {target.accountId > 0 && <p className="text-xs text-green-700">Selected account #{target.accountId}</p>}
            </>}
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <strong>Conflict preview:</strong> the server will normalize these values and fail closed if either belongs to a different account.
            <div className="mt-1">Email: {email || "—"} · Phone: {phone || "—"}</div>
          </div>
        </div>
        <DialogFooter>
          <Button data-testid="button-cancel-recovery" variant="ghost" onClick={onClose} disabled={recovery.isPending}>Cancel</Button>
          <Button data-testid="button-submit-recovery" onClick={() => recovery.mutate()} disabled={recovery.isPending || !email.trim() || (target.type === "existing" && target.accountId <= 0)}>
            {recovery.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Recovering…</> : "Confirm recovery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminUnsyncedRegistrationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [resolving, setResolving] = useState<RecordRow | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<{ email: string; password: string } | null>(null);
  const [contacting, setContacting] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const query = useListUnsyncedRegistrations();
  const records = (query.data?.records ?? []) as RecordRow[];
  const clearMutation = useMutation({
    mutationFn: () => clearResolvedRegistrations({ confirm: true }),
    onSuccess: (result) => {
      toast({ title: "Resolved logs cleared", description: `${result.cleared} record${result.cleared === 1 ? "" : "s"} cleared.` });
      void qc.invalidateQueries({ queryKey: getListUnsyncedRegistrationsQueryKey() });
      setClearing(false);
    },
    onError: (error) => { toast({ title: "Could not clear resolved logs", description: errorText(error), variant: "destructive" }); setClearing(false); },
  });
  async function markContacted(record: RecordRow) {
    setContacting(`${record.email}:${record.recordedAt}`);
    try {
      const response = await fetch(`${API_ORIGIN}/api/admin/unsynced-registrations/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ email: record.email, recordedAt: record.recordedAt }),
      });
      if (!response.ok) throw new Error(errorText(await response.json().catch(() => null)));
      toast({ title: "Marked contacted", description: "This is follow-up only; it did not claim database recovery." });
      void qc.invalidateQueries({ queryKey: getListUnsyncedRegistrationsQueryKey() });
    } catch (error) {
      toast({ title: "Could not mark contacted", description: errorText(error), variant: "destructive" });
    } finally { setContacting(null); }
  }
  if (!isTeamAdmin()) return <div className="p-6 text-muted-foreground">You don't have permission to view this page.</div>;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {resolving && <ResolveDialog record={resolving} onClose={() => setResolving(null)} onRecovered={(password) => {
        const email = resolving.email; setResolving(null);
        void qc.invalidateQueries({ queryKey: getListUnsyncedRegistrationsQueryKey() });
        if (password) setTemporaryPassword({ email, password });
      }} />}
      {temporaryPassword && <TempPasswordDialog email={temporaryPassword.email} password={temporaryPassword.password} onClose={() => setTemporaryPassword(null)} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Unsynced Registrations</h1><p className="mt-1 text-sm text-muted-foreground">Recover folder-only registrations safely, or record staff follow-up without confusing it with database recovery.</p></div>
        <div className="flex gap-2">
          <Button data-testid="button-refresh-unsynced" variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          <Button data-testid="button-clear-resolved-logs" variant="outline" size="sm" disabled={clearMutation.isPending} onClick={() => {
            if (window.confirm("Clear only database-persisted resolved logs? Unresolved and contacted-only records will remain.")) { setClearing(true); clearMutation.mutate(); }
          }}>{clearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Clear resolved logs</Button>
        </div>
      </div>
      {query.isLoading && <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading…</div>}
      {query.isError && <div role="alert" className="flex justify-center py-12 text-destructive"><AlertCircle className="mr-2 h-5 w-5" />Failed to load unsynced registrations.</div>}
      {!query.isLoading && !query.isError && records.length === 0 && <div className="flex flex-col items-center gap-3 py-16 text-center"><CheckCircle2 className="h-10 w-10 text-green-500" /><p className="text-lg font-medium">All registrations are synced</p></div>}
      {records.length > 0 && <div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Recovery</TableHead><TableHead>Recorded</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
        {records.map((record) => {
          const key = `${record.email}:${record.recordedAt}`;
          const resolved = record.recoveryStatus === "resolved";
          return <TableRow data-testid={`row-unsynced-registration-${record.id ?? key}`} key={key}>
            <TableCell className="font-medium">{record.firstName} {record.lastName}</TableCell><TableCell>{record.email}</TableCell><TableCell>{record.phone || "—"}</TableCell>
            <TableCell>{resolved ? <Badge className="border-green-600 text-green-700" variant="outline">Recovered</Badge> : record.recoveryStatus === "blocked" ? <Badge variant="destructive">Conflict</Badge> : <Badge variant="secondary">Pending</Badge>}{record.followUpStatus === "resolved" && <p className="mt-1 text-xs text-muted-foreground">Contacted</p>}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{formatDate(record.recordedAt)}</TableCell>
            <TableCell><div className="flex justify-end gap-2">
              {!resolved && <Button data-testid={`button-resolve-registration-${record.id ?? key}`} size="sm" onClick={() => setResolving(record)}><UserX className="mr-1 h-3.5 w-3.5" />Resolve</Button>}
              {!record.followUpStatus && <Button data-testid={`button-mark-contacted-${record.id ?? key}`} size="sm" variant="secondary" disabled={contacting === key} onClick={() => void markContacted(record)}>{contacting === key ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}Mark contacted</Button>}
              {resolved && <Badge variant="outline" className="text-green-700">Database persisted</Badge>}
            </div></TableCell>
          </TableRow>;
        })}
      </TableBody></Table><div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">{records.length} registration{records.length === 1 ? "" : "s"}</div></div>}
    </div>
  );
}