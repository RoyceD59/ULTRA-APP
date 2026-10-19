import { useState } from "react";
import type { UcAdminOrderLineInput } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { API_ORIGIN } from "@/lib/api-base";

interface RecoveryOrder {
  id: number;
  userId: string;
  currency: string;
  total: string;
  recoveryEnrichedAt?: string | null;
  shippingAddress?: Record<string, string>;
  lineItems: UcAdminOrderLineInput[];
}
const fields = [
  ["firstName", "First name"], ["lastName", "Last name"], ["phone", "Phone"],
  ["address1", "Street / delivery address"], ["address2", "Additional directions"],
  ["city", "City"], ["country", "Country"], ["postcode", "Postal code"],
] as const;
const emptyItem = () => ({ productId: "", name: "", quantity: "1", total: "" });

export function RecoveryEnrichmentDialog({ order, token, onChanged, disabled }: {
  order: RecoveryOrder; token: string; onChanged: () => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState<Record<string, string>>({});
  const [items, setItems] = useState<ReturnType<typeof emptyItem>[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function show() {
    const saved = order.shippingAddress ?? {};
    setAddress({ ...saved, firstName: saved.firstName || saved.name || "", address1: saved.address1 || saved.address || "", fulfillment: saved.fulfillment === "pickup" ? "collection" : saved.fulfillment || "delivery" });
    setItems(order.lineItems.length ? order.lineItems.map(item => ({
      productId: String(item.productId), name: item.name, quantity: String(item.quantity), total: item.total,
    })) : [emptyItem()]);
    setError(""); setOpen(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API_ORIGIN}/api/uc/admin/orders/${order.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          shippingAddress: address,
          lineItems: items.map(item => ({ ...item, name: item.name.trim(), productId: Number(item.productId), quantity: Number(item.quantity) })),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Save failed (${response.status})`);
      setOpen(false); onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save enrichment.");
    } finally { setBusy(false); }
  }
  return <>
    <Button variant="outline" size="sm" disabled={disabled} onClick={show}>
      {order.recoveryEnrichedAt ? "Edit enrichment" : "Enrich"}
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enrich recovery order #{order.id}</DialogTitle>
          <DialogDescription>
            Confirm items and shipping with the customer ({order.userId}). The recorded payment of {order.currency} {order.total} stays unchanged. Saving records this order as ready to dispatch.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={busy} className="space-y-3">
            <legend className="text-sm font-semibold mb-2">Customer and shipping</legend>
            <Label htmlFor={`fulfillment-${order.id}`}>Fulfillment</Label>
            <select id={`fulfillment-${order.id}`} className="w-full border rounded-md p-2 bg-background" value={address.fulfillment} onChange={event => setAddress(current => ({ ...current, fulfillment: event.target.value }))}>
              <option value="delivery">Delivery</option><option value="collection">Pickup / collection</option>
            </select>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fields.map(([key, label]) => <div key={key} className="space-y-1">
                <Label htmlFor={`enrich-${order.id}-${key}`}>{label}</Label>
                <Input id={`enrich-${order.id}-${key}`} value={address[key] ?? ""} maxLength={1000}
                  required={key === "firstName" || key === "phone" || (address.fulfillment !== "collection" && ["address1", "city", "country"].includes(key))}
                  onChange={event => setAddress(current => ({ ...current, [key]: event.target.value }))} />
              </div>)}
            </div>
          </fieldset>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="text-sm font-semibold mb-2">Confirmed items</legend>
            <p className="text-xs text-muted-foreground">Use the actual catalogue product ID and the confirmed line total, not the unit price.</p>
            {items.map((item, index) => <div key={index} className="rounded-md border p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {(["productId", "name", "quantity", "total"] as const).map(key => <div key={key} className="space-y-1">
                  <Label htmlFor={`item-${order.id}-${index}-${key}`}>{
                    key === "productId" ? "Product ID" : key === "name" ? "Product name" : key === "quantity" ? "Quantity" : `Line total (${order.currency})`
                  }</Label>
                  <Input id={`item-${order.id}-${index}-${key}`} required value={item[key]}
                    type={key === "name" ? "text" : "number"}
                    min={key === "total" ? 0 : 1} step={key === "total" ? "0.01" : "1"}
                    max={key === "quantity" ? 1000 : key === "productId" ? 2147483647 : key === "total" ? 9999999999.99 : undefined}
                    maxLength={key === "name" ? 300 : undefined}
                    onChange={event => setItems(current => current.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row))} />
                </div>)}
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={items.length === 1} onClick={() => setItems(current => current.filter((_, i) => i !== index))} aria-label={`Remove item ${index + 1}`}>Remove item</Button>
            </div>)}
            <Button type="button" variant="outline" disabled={items.length >= 100} onClick={() => setItems(current => [...current, emptyItem()])}>Add item</Button>
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save enrichment"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}