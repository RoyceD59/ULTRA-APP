import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, MapPin, Pencil, Plus, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/team-auth";
import { API_ORIGIN } from "@/lib/api-base";
import {
  createUcAdminLocation, getListUcAdminLocationsQueryKey, listUcAdminLocations,
  updateUcAdminLocation, useListUcAdminLocations,
  type UcLocation, type UcLocationInput, type UcLocationInputType,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RatingsModeration } from "./RatingsModeration";
import { LocationAssessments } from "./LocationAssessments";

// Field-review dates follow the business calendar, matching scheduled alerts,
// regardless of the staff member's browser timezone.
const FIELD_REVIEW_TIME_ZONE = "Africa/Nairobi";
const fieldReviewDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: FIELD_REVIEW_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
});

type Form = {
  name: string; type: UcLocationInputType; address: string; hours: string;
  phone: string; vendorName: string; latitude: string; longitude: string;
  countryIso: string; city: string; accessNotes: string; municipal: string; sourceAttribution: string;
  lastFieldVerifiedOn: string; nextReviewOn: string;
};
const blank: Form = { name: "", type: "experience_centre", address: "", hours: "", phone: "", vendorName: "", latitude: "", longitude: "", countryIso: "", city: "", accessNotes: "", municipal: "", sourceAttribution: "", lastFieldVerifiedOn: "", nextReviewOn: "" };
function toForm(location: UcLocation): Form {
  return {
    name: location.name, type: location.type, address: location.address, hours: location.hours,
    phone: location.phone ?? "", vendorName: location.vendorName ?? "",
    latitude: String(location.lat), longitude: String(location.lng),
    countryIso: location.countryIso ?? "", city: location.city ?? "", accessNotes: location.accessNotes ?? "",
    municipal: location.municipal ?? "", sourceAttribution: location.sourceAttribution ?? "",
    lastFieldVerifiedOn: location.lastFieldVerifiedOn ?? "", nextReviewOn: location.nextReviewOn ?? ""
  };
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "The location could not be updated."; }

function LocationForm({ location, done }: { location?: UcLocation; done: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(location ? toForm(location) : blank);
  useEffect(() => setForm(location ? toForm(location) : blank), [location]);
  const update = (key: keyof Form, value: string) => setForm((old) => ({ ...old, [key]: value }));
  const latitude = Number(form.latitude); const longitude = Number(form.longitude);
  const coordinatesValid = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const mutation = useMutation({
    mutationFn: () => {
      const data: UcLocationInput = {
        name: form.name.trim(), type: form.type, address: form.address.trim(), hours: form.hours.trim(),
        phone: form.phone.trim() || null, vendorName: form.type === "vendor" ? form.vendorName.trim() : null,
        latitude, longitude,
        countryIso: form.type === "city_tap" ? form.countryIso.trim() : undefined,
        city: form.type === "city_tap" ? (form.city.trim() || null) : null,
        accessNotes: form.type === "city_tap" ? (form.accessNotes.trim() || null) : null,
        municipal: form.type === "city_tap" ? (form.municipal.trim() || null) : null,
        sourceAttribution: form.type === "city_tap" ? (form.sourceAttribution.trim() || null) : null,
        lastFieldVerifiedOn: form.lastFieldVerifiedOn || null,
        nextReviewOn: form.nextReviewOn || null
      };
      return location ? updateUcAdminLocation(location.id, data) : createUcAdminLocation(data);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListUcAdminLocationsQueryKey() }); toast({ title: location ? "Location updated" : "Location created" }); done(); },
    onError: (error) => toast({ title: "Location could not be saved", description: errorMessage(error), variant: "destructive" }),
  });
  return <form className="space-y-4 rounded-lg border bg-card p-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
    <div className="grid gap-3 sm:grid-cols-2">
      <div><Label htmlFor="location-name">Name</Label><Input data-testid="input-location-name" id="location-name" value={form.name} onChange={(e) => update("name", e.target.value)} /></div>
      <div><Label>Type</Label><Select value={form.type} onValueChange={(value) => update("type", value)}><SelectTrigger data-testid="select-location-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="experience_centre">Experience centre</SelectItem><SelectItem value="refill_atm">Refill ATM</SelectItem><SelectItem value="vendor">Verified vendor</SelectItem><SelectItem value="water_atm">Water ATM</SelectItem><SelectItem value="refill_station">Refill Station</SelectItem><SelectItem value="city_tap">City Tap</SelectItem></SelectContent></Select></div>
      <div><Label htmlFor="location-address">Address</Label><Input id="location-address" value={form.address} onChange={(e) => update("address", e.target.value)} /></div>
      <div><Label htmlFor="location-hours">Hours</Label><Input id="location-hours" value={form.hours} onChange={(e) => update("hours", e.target.value)} /></div>
      <div><Label htmlFor="location-phone">Phone</Label><Input id="location-phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} /></div>
      {form.type === "vendor" && <div><Label htmlFor="location-vendor">Vendor name</Label><Input id="location-vendor" value={form.vendorName} onChange={(e) => update("vendorName", e.target.value)} /></div>}
      <div><Label htmlFor="location-lat">Latitude</Label><Input id="location-lat" value={form.latitude} onChange={(e) => update("latitude", e.target.value)} /></div>
      <div><Label htmlFor="location-lng">Longitude</Label><Input id="location-lng" value={form.longitude} onChange={(e) => update("longitude", e.target.value)} /></div>
      <div><Label htmlFor="location-field-verified">Latest field verification</Label><Input id="location-field-verified" type="date" value={form.lastFieldVerifiedOn} onChange={(e) => update("lastFieldVerifiedOn", e.target.value)} /></div>
      <div><Label htmlFor="location-next-review">Next review (optional)</Label><Input id="location-next-review" type="date" min={form.lastFieldVerifiedOn || undefined} value={form.nextReviewOn} onChange={(e) => update("nextReviewOn", e.target.value)} /></div>

      {form.type === "city_tap" && (
        <>
          <div><Label htmlFor="location-country">Country ISO (Required)</Label><Input id="location-country" placeholder="e.g. KE" value={form.countryIso} onChange={(e) => update("countryIso", e.target.value)} /></div>
          <div><Label htmlFor="location-city">City</Label><Input id="location-city" value={form.city} onChange={(e) => update("city", e.target.value)} /></div>
          <div><Label htmlFor="location-accessNotes">Access Notes</Label><Input id="location-accessNotes" value={form.accessNotes} onChange={(e) => update("accessNotes", e.target.value)} /></div>
          <div><Label htmlFor="location-municipal">Municipal Info</Label><Input id="location-municipal" value={form.municipal} onChange={(e) => update("municipal", e.target.value)} /></div>
          <div><Label htmlFor="location-sourceAttr">Source Attribution</Label><Input id="location-sourceAttr" value={form.sourceAttribution} onChange={(e) => update("sourceAttribution", e.target.value)} /></div>
        </>
      )}
    </div>
    {!coordinatesValid && (form.latitude || form.longitude) && <p role="alert" className="text-xs text-destructive">Use valid coordinates.</p>}
    {form.lastFieldVerifiedOn && form.nextReviewOn && form.nextReviewOn < form.lastFieldVerifiedOn && <p role="alert" className="text-xs text-destructive">Next review cannot be earlier than the latest field verification.</p>}
    <p className="text-xs text-muted-foreground">New locations remain pending until verified.</p>
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={done}>Cancel</Button><Button data-testid="button-save-location" disabled={!form.name.trim() || !form.address.trim() || !form.hours.trim() || (form.type === "vendor" && !form.vendorName.trim()) || (form.type === "city_tap" && (!form.countryIso.trim() || !/^[A-Z]{2}$/.test(form.countryIso.trim()))) || !coordinatesValid || (!!form.lastFieldVerifiedOn && !!form.nextReviewOn && form.nextReviewOn < form.lastFieldVerifiedOn) || mutation.isPending}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{location ? "Save changes" : "Create location"}</Button></div>
  </form>;
}

export default function AdminLocationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<UcLocation | "new" | null>(null);
  const locationsQuery = useListUcAdminLocations();
  const locations = locationsQuery.data?.locations ?? [];
  const today = fieldReviewDateFormatter.format(new Date());
  const action = useMutation({
    mutationFn: async ({ location, active }: { location: UcLocation; active: boolean }) => updateUcAdminLocation(location.id, { active }),
    onSuccess: (result) => {
      // Patch immediately so the visible list reflects the authoritative response
      // before another query round trip completes.
      queryClient.setQueryData(getListUcAdminLocationsQueryKey(), (old: { locations: UcLocation[] } | undefined) => old ? { locations: old.locations.map((item) => item.id === result.location?.id ? (result.location ?? item) : item) } : old);
      void queryClient.invalidateQueries({ queryKey: getListUcAdminLocationsQueryKey() });
      toast({ title: "Location updated" });
    },
    onError: (error) => toast({ title: "Location update failed", description: errorMessage(error), variant: "destructive" }),
  });
  async function verify(location: UcLocation) {
    const response = await fetch(`${API_ORIGIN}/api/uc/admin/locations/${location.id}/verify`, { method: "POST", headers: getAuthHeaders() ?? {} });
    if (!response.ok) { toast({ title: "Location verification failed", description: "The server rejected verification.", variant: "destructive" }); return; }
    void queryClient.invalidateQueries({ queryKey: getListUcAdminLocationsQueryKey() });
    toast({ title: "Location verified" });
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><MapPin className="h-6 w-6" />Locations & Quality</h1><p className="mt-1 text-sm text-muted-foreground">Manage locations, conduct assessments, and moderate community ratings.</p></div><Button data-testid="button-add-location" onClick={() => setEditing("new")}><Plus className="mr-2 h-4 w-4" />Add location</Button></div>

    <Tabs defaultValue="locations" className="space-y-6">
      <TabsList>
        <TabsTrigger value="locations">Locations</TabsTrigger>
        <TabsTrigger value="assessments">Assessments</TabsTrigger>
        <TabsTrigger value="moderation">Ratings Moderation</TabsTrigger>
      </TabsList>

      <TabsContent value="locations" className="space-y-4 m-0">
        <p className="text-xs text-muted-foreground">Field-review dates use Africa/Nairobi time.</p>
        {editing && <LocationForm location={editing === "new" ? undefined : editing} done={() => setEditing(null)} />}
        {locationsQuery.isLoading ? <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading locations…</p> : locationsQuery.isError ? <p role="alert" className="text-sm text-destructive">Locations could not be loaded.</p> : locations.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No locations yet.</div> : (
          <div className="grid gap-3 md:grid-cols-2">
            {locations.map((location) => {
              const published = location.active && location.verified;
              const reviewWarning = published && (!location.nextReviewOn || location.nextReviewOn <= today);
              return (
                <article data-testid={`card-location-${location.id}`} key={location.id} className={`rounded-lg border bg-card p-4 ${reviewWarning ? "border-amber-500 bg-amber-50/40 dark:bg-amber-950/10" : ""}`}>
                  <div className="flex justify-between gap-2">
                    <div>
                      <h2 className="font-semibold">{location.name}</h2>
                      <p className="text-sm text-muted-foreground">{location.type === "experience_centre" ? "Experience centre" : location.type === "refill_atm" || location.type === "water_atm" ? "Water ATM" : location.type === "refill_station" ? "Refill Station" : location.type === "city_tap" ? "City Tap" : location.vendorName ? `Vendor · ${location.vendorName}` : "Vendor"}</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1"><Badge variant={location.verified ? "default" : "secondary"}>{location.verified ? "Verified" : "Pending verification"}</Badge>{!location.active && <Badge variant="outline">Inactive</Badge>}</div>
                  </div>
                  <p className="mt-3 text-sm">{location.address}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{location.hours} · {location.lat}, {location.lng}</p>
                  {location.phone && <p className="mt-1 text-xs text-muted-foreground">{location.phone}</p>}
                  {location.type === "city_tap" && <p className="mt-1 text-xs text-muted-foreground">Country: {location.countryIso}{location.city ? `, ${location.city}` : ""}{location.municipal ? ` · ${location.municipal}` : ""}</p>}
                  {reviewWarning && <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-100 p-2 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{location.nextReviewOn ? `Field review was due ${location.nextReviewOn}.` : "Published location has no next field-review date."}</div>}
                  <p className="mt-2 text-xs text-muted-foreground">Last field check: {location.lastFieldVerifiedOn ?? "Not recorded"}{location.nextReviewOn ? ` · Next review: ${location.nextReviewOn}` : ""}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button data-testid={`button-edit-location-${location.id}`} size="sm" variant="outline" onClick={() => setEditing(location)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                    {!location.verified && <Button data-testid={`button-verify-location-${location.id}`} size="sm" variant="outline" disabled={action.isPending} onClick={() => void verify(location)}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Verify</Button>}
                    <Button data-testid={`button-toggle-location-${location.id}`} size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ location, active: !location.active })}><Power className="mr-1 h-3.5 w-3.5" />{location.active ? "Deactivate" : "Activate"}</Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </TabsContent>

      <TabsContent value="assessments" className="m-0">
        <LocationAssessments locations={locations} />
      </TabsContent>

      <TabsContent value="moderation" className="m-0">
        <RatingsModeration />
      </TabsContent>
    </Tabs>
  </div>;
}