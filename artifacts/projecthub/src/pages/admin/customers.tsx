import { useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, Search, ChevronLeft, ChevronRight, X,
  Phone, Mail, Calendar, ShoppingBag, Wrench, Droplets,
  Loader2, UserCircle2, Package, Download, KeyRound, Copy, Check,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { getAuthHeaders } from "@/lib/team-auth";
import { isTeamAdmin } from "@/lib/team-auth";
import { Link } from "wouter";
import {
  issueUcTemporaryPassword,
  useListProjectHubInstantWaterAssessments,
  getListProjectHubInstantWaterAssessmentsQueryKey,
  useListCustomerAssignments,
  getListCustomerAssignmentsQueryKey,
  type UcTemporaryPasswordInputChannel,
  type UcTemporaryPasswordResult,
  type UcCustomerDetail,
} from "@workspace/api-client-react";
import { API_ORIGIN } from "@/lib/api-base";

const API = API_ORIGIN;
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

type CustomerDetail = UcCustomerDetail;

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

function actionablePasswordError(error: unknown) {
  const payload = (error as { data?: { code?: string; error?: string } } | null)?.data;
  const messages: Record<string, string> = {
    INSUFFICIENT_PERMISSION: "You do not have permission to issue temporary passwords.",
    ACCOUNT_INELIGIBLE: "This account is inactive or does not use password authentication.",
    UNAVAILABLE_UNVERIFIED_DESTINATION: "The selected contact method is missing or has not been verified.",
    WHATSAPP_DISCONNECTED: "WhatsApp is disconnected. Connect WhatsApp before using this delivery channel.",
    DELIVERY_PROVIDER_FAILURE: "The delivery provider could not deliver this password. The account credential was not changed.",
  };
  return messages[payload?.code ?? ""] ?? payload?.error ?? (error instanceof Error ? error.message : "A temporary password could not be issued.");
}

// ─── Temporary password dialog ─────────────────────────────────────────────────

function TemporaryPasswordDialog({
  customer,
  open,
  onClose,
}: {
  customer: CustomerDetail["customer"];
  open: boolean;
  onClose: () => void;
}) {
  const [channel, setChannel] = useState<UcTemporaryPasswordInputChannel>("email");
  const [result, setResult] = useState<UcTemporaryPasswordResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);
  const requestId = useRef(0);
  // These are intentionally strict checks.  A missing field must never be
  // interpreted as verified/available: the API is authoritative for recovery
  // eligibility and channel health.
  const emailRecovery = customer.recoveryChannels?.email;
  const whatsappRecovery = customer.recoveryChannels?.whatsapp;
  const emailEligible = customer.emailVerified === true
    && emailRecovery?.verified === true
    && emailRecovery?.available === true
    && Boolean(customer.email);
  const whatsappEligible = customer.phoneVerified === true
    && whatsappRecovery?.verified === true
    && whatsappRecovery?.available === true
    && whatsappRecovery?.status === "connected"
    && Boolean(customer.phone);
  const accountEligible = customer.authProvider === "password";

  function openDialog() {
    setChannel("email");
    setResult(null);
    setError("");
    setCopied(false);
  }

  function handleClose() {
    // Invalidate an in-flight response before removing its plaintext from state.
    // This prevents a late response from repopulating a closed dialog.
    requestId.current += 1;
    setIsIssuing(false);
    setResult(null);
    setError("");
    setCopied(false);
    onClose();
  }

  async function generatePassword() {
    const currentRequest = ++requestId.current;
    setIsIssuing(true);
    setError("");
    setResult(null);
    setCopied(false);

    try {
      const issued = await issueUcTemporaryPassword(customer.id, { channel });
      if (currentRequest !== requestId.current) return;
      if (!issued?.temporaryPassword) {
        setError("A temporary password could not be issued for this account.");
        return;
      }
      setResult(issued);
    } catch (err) {
      if (currentRequest === requestId.current) {
        setError(actionablePasswordError(err));
      }
    } finally {
      if (currentRequest === requestId.current) setIsIssuing(false);
    }
  }

  async function copyPassword() {
    if (!result?.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
    } catch {
      setError("Unable to copy the temporary password. Select it and copy it manually.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) openDialog();
        else handleClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            Generate temporary password
          </DialogTitle>
          <DialogDescription>
            Issue a 24-hour password for {customer.name || customer.email}. The plaintext is shown once and is not retained after this dialog closes.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="temporary-password-value">Temporary password (shown once)</Label>
              <div className="flex gap-2">
                <Input
                  data-testid="input-temporary-password"
                  id="temporary-password-value"
                  value={result.temporaryPassword}
                  readOnly
                  autoComplete="off"
                  className="font-mono"
                  aria-describedby="temporary-password-help"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={copyPassword}
                  aria-label="Copy temporary password"
                  title="Copy temporary password"
                >
                  {copied
                    ? <Check className="w-4 h-4 text-green-600" />
                    : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p id="temporary-password-help" className="text-xs text-muted-foreground">
                Copy it now. It will not be available after this dialog is closed.
              </p>
            </div>

            <div className="rounded-md border p-3 space-y-2 text-sm" aria-live="polite">
              <p className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                <span>
                  Delivery {result.delivery.delivered ? "confirmed" : "not confirmed"} via{" "}
                  <strong className="capitalize">{result.delivery.channel}</strong>.
                </span>
              </p>
              <p className="text-muted-foreground">
                Expires {fmtDateTime(result.expiresAt)}. The customer must choose a permanent password before using Companion.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Delivery channel</legend>
              <p className="text-xs text-muted-foreground">
                Choose a verified contact method. The server will not issue a password for an unverified channel.
              </p>
              <div className="space-y-2">
                <label
                  htmlFor="temporary-password-email"
                  className="flex items-start gap-3 rounded-md border p-3 cursor-pointer has-[:checked]:border-primary"
                >
                  <input
                    data-testid="input-channel-email"
                    id="temporary-password-email"
                    type="radio"
                    name="temporary-password-channel"
                    value="email"
                    checked={channel === "email"}
                    onChange={() => setChannel("email")}
                   disabled={isIssuing || !emailEligible || !accountEligible}
                    className="mt-1 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">Email</span>
                     <span className="block text-xs text-muted-foreground break-all">{customer.email || "No email address"}</span>
                     {!emailEligible && <span className="block text-xs text-destructive">{customer.emailVerified !== true || emailRecovery?.verified !== true ? "Email is not verified" : "Email is unavailable"}</span>}
                  </span>
                </label>
                <label
                  htmlFor="temporary-password-whatsapp"
                     className={`flex items-start gap-3 rounded-md border p-3 ${whatsappEligible && accountEligible ? "cursor-pointer has-[:checked]:border-primary" : "opacity-60"}`}
                >
                  <input
                    data-testid="input-channel-whatsapp"
                    id="temporary-password-whatsapp"
                    type="radio"
                    name="temporary-password-channel"
                    value="whatsapp"
                    checked={channel === "whatsapp"}
                    onChange={() => setChannel("whatsapp")}
                     disabled={!whatsappEligible || !accountEligible || isIssuing}
                    className="mt-1 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">WhatsApp</span>
                    <span className="block text-xs text-muted-foreground">
                       {customer.phone || "No phone number on this account"}
                    </span>
                     {!whatsappEligible && <span className="block text-xs text-destructive">{customer.phoneVerified !== true || whatsappRecovery?.verified !== true ? "Phone is not verified" : whatsappRecovery?.status !== "connected" ? `WhatsApp is ${whatsappRecovery?.status ?? "disconnected"}` : "Phone is unavailable"}</span>}
                  </span>
                </label>
              </div>
            </fieldset>

            {!accountEligible && <p role="alert" className="text-sm text-destructive">Temporary passwords require an active password-authenticated account.</p>}
            {error && <p role="alert" data-testid="status-temporary-password-error" className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={handleClose} disabled={isIssuing}>Cancel</Button>
              <Button type="button" data-testid="button-generate-temporary-password" onClick={generatePassword} disabled={isIssuing || !accountEligible || (channel === "email" ? !emailEligible : !whatsappEligible)}>
                {isIssuing
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Generating…</>
                  : "Generate temporary password"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
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
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

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

  const params = { customerId: customerId ?? undefined, limit: 5 };
  const { data: waterTestsData, isLoading: isLoadingWaterTests, error: waterTestsError } = useListProjectHubInstantWaterAssessments(
    params,
    { query: { enabled: open && customerId !== null, queryKey: getListProjectHubInstantWaterAssessmentsQueryKey(params) } }
  );

  const assignmentsQuery = useListCustomerAssignments({
    query: { enabled: open && customerId !== null, queryKey: getListCustomerAssignmentsQueryKey() },
  });
  const linkedAssignments = (assignmentsQuery.data ?? []).filter((a) => a.linkedAccountId === customerId && a.status === "linked");

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
              {data.customer.authProvider === "password" ? (
                <Button
                  data-testid="button-open-temporary-password"
                  type="button"
                  variant="outline"
                  className="w-full gap-2 mt-3"
                  onClick={() => setPasswordDialogOpen(true)}
                >
                  <KeyRound className="w-4 h-4" />
                  Generate temporary password
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground mt-3">
                  Temporary passwords are available only for password-authenticated Companion accounts.
                </p>
              )}
            </section>

            {/* Instant Water Tests */}
            <section className="pt-4 pb-5 border-b space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Droplets className="w-3.5 h-3.5" /> Instant Water Checks
              </h3>
              {isLoadingWaterTests ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : waterTestsError ? (
                <p className="text-sm text-destructive">Failed to load water checks.</p>
              ) : !waterTestsData || waterTestsData.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No instant water assessments linked to this account yet.</p>
              ) : (
                <div className="space-y-3">
                  {waterTestsData.items.map((t) => (
                    <div key={t.assessmentId} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <Link href="/water-tests" className="font-medium text-sm hover:underline text-primary line-clamp-1 block">
                            {t.reference}
                          </Link>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {t.createdAt ? fmtDate(t.createdAt) : ""} · {t.area}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge variant="outline" className="text-[10px] capitalize bg-muted/50 border-0">
                            {t.serviceState.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground capitalize">
                            {t.accountLinkState.replace(/_/g, " ")}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1 text-[11px] bg-muted/30 p-2 rounded-lg border">
                        <div>Hardness: <span className="font-medium text-foreground">{t.bands.hardness}</span></div>
                        <div>Taste: <span className="font-medium text-foreground">{t.bands.taste}</span></div>
                        <div>Sediment: <span className="font-medium text-foreground">{t.bands.sediment}</span></div>
                        <div>Microbial: <span className="font-medium text-foreground">{t.bands.microbial}</span></div>
                      </div>
                    </div>
                  ))}
                  <div className="text-xs mt-2 text-right">
                    <Link href="/water-tests" className="text-muted-foreground hover:text-primary hover:underline">
                      View all in queue →
                    </Link>
                  </div>
                </div>
              )}
            </section>

            <section className="pt-4 pb-5 border-b space-y-3" data-testid="section-linked-assignments">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" /> Linked filter assignments ({linkedAssignments.length})
              </h3>
              {assignmentsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : assignmentsQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">Failed to load assignments.</p>
              ) : linkedAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No linked filter assignments.</p>
              ) : linkedAssignments.map((a) => (
                <div key={a.id} className="rounded-lg border p-3 text-xs space-y-0.5">
                  <div className="text-sm font-medium">{a.productName}</div>
                  <div className="text-muted-foreground">{a.orderReference} · installed {a.installationDate}</div>
                  <div className="text-muted-foreground">{a.cashCollectionState === "collected" ? "Cash collected" : a.cashCollectionState === "awaiting_collection" ? "Awaiting collection" : "Collection unknown"}</div>
                </div>
              ))}
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
      {data?.customer && (
        <TemporaryPasswordDialog
          customer={data.customer}
          open={passwordDialogOpen}
          onClose={() => setPasswordDialogOpen(false)}
        />
      )}
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
