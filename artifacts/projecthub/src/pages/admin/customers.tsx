import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, Search, ChevronLeft, ChevronRight, X,
  Phone, Mail, Calendar, ShoppingBag, Wrench,
  Loader2, UserCircle2, Package, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { getAuthHeaders } from "@/lib/team-auth";
import { isTeamAdmin } from "@/lib/team-auth";

const API = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const PAGE_LIMIT = 50;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CustomerSummary {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  joinedAt: string;
  orderCount: number;
  products: string[];
}

interface CustomerListResponse {
  customers: CustomerSummary[];
  total: number;
  page: number;
  limit: number;
}

interface OrderLineItem {
  name: string;
  quantity: number;
  total: string;
}

interface CustomerOrder {
  id: number;
  status: string;
  total: string;
  currency: string;
  paymentMethod: string;
  dateCreated: string;
  lineItems: OrderLineItem[];
}

interface CustomerTicket {
  id: string;
  productModel: string;
  issueDescription: string;
  status: string;
  createdAt: string;
}

interface CustomerDetail {
  customer: {
    id: number;
    email: string;
    firstName: string;
    lastName: string;
    name: string;
    phone: string;
    joinedAt: string;
    authProvider: string;
  };
  orders: CustomerOrder[];
  tickets: CustomerTicket[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function orderStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed": return "default";
    case "processing": return "secondary";
    case "cancelled": case "failed": return "destructive";
    default: return "outline";
  }
}

function ticketStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "resolved": return "default";
    case "submitted": case "open": return "secondary";
    case "closed": return "outline";
    default: return "outline";
  }
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function CustomerDetailPanel({
  customerId,
  open,
  onClose,
}: {
  customerId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const headers = getAuthHeaders();

  const { data, isLoading, error } = useQuery<CustomerDetail>({
    queryKey: ["uc-customer-detail", customerId],
    enabled: open && customerId !== null,
    queryFn: async () => {
      const res = await fetch(`${API}/api/uc/admin/customers/${customerId}`, {
        headers: headers ?? {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to load customer");
      }
      return res.json() as Promise<CustomerDetail>;
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {error && (
          <div className="text-destructive text-sm mt-8 text-center">
            {error instanceof Error ? error.message : "Failed to load customer"}
          </div>
        )}
        {data && (
          <>
            <SheetHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <UserCircle2 className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <SheetTitle>{data.customer.name || data.customer.email}</SheetTitle>
                  <SheetDescription className="text-xs">
                    Customer #{data.customer.id}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            {/* Contact info */}
            <section className="space-y-2 pb-5 border-b">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Contact
              </h3>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="break-all">{data.customer.email}</span>
                </div>
                {data.customer.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{data.customer.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Joined {fmtDate(data.customer.joinedAt)}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <UserCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="capitalize">{data.customer.authProvider} account</span>
                </div>
              </div>
            </section>

            {/* Orders */}
            <section className="pt-4 pb-5 border-b space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ShoppingBag className="w-3.5 h-3.5" /> Orders ({data.orders.length})
              </h3>
              {data.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.orders.map((order) => (
                    <div key={order.id} className="rounded-lg border p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Order #{order.id}</span>
                        <Badge variant={orderStatusVariant(order.status)} className="capitalize text-xs">
                          {order.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDateTime(order.dateCreated)} · {order.currency} {order.total} · {order.paymentMethod}
                      </div>
                      {order.lineItems.length > 0 && (
                        <ul className="text-xs text-muted-foreground space-y-0.5 pl-1 border-t pt-1.5 mt-1.5">
                          {order.lineItems.map((item, i) => (
                            <li key={i}>
                              {item.name} × {item.quantity}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Tickets */}
            <section className="pt-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5" /> Support tickets ({data.tickets.length})
              </h3>
              {data.tickets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tickets raised.</p>
              ) : (
                <div className="space-y-3">
                  {data.tickets.map((ticket) => (
                    <div key={ticket.id} className="rounded-lg border p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{ticket.productModel}</span>
                        <Badge variant={ticketStatusVariant(ticket.status)} className="capitalize text-xs">
                          {ticket.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {ticket.issueDescription}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDateTime(ticket.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminCustomersPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const debounceRef = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef[0]) clearTimeout(debounceRef[0]);
    debounceRef[1](setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 300));
  }, [debounceRef]);

  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setFromDate("");
    setToDate("");
    setPage(1);
  }

  const hasFilters = debouncedSearch || fromDate || toDate;
  const headers = getAuthHeaders();

  async function exportCustomers() {
    setIsExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const query = params.toString();
      const res = await fetch(`${API}/api/uc/admin/customers/export${query ? `?${query}` : ""}`, {
        headers: headers ?? {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to export customers");
      }

      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "customers.csv";
      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to export customers");
    } finally {
      setIsExporting(false);
    }
  }

  const { data, isLoading, error } = useQuery<CustomerListResponse>({
    queryKey: ["uc-customers", debouncedSearch, fromDate, toDate, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const res = await fetch(`${API}/api/uc/admin/customers?${params.toString()}`, {
        headers: headers ?? {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to load customers");
      }
      return res.json() as Promise<CustomerListResponse>;
    },
  });

  if (!isTeamAdmin()) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        You don't have permission to view this page.
      </div>
    );
  }

  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_LIMIT);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" /> Customers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            All registered UC Companion app accounts.
            {total > 0 && !isLoading && (
              <span className="ml-1 font-medium text-foreground">{total.toLocaleString()} total.</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={exportCustomers}
          disabled={isExporting || isLoading}
          className="gap-2"
        >
          {isExporting
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Download className="w-4 h-4" />}
          {isExporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      {exportError && (
        <div role="alert" className="text-destructive text-sm">
          {exportError}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or phone…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground whitespace-nowrap">From</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              className="w-36 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground whitespace-nowrap">To</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              className="w-36 text-sm"
            />
          </div>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="gap-1 text-xs">
              <X className="w-3.5 h-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading customers…
        </div>
      ) : error ? (
        <div className="text-destructive text-sm text-center py-10">
          {error instanceof Error ? error.message : "Failed to load customers"}
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Filters owned</TableHead>
                <TableHead className="text-right">Orders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedId(c.id)}
                >
                  <TableCell className="font-medium">
                    {c.name || <span className="text-muted-foreground italic">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{c.email}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {c.phone || <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {fmtDate(c.joinedAt)}
                  </TableCell>
                  <TableCell>
                    {c.products.length === 0 ? (
                      <span className="text-muted-foreground/50 text-xs">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.products.map((p) => (
                          <Badge key={p} variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                            <Package className="w-2.5 h-2.5" />{p}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {c.orderCount > 0 ? (
                      <span className="font-medium">{c.orderCount}</span>
                    ) : (
                      <span className="text-muted-foreground/50">0</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {customers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    {hasFilters
                      ? "No customers match your search."
                      : "No registered customers yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span>
                Showing {((page - 1) * PAGE_LIMIT) + 1}–{Math.min(page * PAGE_LIMIT, total)} of {total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm" variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-2 tabular-nums">{page} / {totalPages}</span>
                <Button
                  size="sm" variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail panel */}
      <CustomerDetailPanel
        customerId={selectedId}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
