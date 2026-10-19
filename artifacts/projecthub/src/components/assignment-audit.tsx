import { useState } from "react";
import { useListCustomerAssignmentAudit, getListCustomerAssignmentAuditQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

/** Mounted only while expanded; queue reads never include historical events. */
export function AssignmentAudit({ assignmentId }: { assignmentId: number }) {
  const [page, setPage] = useState(1);
  const params = { page, limit: 25 };
  const query = useListCustomerAssignmentAudit(assignmentId, params, {
    query: { queryKey: getListCustomerAssignmentAuditQueryKey(assignmentId, params), refetchInterval: 30000 },
  });
  return (
    <div className="mt-2 space-y-2 border-l pl-3 text-xs text-muted-foreground" aria-label={`Audit history for assignment ${assignmentId}`}>
      {query.isLoading && <p aria-busy="true">Loading audit history…</p>}
      {query.isError && <div role="alert">Audit history could not be loaded. <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>}
      {query.data && <>
        {query.data.items.length === 0 && <p>No audit entries on this page.</p>}
        <ul className="space-y-1">
          {query.data.items.map((entry) => <li key={entry.id}>
            {new Date(entry.createdAt).toLocaleString()} · {entry.action} · {entry.actor}
            {Object.keys(entry.details).length > 0 && <pre className="whitespace-pre-wrap break-words">{JSON.stringify(entry.details, null, 2)}</pre>}
          </li>)}
        </ul>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page === 1 || query.isFetching} onClick={() => setPage(p => p - 1)}>Previous audit page</Button>
          <span>Page {page} · {query.data.total} events</span>
          <Button size="sm" variant="outline" disabled={page * params.limit >= query.data.total || query.isFetching} onClick={() => setPage(p => p + 1)}>Next audit page</Button>
        </div>
      </>}
    </div>
  );
}