/** Customer filter assignments: staff-recorded ownership, saved pending until explicitly linked. */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AssignmentAudit } from "@/components/assignment-audit";
import { invalidateAssignmentQueries } from "@/lib/assignment-queries";
import {
  confirmCustomerAssignmentLink, createCustomerAssignment, getListCustomerAssignmentsQueryKey,
  getListUcCustomersQueryKey, getFindAssignmentOrderLinesQueryKey, previewCustomerAssignment,
  retryCustomerAssignment, useFindAssignmentOrderLines, useListCustomerAssignments,
  useListUcCustomers,
  type AssignmentOrderLine, type CustomerAssignmentInput, type CustomerFilterAssignment,
  type PreviewCustomerAssignment200, type UcCustomerSummary, type ListCustomerAssignmentsStatus,
} from "@workspace/api-client-react";

function errText(error: unknown) {
  const data = (error as { data?: { error?: string } } | null)?.data;
  if (data?.error) return data.error;
  if (error instanceof TypeError) return "Network error — check your connection and retry.";
  return error instanceof Error ? error.message : "The server could not complete this action.";
}
const collectionLabel: Record<string, string> = { collected: "Cash collected", awaiting_collection: "Awaiting collection", unknown: "Collection unknown" };

function CustomerPicker({ id, onPick, testid }: { id: string; onPick: (c: UcCustomerSummary) => void; testid: string }) {
  const [q, setQ] = useState("");
  const enabled = q.trim().length > 1;
  const params = { q: q || undefined, page: 1, limit: 8 };
  const query = useListUcCustomers(params, { query: { enabled, queryKey: getListUcCustomersQueryKey(params) } });
  const list = query.data?.customers ?? [];
  return (
    <div className="space-y-1">
      <Input id={id} data-testid={testid} aria-label="Search customers" placeholder="Search customers by name, email or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      {enabled && (
        <div className="max-h-32 overflow-y-auto rounded border text-sm" role="listbox" aria-label="Customer results">
          {query.isLoading && <p className="p-2 text-xs text-muted-foreground">Searching…</p>}
          {query.isError && <p role="alert" className="p-2 text-xs text-destructive">Search failed. Try again.</p>}
          {list.map((c) => (
            <button type="button" role="option" aria-selected={false} key={c.id} data-testid={`button-pick-customer-${testid}-${c.id}`} className="block w-full p-2 text-left hover:bg-muted" onClick={() => { onPick(c); setQ(""); }}>
              {c.name || c.email} <span className="text-muted-foreground">({c.email}{c.phone ? ` · ${c.phone}` : ""})</span>
            </button>
          ))}
          {!query.isLoading && !query.isError && list.length === 0 && <p className="p-2 text-xs text-muted-foreground">No matching customer.</p>}
        </div>
      )}
    </div>
  );
}

function newKey() { return crypto.randomUUID(); }

function AssignmentDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [account, setAccount] = useState<UcCustomerSummary | null>(null);
  const [linkNow, setLinkNow] = useState(false);
  const [orderQ, setOrderQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [line, setLine] = useState<AssignmentOrderLine | null>(null);
  const [date, setDate] = useState("");
  const [previewed, setPreviewed] = useState<{ sig: string; data: PreviewCustomerAssignment200 } | null>(null);
  const [created, setCreated] = useState<{ id: number } | null>(null);
  const [error, setError] = useState("");
  const keyRef = useRef<{ sig: string; key: string } | null>(null);

  const linesParams = { q: submittedQ };
  const lines = useFindAssignmentOrderLines(linesParams, { query: { enabled: submittedQ.length > 0, queryKey: getFindAssignmentOrderLinesQueryKey(linesParams) } });

  const targetAccountId = linkNow && account ? account.id : undefined;
  const base = { customerName: name.trim(), email: email.trim(), phone: phone.trim(), productId: line?.productId ?? 0, installationDate: date, orderId: line?.orderId ?? 0, orderItemId: line?.orderItemId ?? 0, targetAccountId };
  const sig = JSON.stringify(base);
  const ready = !!line && !!name.trim() && !!email.trim() && !!phone.trim() && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const previewValid = previewed?.sig === sig;
  // Same payload -> same key (safe exact retry); any change -> fresh key.
  function payload(): CustomerAssignmentInput {
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: newKey() };
    return { ...base, idempotencyKey: keyRef.current.key };
  }

  const preview = useMutation({
    mutationFn: (input: CustomerAssignmentInput) => previewCustomerAssignment(input),
    onSuccess: (data, input) => { const s = JSON.stringify({ ...input, idempotencyKey: undefined }); setPreviewed({ sig: s, data }); setError(""); },
    onError: (e) => { setPreviewed(null); setError(errText(e)); },
  });
  const create = useMutation({
    mutationFn: (input: CustomerAssignmentInput) => createCustomerAssignment(input),
    onSuccess: (res) => {
      void invalidateAssignmentQueries(qc);
      setError("");
      if (targetAccountId) setCreated(res);
      else { toast({ title: "Assignment saved as pending", description: "Ownership is not linked until staff confirm an account." }); onClose(); }
    },
    onError: (e) => setError(errText(e)),
  });
  const link = useMutation({
    mutationFn: (id: number) => confirmCustomerAssignmentLink(id, { accountId: targetAccountId!, confirm: true }),
    onSuccess: (result) => {
      void invalidateAssignmentQueries(qc);
      if (result.status !== "linked") { setError(`Assignment remains ${result.status}: ${result.reviewReason?.replaceAll("_", " ") ?? "staff review required"}.`); return; }
      toast({ title: "Filter linked", description: `Ownership confirmed for account #${targetAccountId}.` });
      onClose();
    },
    onError: (e) => setError(errText(e)),
  });
  const busy = preview.isPending || create.isPending || link.isPending;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New customer assignment</DialogTitle>
          <DialogDescription>Record who owns a filter from an existing ledger order line. Saving creates a pending row only.</DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-3" data-testid="panel-confirm-ownership">
            <div className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Confirm ownership.</strong> Assignment #{created.id} is saved as pending. Linking gives account #{account?.id} ({account?.email}) ownership of this filter. This is a separate staff decision.
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" data-testid="button-skip-link" disabled={link.isPending} onClick={onClose}>Leave pending</Button>
              <Button data-testid="button-confirm-ownership" disabled={link.isPending} onClick={() => link.mutate(created.id)}>
                {link.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Linking…</> : "Confirm and link account"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="assign-customer-search">Existing customer (optional)</Label>
              <CustomerPicker id="assign-customer-search" testid="assignment-customer" onPick={(c) => { setAccount(c); setName(c.name || `${c.firstName} ${c.lastName}`.trim()); setEmail(c.email); setPhone(c.phone ?? ""); }} />
              {account && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">Selected account #{account.id}: {account.name || account.email}
                  <button type="button" className="underline" data-testid="button-clear-assignment-customer" onClick={() => { setAccount(null); setLinkNow(false); }}>clear</button>
                </p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><Label htmlFor="assign-name">Name{account ? " (from account)" : ""}</Label><Input id="assign-name" data-testid="input-assignment-name" value={name} readOnly={!!account} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label htmlFor="assign-email">Email</Label><Input id="assign-email" data-testid="input-assignment-email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div><Label htmlFor="assign-phone">Phone</Label><Input id="assign-phone" data-testid="input-assignment-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assign-order">Source order (local or Woo number)</Label>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setLine(null); setSubmittedQ(orderQ.trim()); }}>
                <Input id="assign-order" data-testid="input-assignment-order" value={orderQ} onChange={(e) => setOrderQ(e.target.value)} placeholder="e.g. 1042" />
                <Button type="submit" variant="outline" data-testid="button-find-order-lines" disabled={!orderQ.trim() || lines.isFetching}>{lines.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}</Button>
              </form>
              <p className="text-xs text-muted-foreground">Enter a local order number, or woo:123 for an existing WooCommerce COD sale. A Woo lookup saves an exact local purchase snapshot only; cash collection is not inferred from order status.</p>
              {submittedQ && lines.isError && <p role="alert" className="text-xs text-destructive">{errText(lines.error)}</p>}
              {submittedQ && !lines.isFetching && !lines.isError && (lines.data ?? []).length === 0 && <p className="text-xs text-muted-foreground" data-testid="text-no-order-lines">No eligible purchase lines found for “{submittedQ}”.</p>}
              <div className="space-y-1">
                {(lines.data ?? []).map((l) => {
                  const taken = l.assignmentId != null;
                  const sel = line?.orderItemId === l.orderItemId;
                  return (
                    <button type="button" key={l.orderItemId} disabled={taken} aria-pressed={sel} data-testid={`button-select-order-line-${l.orderItemId}`} onClick={() => setLine(l)}
                      className={`block w-full rounded border p-2 text-left text-xs ${sel ? "border-primary bg-primary/5" : "hover:bg-muted"} ${taken ? "opacity-50" : ""}`}>
                      <span className="font-medium text-sm">{l.name}</span> × {l.quantity} · {l.ownerReference}
                      <span className="block text-muted-foreground">Order #{l.orderId}{l.wooOrderId ? ` · Woo #${l.wooOrderId}` : ""} · {l.status} · {collectionLabel[l.cashCollectionState ?? "unknown"] ?? "Collection unknown"}{taken ? ` · already assigned (#${l.assignmentId})` : ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="assign-date">Installation date</Label><Input id="assign-date" type="date" data-testid="input-assignment-date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <label className={`flex items-end gap-2 pb-2 text-sm ${account ? "" : "opacity-50"}`}>
                <input type="checkbox" data-testid="checkbox-link-account" disabled={!account} checked={linkNow} onChange={(e) => setLinkNow(e.target.checked)} />
                Target this account for linking
              </label>
            </div>
            <div className="rounded-md border bg-muted/30 p-3 text-xs" aria-live="polite" data-testid="panel-assignment-preview">
              {preview.isPending ? "Validating with server…" : previewValid && previewed ? (
                <span><strong>Server validated:</strong> {previewed.data.productName} · {previewed.data.lifespanDays} days · {previewed.data.capacityLitres} L · {collectionLabel[previewed.data.cashCollectionState] ?? "Collection unknown"}. Saving records this as <strong>pending</strong>; it does not link ownership.</span>
              ) : previewed ? "Inputs changed — preview again before saving." : "Preview to validate contacts, source, ownership and catalogue."}
            </div>
            {error && <p role="alert" data-testid="status-assignment-error" className="flex items-center gap-1 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}</p>}
            <DialogFooter>
              <Button variant="ghost" data-testid="button-cancel-assignment" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant="outline" data-testid="button-preview-assignment" disabled={!ready || busy} onClick={() => { const p = payload(); preview.mutate(p); }}>Preview</Button>
              <Button data-testid="button-save-assignment" disabled={!ready || !previewValid || busy} onClick={() => create.mutate(payload())}>
                {create.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save pending"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ row, onClose }: { row: CustomerFilterAssignment; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [account, setAccount] = useState<UcCustomerSummary | null>(null);
  const [error, setError] = useState("");
  const link = useMutation({
    mutationFn: () => confirmCustomerAssignmentLink(row.id, { accountId: account!.id, confirm: true }),
    onSuccess: (result) => { void invalidateAssignmentQueries(qc); if (result.status !== "linked") { setError(`Assignment remains ${result.status}: ${result.reviewReason?.replaceAll("_", " ") ?? "staff review required"}.`); return; } toast({ title: "Filter linked", description: `Account #${account!.id} now owns this filter.` }); onClose(); },
    onError: (e) => setError(errText(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !link.isPending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link assignment #{row.id}</DialogTitle>
          <DialogDescription>{row.customerName} · {row.productName} · {row.orderReference}. Choose the account that will own this filter.</DialogDescription>
        </DialogHeader>
        <CustomerPicker id={`link-search-${row.id}`} testid={`link-${row.id}`} onPick={setAccount} />
        {row.targetAccountId ? <p className="text-xs text-muted-foreground">Previously targeted: account #{row.targetAccountId}</p> : null}
        {account && <p className="rounded border border-amber-500/50 bg-amber-50 p-2 text-xs text-amber-900" data-testid="text-link-selected">Confirm: account #{account.id} ({account.email}) will own this filter.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={link.isPending}>Cancel</Button>
          <Button data-testid={`button-confirm-link-${row.id}`} disabled={!account || link.isPending} onClick={() => link.mutate()}>
            {link.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Linking…</> : "Confirm and link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomerAssignmentsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState<CustomerFilterAssignment | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ListCustomerAssignmentsStatus | "">("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const params = { page, limit: 25, status: status || undefined, q: q || undefined };
  const query = useListCustomerAssignments(params, { query: { queryKey: getListCustomerAssignmentsQueryKey(params), refetchInterval: 30000 } });
  const rows = query.data?.items ?? [];
  const retry = useMutation({
    mutationFn: (id: number) => retryCustomerAssignment(id),
    onSuccess: () => { toast({ title: "Retry submitted" }); void invalidateAssignmentQueries(qc); },
    onError: (e) => toast({ title: "Retry failed", description: errText(e), variant: "destructive" }),
  });
  return (
    <section className="space-y-3" aria-labelledby="customer-assignments-heading" data-testid="section-customer-assignments">
      {creating && <AssignmentDialog onClose={() => setCreating(false)} />}
      {linking && <LinkDialog row={linking} onClose={() => setLinking(null)} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="customer-assignments-heading" className="text-lg font-semibold">Customer Assignments</h2>
          <p className="text-sm text-muted-foreground">Filter ownership recorded from ledger order lines. Pending rows are not owned by any account until linked.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" data-testid="button-refresh-assignments" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
          <Button size="sm" data-testid="button-new-assignment" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />New assignment</Button>
        </div>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setQ(search.trim()); setPage(1); setOpen(null); }}>
        <Input className="max-w-sm" aria-label="Search assignment contacts" placeholder="Search name, email or phone" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} />
        <select className="rounded-md border bg-background px-3 text-sm" aria-label="Assignment status" value={status} onChange={e => { setStatus(e.target.value as ListCustomerAssignmentsStatus | ""); setPage(1); setOpen(null); }}>
          <option value="">All statuses</option><option value="pending">Pending</option><option value="linked">Linked</option><option value="review">Review</option>
        </select>
        <Button type="submit" variant="outline">Search</Button>
        {(q || status || search) && <Button type="button" variant="ghost" onClick={() => { setSearch(""); setQ(""); setStatus(""); setPage(1); setOpen(null); }}>Clear filters</Button>}
      </form>
      {query.isLoading && <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>}
      {query.isError && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />{errText(query.error)}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
        </div>
      )}
      {!query.isLoading && !query.isError && rows.length === 0 && <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="empty-assignments">{q || status ? "No assignments match these filters." : page > 1 ? "No assignments on this page. Go back to an earlier page." : "No customer assignments yet. Create one from an existing order line."}</div>}
      {rows.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} data-testid={`row-assignment-${r.id}`} className="p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{r.customerName} <span className="font-normal text-muted-foreground">· {r.productName}</span></p>
                  <p className="text-xs text-muted-foreground">{r.email} · {r.phone} · {r.orderReference} · installed {r.installationDate}</p>
                  <p className="text-xs text-muted-foreground">
                    {collectionLabel[r.cashCollectionState] ?? "Collection unknown"}
                    {r.linkedAccountId ? ` · owner: account #${r.linkedAccountId}` : r.targetAccountId ? ` · targeted account #${r.targetAccountId} (not confirmed)` : " · no owner linked"}
                  </p>
                  {r.reviewReason && <p role="status" className={`mt-1 text-xs ${r.status === "review" ? "text-destructive" : "text-muted-foreground"}`}>{r.status === "review" ? "Needs review" : "Pending reason"}: {r.reviewReason.replaceAll("_", " ")}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {r.status === "linked" ? <Badge variant="outline" className="border-green-600 text-green-700">Linked</Badge> : r.status === "review" ? <Badge variant="destructive">Review</Badge> : <Badge variant="secondary">Pending</Badge>}
                  {r.status !== "linked" && <Button size="sm" data-testid={`button-link-assignment-${r.id}`} onClick={() => setLinking(r)}>Link</Button>}
                  {r.status !== "linked" && <Button size="sm" variant="secondary" data-testid={`button-retry-assignment-${r.id}`} disabled={retry.isPending && retry.variables === r.id} onClick={() => retry.mutate(r.id)}>{retry.isPending && retry.variables === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Retry"}</Button>}
                </div>
              </div>
              <button type="button" className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={open === r.id} data-testid={`button-toggle-audit-${r.id}`} onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}Audit history
              </button>
              {open === r.id && <AssignmentAudit key={r.id} assignmentId={r.id} />}
            </li>
          ))}
        </ul>
      )}
      {query.data && <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Button size="sm" variant="outline" disabled={page === 1 || query.isFetching} onClick={() => { setPage(p => p - 1); setOpen(null); }}>Previous</Button>
        <span>Page {page} · {query.data.total} matching assignments</span>
        <Button size="sm" variant="outline" disabled={page * params.limit >= query.data.total || query.isFetching} onClick={() => { setPage(p => p + 1); setOpen(null); }}>Next</Button>
      </div>}
    </section>
  );
}
