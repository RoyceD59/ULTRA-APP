import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UcLocation } from "@workspace/api-client-react";
import { getAuthHeaders } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";

export function LocationAssessments({ locations }: { locations: UcLocation[] }) {
  const [selectedId, setSelectedId] = useState<string>(locations[0]?.id ?? "");

  if (!locations.length) return <p className="text-sm text-muted-foreground">No locations available to assess.</p>;

  return (
    <div className="grid md:grid-cols-[300px_1fr] gap-6 items-start">
      <div className="space-y-4 border rounded-lg p-2 bg-card">
        <h3 className="font-medium text-sm px-2 pt-2">Select Location</h3>
        <div className="flex flex-col gap-1 max-h-[600px] overflow-y-auto">
          {locations.map(loc => (
            <button
              key={loc.id}
              onClick={() => setSelectedId(loc.id)}
              className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${selectedId === loc.id ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted text-muted-foreground'}`}
            >
              {loc.name}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {selectedId && <AssessmentEditor locationId={selectedId} key={selectedId} />}
      </div>
    </div>
  );
}

function AssessmentEditor({ locationId }: { locationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["locationAssessment", locationId],
    queryFn: async () => {
      const res = await fetch(`${API_ORIGIN}/api/uc/admin/locations/${locationId}/assessment`, { headers: getAuthHeaders() ?? {} });
      if (!res.ok) throw new Error("Failed to fetch assessment");
      return res.json() as Promise<{ assessment: any | null }>;
    },
  });

  const [form, setForm] = useState({
    waterQuality: 5,
    cleanliness: 5,
    equipmentCondition: 5,
    serviceReliability: 5,
    safetyConfidence: 5,
    notes: "",
  });

  const [hasInit, setHasInit] = useState(false);
  if (data && !hasInit) {
    if (data.assessment) {
      setForm({
        waterQuality: data.assessment.waterQuality,
        cleanliness: data.assessment.cleanliness,
        equipmentCondition: data.assessment.equipmentCondition,
        serviceReliability: data.assessment.serviceReliability,
        safetyConfidence: data.assessment.safetyConfidence,
        notes: data.assessment.notes || "",
      });
    }
    setHasInit(true);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_ORIGIN}/api/uc/admin/locations/${locationId}/assessment`, {
        method: "PUT",
        headers: { ...(getAuthHeaders() ?? {}), "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, checks: {} })
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Assessment saved successfully" });
      queryClient.invalidateQueries({ queryKey: ["locationAssessment", locationId] });
    },
    onError: () => toast({ title: "Failed to save assessment", variant: "destructive" })
  });

  if (isLoading || !hasInit) return <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading assessment data…</p>;

  const update = (k: keyof typeof form, v: any) => setForm(s => ({ ...s, [k]: v }));

  return (
    <div className="rounded-lg border bg-card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Verified Assessment</h2>
        {data?.assessment?.verifiedAt && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-green-600" />
            Last verified: {new Date(data.assessment.verifiedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Official verified assessments establish the baseline quality for a location. These are structured checks,
        clearly separated from and not included in the consumer average.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        {["waterQuality", "cleanliness", "equipmentCondition", "serviceReliability", "safetyConfidence"].map(key => (
          <div key={key}>
            <Label className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</Label>
            <Select value={String((form as any)[key])} onValueChange={v => update(key as any, Number(v))}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map(n => <SelectItem key={n} value={String(n)}>{n} Stars</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label>Inspection Notes</Label>
        <Textarea
          placeholder="Official notes from the inspection..."
          value={form.notes}
          onChange={e => update("notes", e.target.value)}
          className="min-h-[100px]"
        />
      </div>

      <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
        Save Verified Assessment
      </Button>
    </div>
  );
}