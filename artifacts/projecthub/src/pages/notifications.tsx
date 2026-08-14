import { useState, useEffect, useRef } from "react";
import { 
  useListNotificationLogs, 
  useDispatchNotification,
  useListContacts,
  getListNotificationLogsQueryKey,
  useGetWhatsAppStatus,
  getGetWhatsAppStatusQueryKey,
  useSendWhatsAppQuickMessage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { BellRing, Send, Mail, MessageCircle, Phone, CheckCircle2, XCircle, AlertCircle, Clock, Wifi, WifiOff, Loader2, KeyRound, Check, CheckCheck } from "lucide-react";
import { formatRelativeDate } from "@/components/shared/badges";
import type { NotificationLog } from "@workspace/api-client-react";
import { TeamAuthDialog } from "@/components/team-auth-dialog";
import { getAuthHeaders, isTeamAuthenticated, clearTeamToken } from "@/lib/team-auth";

const dispatchSchema = z.object({
  contactId: z.string().min(1, "Contact is required"),
  templateId: z.enum(["STAKEHOLDER_UPDATE", "OWNER_ALERT", "RESOURCE_REQ"]),
  taskId: z.string().optional(),
});

const quickMessageSchema = z.object({
  to: z.string().min(7, "Enter a valid phone number"),
  message: z.string().min(1, "Message cannot be empty").max(4096, "Message too long"),
});

type QuickMessageResult =
  | { status: "sent"; to: string }
  | { status: "failed"; error: string }
  | null;

function StatusBadge({ status }: { status: string }) {
  if (status === 'sent') {
    return <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Sent</Badge>;
  }
  if (status === 'failed') {
    return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1.5"><XCircle className="w-3.5 h-3.5" /> Failed</Badge>;
  }
  if (status === 'fallback') {
    return <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Fallback</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

function ChannelIcon({ type, className }: { type: string, className?: string }) {
  if (type === 'email') return <Mail className={className} />;
  if (type === 'whatsapp') return <MessageCircle className={className} />;
  if (type === 'sms') return <Phone className={className} />;
  return <BellRing className={className} />;
}

/**
 * WhatsApp delivery receipt ticks — mirrors the familiar WhatsApp UI:
 *   no deliveryStatus → single grey tick  (sent to server)
 *   "delivered"       → double grey ticks (received on device)
 *   "read"            → double blue ticks (opened by recipient)
 */
function DeliveryReceiptTick({ deliveryStatus }: { deliveryStatus?: string | null }) {
  if (deliveryStatus === "read") {
    return (
      <span title="Read" className="inline-flex items-center gap-0.5 text-sky-500">
        <CheckCheck className="w-3.5 h-3.5" />
      </span>
    );
  }
  if (deliveryStatus === "delivered") {
    return (
      <span title="Delivered" className="inline-flex items-center gap-0.5 text-muted-foreground">
        <CheckCheck className="w-3.5 h-3.5" />
      </span>
    );
  }
  // Sent but no receipt yet
  return (
    <span title="Sent" className="inline-flex items-center gap-0.5 text-muted-foreground/60">
      <Check className="w-3.5 h-3.5" />
    </span>
  );
}

function WhatsAppStatePill({ state }: { state: string }) {
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <Wifi className="w-3.5 h-3.5" /> Connected
      </span>
    );
  }
  if (state === "connecting" || state === "qr") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {state === "qr" ? "Waiting for scan" : "Connecting…"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <WifiOff className="w-3.5 h-3.5" /> Not connected
    </span>
  );
}

export default function Notifications() {
  const { data: logs, isLoading } = useListNotificationLogs(
    { limit: 50 },
    {
      query: {
        queryKey: getListNotificationLogsQueryKey({ limit: 50 }),
        // No refetchInterval — receipt updates arrive via SSE (see useEffect below)
      },
    }
  );
  const { data: contacts } = useListContacts();
  const queryClient = useQueryClient();

  // ── SSE: subscribe to receipt updates instead of polling ──────────────────
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    // Close any previous connection before opening a new one.
    esRef.current?.close();

    const es = new EventSource("/api/notifications/receipt-stream");
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const { whatsappMsgId, deliveryStatus } = JSON.parse(event.data) as {
          whatsappMsgId: string;
          deliveryStatus: "delivered" | "read";
        };

        // Patch the matching row in the React Query cache without a full refetch.
        queryClient.setQueryData<NotificationLog[]>(
          getListNotificationLogsQueryKey({ limit: 50 }),
          (prev) => {
            if (!prev) return prev;
            return prev.map((log) =>
              log.whatsappMessageId === whatsappMsgId
                ? { ...log, deliveryStatus }
                : log
            );
          }
        );
      } catch {
        // Ignore malformed events (e.g. heartbeat comments)
      }
    };

    es.onopen = () => {
      // Refetch once on every (re)connect to catch any receipts that arrived
      // before the SSE stream was established or while it was disconnected.
      queryClient.invalidateQueries({
        queryKey: getListNotificationLogsQueryKey({ limit: 50 }),
      });
    };

    es.onerror = () => {
      // Browser will automatically reconnect on transient failures.
      // No explicit retry logic needed here.
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [queryClient]);
  const { toast } = useToast();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [quickMsgResult, setQuickMsgResult] = useState<QuickMessageResult>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authed, setAuthed] = useState(() => isTeamAuthenticated());

  // Build auth headers — regenerated whenever authed toggles
  const authHeaders = authed ? (getAuthHeaders() ?? {}) : {};

  const { data: waStatus } = useGetWhatsAppStatus({
    query: {
      queryKey: getGetWhatsAppStatusQueryKey(),
      refetchInterval: 5000,
      staleTime: 0,
      enabled: authed,
    },
    request: { headers: authHeaders },
  });

  const dispatchMutation = useDispatchNotification({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationLogsQueryKey() });
        toast({ title: "Notification Dispatched" });
        setDialogOpen(false);
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast({ title: "Dispatch Failed", description: msg, variant: "destructive" });
      }
    }
  });

  const sendQuickMsg = useSendWhatsAppQuickMessage({
    request: { headers: authHeaders },
    mutation: {
      onSuccess: (_data, variables) => {
        setQuickMsgResult({ status: "sent", to: variables.data.to });
        quickMsgForm.reset();
        queryClient.invalidateQueries({ queryKey: getListNotificationLogsQueryKey() });
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to send message";
        // If the server returns 401, our token expired — prompt re-auth
        if (msg.includes("401")) {
          clearTeamToken();
          setAuthed(false);
          setQuickMsgResult({ status: "failed", error: "Session expired. Please sign in again." });
        } else {
          setQuickMsgResult({ status: "failed", error: msg });
        }
      },
    },
  });

  const form = useForm<z.infer<typeof dispatchSchema>>({
    resolver: zodResolver(dispatchSchema),
    defaultValues: { contactId: "", templateId: "STAKEHOLDER_UPDATE", taskId: "" }
  });

  const quickMsgForm = useForm<z.infer<typeof quickMessageSchema>>({
    resolver: zodResolver(quickMessageSchema),
    defaultValues: { to: "", message: "" },
  });

  function onSubmit(values: z.infer<typeof dispatchSchema>) {
    dispatchMutation.mutate({
      data: {
        contactId: Number(values.contactId),
        templateId: values.templateId,
        taskId: values.taskId ? Number(values.taskId) : undefined
      }
    });
  }

  function onSendQuickMsg(values: z.infer<typeof quickMessageSchema>) {
    setQuickMsgResult(null);
    sendQuickMsg.mutate({
      data: { to: values.to, message: values.message },
    });
  }

  function handleAuthenticated() {
    setAuthed(true);
    setAuthOpen(false);
    queryClient.invalidateQueries({ queryKey: getGetWhatsAppStatusQueryKey() });
  }

  const waConnected = waStatus?.state === "connected";

  return (
    <div className="space-y-8 animate-in-up">
      <TeamAuthDialog
        open={authOpen}
        onAuthenticated={handleAuthenticated}
        onClose={() => setAuthOpen(false)}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <BellRing className="w-8 h-8 text-amber-500" />
            Notification Center
          </h1>
          <p className="text-muted-foreground mt-1 text-lg">Central nervous system for external communications.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2 shadow-sm font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950">
          <Send className="w-4 h-4" /> Dispatch Alert
        </Button>
      </div>

      {/* ── Quick Message ─────────────────────────────────────────── */}
      <Card className="shadow-sm border-emerald-500/20 bg-emerald-500/5">
        <CardHeader className="border-b border-emerald-500/20 bg-emerald-500/5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                Quick WhatsApp Message
              </CardTitle>
              <CardDescription className="mt-0.5">
                Send a free-form message to any phone number directly via the active WhatsApp session.
              </CardDescription>
            </div>
            {authed
              ? <WhatsAppStatePill state={waStatus?.state ?? "disconnected"} />
              : <Badge variant="outline" className="gap-1 text-muted-foreground shrink-0"><KeyRound className="w-3 h-3" /> Requires auth</Badge>
            }
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {/* Not authenticated */}
          {!authed && (
            <div className="flex items-center gap-3 py-2">
              <p className="text-sm text-muted-foreground flex-1">
                Sign in with the team passcode to send WhatsApp messages.
              </p>
              <Button onClick={() => setAuthOpen(true)} size="sm" className="gap-2 bg-amber-500 hover:bg-amber-600 text-slate-950 shrink-0">
                <KeyRound className="w-3.5 h-3.5" /> Sign In
              </Button>
            </div>
          )}

          {/* Authenticated — quick message form */}
          {authed && (
            <Form {...quickMsgForm}>
              <form onSubmit={quickMsgForm.handleSubmit(onSendQuickMsg)} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <FormField
                    control={quickMsgForm.control}
                    name="to"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="+254712345678"
                            disabled={!waConnected}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={quickMsgForm.control}
                    name="message"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-1 sm:row-span-2 flex flex-col">
                        <FormLabel>Message</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Type your message…"
                            className="resize-none flex-1 min-h-[80px]"
                            disabled={!waConnected}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {/* Send button below phone field */}
                  <div className="flex flex-col justify-end">
                    <Button
                      type="submit"
                      disabled={!waConnected || sendQuickMsg.isPending}
                      className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white w-full"
                    >
                      {sendQuickMsg.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                        : <><Send className="w-4 h-4" /> Send Message</>}
                    </Button>
                    {!waConnected && (
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        Connect WhatsApp on the <a href="/system-status" className="underline underline-offset-2 hover:text-foreground">System Status</a> page first.
                      </p>
                    )}
                  </div>
                </div>

                {/* Inline delivery result */}
                {quickMsgResult && (
                  <div
                    className={
                      quickMsgResult.status === "sent"
                        ? "flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                        : "flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-destructive/10 text-destructive"
                    }
                  >
                    {quickMsgResult.status === "sent" ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        Message sent to <strong>{quickMsgResult.to}</strong>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 shrink-0" />
                        {quickMsgResult.error}
                      </>
                    )}
                  </div>
                )}
              </form>
            </Form>
          )}
        </CardContent>
      </Card>

      {/* ── Dispatch Dialog ───────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Dispatch Notification</DialogTitle>
            <DialogDescription>
              Trigger a manual notification using a predefined template.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="contactId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Recipient Contact</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select contact" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {contacts?.map(c => (
                        <SelectItem key={c.id} value={c.id.toString()}>{c.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="templateId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Message Template</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select template" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="STAKEHOLDER_UPDATE">Stakeholder Update</SelectItem>
                      <SelectItem value="OWNER_ALERT">Activity Owner Alert</SelectItem>
                      <SelectItem value="RESOURCE_REQ">Resource Request</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="taskId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Task ID (Optional Context)</FormLabel>
                  <FormControl><Input placeholder="123" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={dispatchMutation.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-950">
                  {dispatchMutation.isPending ? "Sending..." : "Dispatch"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Recent Dispatches ─────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader className="border-b bg-muted/20">
          <CardTitle className="text-lg">Recent Dispatches</CardTitle>
          <CardDescription>Log of all outbound notifications.</CardDescription>
        </CardHeader>
        <div className="divide-y">
          {isLoading ? (
            <div className="p-8 space-y-4">
              {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded animate-pulse"></div>)}
            </div>
          ) : !logs?.length ? (
            <div className="p-12 text-center text-muted-foreground">
              No notifications dispatched yet.
            </div>
          ) : (
            logs.map((log: NotificationLog, i) => {
              const contact = contacts?.find(c => c.id === log.contactId);
              return (
                <div key={log.id} className={`p-4 flex items-center justify-between hover:bg-muted/30 transition-colors stagger-${(i % 5) + 1}`}>
                  <div className="flex items-start gap-4">
                    <div className="mt-1 w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                      <ChannelIcon type={log.channelType} className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{contact?.fullName || `Contact #${log.contactId}`}</span>
                        <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{log.templateId}</span>
                      </div>
                      <p className="text-sm font-medium text-foreground">{log.subject}</p>
                      <p className="text-xs text-muted-foreground max-w-2xl truncate">{log.body}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatRelativeDate(log.sentAt)}</span>
                        <span>via {log.channelType} to {log.channelValue}</span>
                        {log.taskId && <span>Task #{log.taskId}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge status={log.status} />
                    {log.channelType === "whatsapp" && log.status === "sent" && (
                      <DeliveryReceiptTick deliveryStatus={log.deliveryStatus} />
                    )}
                    {log.errorMessage && (
                      <span className="text-xs text-destructive max-w-[200px] truncate" title={log.errorMessage}>
                        {log.errorMessage}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}

