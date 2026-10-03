import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Droplets, RefreshCw, Download, MapPin, Phone,
  Search, X, Activity, CircleUser, FileText, Share
} from "lucide-react";
import { formatRelativeDate } from "@/components/shared/badges";
import {
  useListProjectHubInstantWaterAssessments,
  getListProjectHubInstantWaterAssessmentsQueryKey,
  useUpdateProjectHubInstantWaterAssessment,
  useGetProjectHubInstantWaterAssessment,
  getGetProjectHubInstantWaterAssessmentQueryKey,
  type ProjectHubInstantWaterSummary,
} from "@workspace/api-client-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  switch (status) {
    case "instant_result_ready": return "bg-sky-100 text-sky-800";
    case "follow_up_requested": return "bg-purple-100 text-purple-800";
    case "physical_test_requested": return "bg-orange-100 text-orange-800";
    case "scheduled": return "bg-blue-100 text-blue-800";
    case "completed": return "bg-emerald-100 text-emerald-800";
    case "closed": return "bg-slate-100 text-slate-800";
    default: return "bg-slate-100 text-slate-700";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "instant_result_ready": return "Instant Result Ready";
    case "follow_up_requested": return "Follow-up Requested";
    case "physical_test_requested": return "Physical Test Requested";
    case "scheduled": return "Scheduled";
    case "completed": return "Completed";
    case "closed": return "Closed";
    default: return status.replace(/_/g, " ");
  }
}

// ─── Detail Sheet ────────────────────────────────────────────────────────────

function AssessmentDetailSheet({
  assessmentId,
  open,
  onClose,
  onUpdated
}: {
  assessmentId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated: (detail: any) => void;
}) {
  const { data: detail, isLoading, refetch } = useGetProjectHubInstantWaterAssessment(
    assessmentId || "",
    { query: { enabled: open && !!assessmentId, queryKey: getGetProjectHubInstantWaterAssessmentQueryKey(assessmentId || "") } }
  );

  const { toast } = useToast();

  const updateMutation = useUpdateProjectHubInstantWaterAssessment();
  const [internalNote, setInternalNote] = useState("");

  if (!open) return null;

  const handleStatusChange = (newStatus: any) => {
    if (!assessmentId || !detail?.updatedAt) return;
    updateMutation.mutate({
      assessmentId,
      data: {
        serviceState: newStatus,
        internalNote: internalNote || undefined,
        expectedUpdatedAt: detail.updatedAt,
      }
    }, {
      onSuccess: (updatedDetail) => {
        onUpdated(updatedDetail);
      },
      onError: (err: any) => {
        if (err?.response?.status === 409) {
          toast({ title: "Update conflict", description: "This ticket was modified by someone else. Refreshing...", variant: "destructive" });
          refetch();
        } else {
          toast({ title: "Update failed", description: "Failed to update status.", variant: "destructive" });
        }
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {isLoading || !detail ? (
          <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading ticket...
          </div>
        ) : (
          <>
            <SheetHeader className="pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <SheetTitle className="flex items-center gap-2">
                    <Droplets className="w-5 h-5 text-blue-500" />
                    {detail.reference}
                  </SheetTitle>
                  <SheetDescription className="text-xs mt-1">
                    {detail.firstName || "Unknown Lead"} · {formatRelativeDate(detail.createdAt || "")}
                  </SheetDescription>
                </div>
                <Badge className={statusColor(detail.serviceState)}>{statusLabel(detail.serviceState)}</Badge>
              </div>
            </SheetHeader>

            <div className="space-y-6">
              {/* Customer Info */}
              <section className="space-y-2 pb-4 border-b">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Customer Info</h3>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CircleUser className="w-4 h-4 text-muted-foreground" />
                    <span>{detail.firstName || "Not provided"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span>{detail.phone || detail.maskedPhone || "Not provided"}</span>
                  </div>
                  <div className="flex items-center gap-2 col-span-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span>{detail.area}, {detail.country}</span>
                  </div>
                </div>
                <div className="mt-2 text-xs">
                  Account link: <Badge variant="outline">{detail.accountLinkState.replace(/_/g, " ")}</Badge>
                </div>
              </section>

              {/* Instant Result */}
              <section className="space-y-3 pb-4 border-b">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Instant Check Results
                </h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Sources: <span className="font-medium">{detail.answers?.sources?.join(", ") ?? detail.source}</span></div>
                  <div>Concerns: <span className="font-medium">{detail.answers?.concerns?.join(", ") ?? detail.concern}</span></div>
                  <div>Settings: <span className="font-medium">{detail.answers?.settings?.join(", ") ?? detail.answers?.setting}</span></div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="bg-muted/50 p-2 rounded">
                    <div className="text-xs text-muted-foreground">Hardness</div>
                    <div className="font-medium text-sm">{detail.bands.hardness}</div>
                  </div>
                  <div className="bg-muted/50 p-2 rounded">
                    <div className="text-xs text-muted-foreground">Taste</div>
                    <div className="font-medium text-sm">{detail.bands.taste}</div>
                  </div>
                  <div className="bg-muted/50 p-2 rounded">
                    <div className="text-xs text-muted-foreground">Sediment</div>
                    <div className="font-medium text-sm">{detail.bands.sediment}</div>
                  </div>
                  <div className="bg-muted/50 p-2 rounded">
                    <div className="text-xs text-muted-foreground">Microbial</div>
                    <div className="font-medium text-sm">{detail.bands.microbial}</div>
                  </div>
                </div>
              </section>

              {/* Physical Test Info */}
              {(detail.serviceAddress || detail.preferredContactTime) && (
                <section className="space-y-2 pb-4 border-b">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Physical Test Request</h3>
                  <div className="text-sm space-y-1">
                    <div><span className="text-muted-foreground">Service Address:</span> {detail.serviceAddress}</div>
                    <div><span className="text-muted-foreground">Preferred Time:</span> {detail.preferredContactTime}</div>
                  </div>
                </section>
              )}

              {/* Actions */}
              <section className="space-y-3 pt-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Update Status</h3>

                <div className="space-y-2">
                  <Label htmlFor="internalNote">Add an internal note (optional)</Label>
                  <Input
                    id="internalNote"
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                    placeholder="E.g., Spoke with customer, technician scheduled..."
                  />
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  {["follow_up_requested", "physical_test_requested", "scheduled", "completed", "closed"].map((s) => (
                    <Button
                      key={s}
                      variant={detail.serviceState === s ? "default" : "outline"}
                      size="sm"
                      disabled={detail.serviceState === s || updateMutation.isPending}
                      onClick={() => handleStatusChange(s)}
                    >
                      {statusLabel(s)}
                    </Button>
                  ))}
                </div>

              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Water Tests list ──────────────────────────────────────────────────────────

const STATUSES = ["all", "instant_result_ready", "follow_up_requested", "physical_test_requested", "scheduled", "completed", "closed"] as const;

export default function WaterTestsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(null);

  const listParams = {
    page,
    limit: 50,
    ...(statusFilter !== "all" ? { status: statusFilter } : {})
  };

  const { data, isLoading, isError, refetch, isFetching } = useListProjectHubInstantWaterAssessments(
    listParams,
    { query: { queryKey: getListProjectHubInstantWaterAssessmentsQueryKey(listParams) } }
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Droplets className="w-6 h-6" />
            Water Test Queue
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Instant check leads and physical test requests.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="min-h-11" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters row */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map(s => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              className="min-h-11 sm:min-h-8 text-xs"
              onClick={() => { setStatusFilter(s); setPage(1); }}
            >
              {statusLabel(s)}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading water tests…</div>
      ) : isError ? (
        <div className="text-destructive text-sm py-12 text-center">
          Failed to load water tests. Please refresh.
        </div>
      ) : data?.items.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center bg-card rounded-xl border border-border">
          {statusFilter !== "all" ? `No ${statusLabel(statusFilter).toLowerCase()} water tests found.` : "No water tests found."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data?.items.map((t: ProjectHubInstantWaterSummary) => (
            <Card
              key={t.assessmentId}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => setSelectedAssessmentId(t.assessmentId)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm leading-snug line-clamp-1">
                      {t.reference}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t.firstName || "Unknown Lead"} · {formatRelativeDate(t.createdAt || "")}
                    </p>
                  </div>
                  <Badge className={`${statusColor(t.serviceState)} border-0 shrink-0 text-[10px]`}>
                    {statusLabel(t.serviceState)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />{t.area}, {t.country}
                  </span>
                  {t.maskedPhone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" />{t.maskedPhone}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1 text-[11px] bg-muted/30 p-2 rounded-lg mt-2 border">
                  <div>Hardness: <span className="font-medium text-foreground">{t.bands.hardness}</span></div>
                  <div>Microbial: <span className="font-medium text-foreground">{t.bands.microbial}</span></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AssessmentDetailSheet
        assessmentId={selectedAssessmentId}
        open={!!selectedAssessmentId}
        onClose={() => setSelectedAssessmentId(null)}
        onUpdated={(updatedDetail: any) => {
          const listQueryKey = getListProjectHubInstantWaterAssessmentsQueryKey(listParams);
          queryClient.cancelQueries({ queryKey: listQueryKey });

          queryClient.setQueryData(listQueryKey, (old: any) => {
            if (!old) return old;
            return {
              ...old,
              items: old.items.map((item: any) =>
                item.assessmentId === updatedDetail.assessmentId
                  ? { ...item, serviceState: updatedDetail.serviceState, updatedAt: updatedDetail.updatedAt }
                  : item
              )
            };
          });

          queryClient.setQueryData(getGetProjectHubInstantWaterAssessmentQueryKey(updatedDetail.assessmentId), updatedDetail);
        }}
      />
    </div>
  );
}
