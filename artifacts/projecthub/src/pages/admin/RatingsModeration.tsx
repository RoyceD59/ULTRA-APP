import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";

export function RatingsModeration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["locationRatingReports"],
    queryFn: async () => {
      const res = await fetch(`${API_ORIGIN}/api/uc/admin/location-rating-reports`, { headers: getAuthHeaders() ?? {} });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ reports: any[] }>;
    },
  });

  const reports = data?.reports ?? [];

  const moderate = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "published" | "hidden" | "removed" }) => {
      const res = await fetch(`${API_ORIGIN}/api/uc/admin/location-ratings/${id}/moderation`, {
        method: "PATCH",
        headers: { ...(getAuthHeaders() ?? {}), "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Moderation applied" });
      queryClient.invalidateQueries({ queryKey: ["locationRatingReports"] });
    },
    onError: () => {
      toast({ title: "Failed to apply moderation", variant: "destructive" });
    }
  });

  if (isLoading) return <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading reports…</p>;
  if (isError) return <p className="text-sm text-destructive">Failed to load reports.</p>;
  if (reports.length === 0) return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No reports found.</div>;

  return (
    <div className="space-y-4">
      {reports.map((report) => (
        <div key={report.id} className="rounded-lg border p-4 bg-card flex flex-col sm:flex-row gap-4 justify-between items-start">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <h3 className="font-semibold text-sm">Reported Reason: {report.reason}</h3>
            </div>
            {report.detail && <p className="text-sm text-muted-foreground bg-muted p-2 rounded">{report.detail}</p>}
            <p className="text-xs text-muted-foreground">
              Rating ID: {report.ratingId} • Reporter User ID: {report.reporterUserId} • {new Date(report.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={moderate.isPending} onClick={() => moderate.mutate({ id: report.ratingId, status: "hidden" })}>
              Hide Rating
            </Button>
            <Button size="sm" variant="outline" disabled={moderate.isPending} onClick={() => moderate.mutate({ id: report.ratingId, status: "removed" })}>
              Remove Rating
            </Button>
            <Button size="sm" variant="outline" disabled={moderate.isPending} onClick={() => moderate.mutate({ id: report.ratingId, status: "published" })}>
              Resolve (Keep Published)
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}