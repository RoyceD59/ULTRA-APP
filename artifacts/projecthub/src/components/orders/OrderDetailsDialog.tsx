import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface OrderDetails {
  id: number;
  userId: string;
  status: string;
  currency: string;
  total: string;
  paymentReference: string;
  webhookRecovery: boolean;
  lineItems: { productId: number; name: string; quantity: number; total: string }[];
}

export function OrderDetailsDialog({ order }: { order: OrderDetails }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`View details for order #${order.id}`}>
          View details
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Order #{order.id}</DialogTitle>
          <DialogDescription>Review this order before dispatch.</DialogDescription>
        </DialogHeader>
        {order.webhookRecovery && (
          <div role="note" aria-label="Webhook recovery warning"
            className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Webhook recovery — enrichment required</p>
              <p className="mt-1 text-sm">
                This order was recovered from a payment webhook and may have incomplete details.
                Confirm the customer, purchased items, and delivery or collection details, and enrich
                the order before dispatch.
              </p>
            </div>
          </div>
        )}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Customer</dt>
          <dd className="break-all">{order.userId}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="capitalize">{order.status}</dd>
          <dt className="text-muted-foreground">Payment reference</dt>
          <dd className="break-all font-mono">{order.paymentReference || "Not recorded"}</dd>
          <dt className="text-muted-foreground">Total</dt>
          <dd className="font-semibold">{order.currency} {order.total}</dd>
        </dl>
        <section aria-label="Purchased items">
          <h3 className="mb-2 text-sm font-semibold">Purchased items</h3>
          {order.lineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No line items recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {order.lineItems.map((item, index) => (
                <li key={`${item.productId}-${index}`} className="flex justify-between gap-3">
                  <span>{item.name} × {item.quantity}</span>
                  <span className="shrink-0">{order.currency} {item.total}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}