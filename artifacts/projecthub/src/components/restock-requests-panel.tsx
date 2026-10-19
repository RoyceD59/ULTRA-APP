import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useListUcRestockRequests, useUpdateUcRestockRequest, getListUcRestockRequestsQueryKey,
  type ListUcRestockRequestsStatus, type RestockStatusInputStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const FILTERS: Array<{ value: ListUcRestockRequestsStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "contacted", label: "Contacted" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

function errorText(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { status?: number; message?: string };
    if (e.status === 401 || e.status === 403) return "Your team session is not authorized to view prospect requests.";
    if (e.message) return e.message;
  }
  return "Request failed";
}

function StatusSelect({ id, status, params }: { id: number; status: string; params: { status: ListUcRestockRequestsStatus; page: number } }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const update = useUpdateUcRestockRequest();
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <select
          aria-label={`Status for request ${id}`}
          className="h-8 px-2 text-sm border rounded bg-background"
          value={status}
          disabled={update.isPending}
          onChange={(e) => {
            const next = e.target.value as RestockStatusInputStatus;
            setError("");
            update.mutate({ id, data: { status: next } }, {
              onSuccess: () => {
                toast({ title: "Request updated", description: `Marked ${next}.` });
                void qc.invalidateQueries({ queryKey: getListUcRestockRequestsQueryKey(params) });
                void qc.invalidateQueries({ queryKey: getListUcRestockRequestsQueryKey() });
              },
              onError: (err) => { const m = errorText(err); setError(m); toast({ title: "Update failed", description: m, variant: "destructive" }); },
            });
          }}
          data-testid={`select-restock-status-${id}`}
        >
          <option value="pending">Pending</option>
          <option value="contacted">Contacted</option>
          <option value="resolved">Resolved</option>
        </select>
        {update.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

/** Stock follow-up requests from guests and customers. Not orders, not revenue. */
export function RestockRequestsPanel() {
  const [status, setStatus] = useState<ListUcRestockRequestsStatus>("pending");
  const [page, setPage] = useState(1);
  const params = { status, page };
  const { data, isLoading, isFetching, error, refetch } = useListUcRestockRequests(params, {
    query: { queryKey: getListUcRestockRequestsQueryKey(params), staleTime: 15_000 },
  });
  const pageSize = data?.pageSize ?? 50;
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <section className="rounded-lg border bg-card overflow-hidden" data-testid="section-restock-requests">
      <div className="flex items-start justify-between gap-4 border-b px-4 py-4 flex-wrap">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BellRing className="w-4 h-4 text-muted-foreground" /> Restock requests
          </h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            People who asked to be contacted when a product returns. These are prospects, not checkout orders:
            no payment, no reserved stock and no revenue. Contact details are for follow-up only.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div role="group" aria-label="Filter by status" className="flex gap-1">
            {FILTERS.map(f => (
              <Button key={f.value} size="sm" variant={status === f.value ? "default" : "outline"} aria-pressed={status === f.value}
                onClick={() => { setStatus(f.value); setPage(1); }} data-testid={`filter-restock-${f.value}`}>{f.label}</Button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh restock requests">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map(i => <div key={i} className="h-8 rounded bg-muted animate-pulse" />)}</div>
      ) : error ? (
        <div className="px-4 py-6 text-sm text-destructive flex items-center gap-3" role="alert">
          Failed to load restock requests: {errorText(error)}
          <Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button>
        </div>
      ) : data ? (
        <>
          <div className="px-4 py-3 border-b">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Waiting demand by product option</h3>
            {data.demand.length === 0 ? <p className="text-sm text-muted-foreground">No pending demand.</p> : (
              <div className="flex flex-wrap gap-2">
                {data.demand.map(d => (
                  <div key={`${d.productCode}:${d.variantSku ?? ""}`} className="rounded-md border px-3 py-2 text-sm">
                    <span className="font-medium">{d.productName}</span>
                    {d.variantSku && <span className="ml-1 font-mono text-xs text-muted-foreground">{d.variantSku}</span>}
                    <span className="ml-2 font-semibold">{d.waitingCount}</span> waiting
                    <span className="ml-1 text-xs text-muted-foreground">({d.customerCount} customer, {d.guestCount} guest)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {data.requests.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground text-center">No {status === "all" ? "" : status} restock requests.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.requests.map(r => (
                  <TableRow key={r.id} data-testid={`row-restock-${r.id}`}>
                    <TableCell>
                      <span className="block font-medium max-w-[260px] truncate">{r.productName}</span>
                      <span className="text-xs text-muted-foreground font-mono">{r.variantSku ?? r.parentSku}</span>
                      {r.variantLabel && <span className="ml-1 text-xs text-muted-foreground">{r.variantLabel}</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.name || r.phone || r.location ? (
                        <>
                          <span className="block">{r.name ?? "Name removed"}</span>
                          {r.phone && <a className="block font-mono text-xs underline" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a>}
                          {r.location && <span className="block text-xs text-muted-foreground">{r.location}</span>}
                        </>
                      ) : <span className="text-xs text-muted-foreground">Contact details removed</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.kind === "customer" ? "secondary" : "outline"}>{r.kind === "customer" ? "Registered customer" : "Guest prospect"}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right"><StatusSelect id={r.id} status={r.status} params={params} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
            <span className="text-muted-foreground">{data.total} request{data.total === 1 ? "" : "s"} · page {data.page} of {pages}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1 || isFetching} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></Button>
              <Button size="sm" variant="outline" disabled={page >= pages || isFetching} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
