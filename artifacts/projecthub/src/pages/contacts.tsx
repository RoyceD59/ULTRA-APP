import { useState, useEffect } from "react";
import { 
  useListContacts, 
  useCreateContact, 
  useGetContact,
  useDeleteContact,
  useAddContactMethod,
  useDeleteContactMethod,
  getListContactsQueryKey,
  getGetContactQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Contact as ContactIcon, Plus, MoreVertical, Mail, Phone, MessageCircle, Building2, Trash2, Tag, AtSign, FileSpreadsheet, Link2, RefreshCw, Loader2, Clock, AlertTriangle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, formatDate } from "@/components/shared/badges";
import { apiUrl } from "@/lib/api-base";
import type { Contact, ContactMethod } from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ImportContactsDialog } from "@/components/contacts/ImportContactsDialog";
import { ConnectSheetDialog } from "@/components/contacts/ConnectSheetDialog";
import { ContactEditSection } from "@/components/contacts/ContactEditSection";
import { getAuthHeaders } from "@/lib/team-auth";

const contactSchema = z.object({
  fullName: z.string().min(1, "Name is required"),
  role: z.string().optional(),
  organization: z.string().optional(),
  tags: z.string().optional(),
});

const methodSchema = z.object({
  channelType: z.enum(["email", "whatsapp", "sms"]),
  channelValue: z.string().min(1, "Value is required"),
});

function getTagColor(tag: string) {
  const normalized = tag.toLowerCase().trim();
  if (normalized === 'stakeholder') return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400';
  if (normalized === 'partner') return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400';
  if (normalized === 'lead') return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400';
  if (normalized === 'activity owner' || normalized === 'owner') return 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400';
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400';
}

function ContactMethodIcon({ type, className }: { type: string, className?: string }) {
  if (type === 'email') return <Mail className={className} />;
  if (type === 'whatsapp') return <MessageCircle className={className} />;
  if (type === 'sms') return <Phone className={className} />;
  return <AtSign className={className} />;
}

// ─── Sheet sync status ────────────────────────────────────────────────────────

interface SheetStatus {
  connected: boolean;
  id?: number;
  sheetUrl?: string;
  sheetLabel?: string;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  reconnectRequired?: boolean;
}

function useSheetSyncStatus() {
  const [status, setStatus] = useState<SheetStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const res = await fetch(apiUrl("/contacts/sync/sheets"));
      if (res.ok) {
        const data = await res.json() as SheetStatus;
        setStatus(data);
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return { status, loading, refresh };
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Contacts() {
  const { data: contacts, isLoading } = useListContacts();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [sheetDialogOpen, setSheetDialogOpen] = useState(
    () => new URLSearchParams(window.location.search).get("reconnectGoogle") === "1",
  );
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const { status: sheetStatus, loading: sheetStatusLoading, refresh: refreshSheetStatus } = useSheetSyncStatus();

  const createContact = useCreateContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: "Contact added successfully" });
        setDialogOpen(false);
      }
    }
  });

  const deleteContact = useDeleteContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: "Contact deleted" });
      }
    }
  });

  const form = useForm<z.infer<typeof contactSchema>>({
    resolver: zodResolver(contactSchema),
    defaultValues: { fullName: "", role: "", organization: "", tags: "" }
  });

  function onSubmit(values: z.infer<typeof contactSchema>) {
    const tagsArray = values.tags ? values.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
    createContact.mutate({ 
      data: { 
        fullName: values.fullName, 
        role: values.role || undefined, 
        organization: values.organization || undefined, 
        tags: tagsArray.length > 0 ? tagsArray : undefined
      } 
    });
  }

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this contact?")) {
      deleteContact.mutate({ id });
    }
  };

  const handleNew = () => {
    form.reset({ fullName: "", role: "", organization: "", tags: "" });
    setDialogOpen(true);
  };

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const res = await fetch(apiUrl("/contacts/sync/sheets/run"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getAuthHeaders() ?? {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const result = await res.json() as { created: number; updated: number; skipped: number; failed: number };
      refreshSheetStatus();
      queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
      toast({
        title: "Sync complete",
        description: `${result.created} created, ${result.updated} updated, ${result.skipped} skipped${result.failed > 0 ? `, ${result.failed} failed` : ""}.`,
      });
    } catch (err) {
      void refreshSheetStatus();
      toast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-8 animate-in-up">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <ContactIcon className="w-8 h-8 text-primary" />
            Unified Contact Ledger
          </h1>
          <p className="text-muted-foreground mt-1 text-lg">Central directory for project stakeholders and partners.</p>

          {/* ── Sheet sync status strip ── */}
          {!sheetStatusLoading && sheetStatus?.connected && (
            <>
              <div className="flex items-center gap-3 mt-3 text-sm text-muted-foreground">
                <Link2 className={`w-4 h-4 shrink-0 ${sheetStatus.lastError ? "text-amber-500" : "text-green-600"}`} />
                <span className="truncate max-w-xs">
                  <span className="font-medium text-foreground">
                    {sheetStatus.sheetLabel || "Google Sheet"}
                  </span>{" "}
                  connected
                </span>
                {sheetStatus.lastSyncedAt && !sheetStatus.lastError && (
                  <span className="flex items-center gap-1 text-xs">
                    <Clock className="w-3 h-3" />
                    {new Date(sheetStatus.lastSyncedAt).toLocaleString()}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs px-2"
                  onClick={handleSyncNow}
                  disabled={syncing}
                >
                  {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {syncing ? "Syncing…" : "Sync now"}
                </Button>
              </div>
              {sheetStatus.lastError && (
                <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-amber-800 dark:text-amber-300">
                      {sheetStatus.reconnectRequired ? "Your Google account needs to be reconnected" : "Last sync failed"}
                    </span>
                    {sheetStatus.lastErrorAt && (
                      <span className="text-amber-700 dark:text-amber-400 text-xs ml-2">
                        {new Date(sheetStatus.lastErrorAt).toLocaleString()}
                      </span>
                    )}
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 truncate">
                      {sheetStatus.reconnectRequired ? "Google access was revoked or expired. Reconnect to resume contacts sync." : sheetStatus.lastError}
                    </p>
                    {sheetStatus.reconnectRequired && (
                      <Button data-testid="button-reconnect-google" className="mt-2 gap-2" size="sm" onClick={() => setSheetDialogOpen(true)}>
                        <RefreshCw className="w-4 h-4" /> Reconnect Google account
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Import menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2 font-semibold">
                <FileSpreadsheet className="w-4 h-4" /> Import
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setImportDialogOpen(true)} className="gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Import from Excel / CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSheetDialogOpen(true)} className="gap-2">
                <Link2 className="w-4 h-4" />
                {sheetStatus?.connected ? "Manage Google Sheet sync" : "Connect Google Sheet"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button onClick={handleNew} className="gap-2 shadow-sm font-semibold">
            <Plus className="w-4 h-4" /> Add Contact
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add New Contact</DialogTitle>
            <DialogDescription>
              Register a new stakeholder or team member in the ledger.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input placeholder="Jane Doe" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role (Optional)</FormLabel>
                    <FormControl><Input placeholder="CEO" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="organization" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization</FormLabel>
                    <FormControl><Input placeholder="Acme Corp" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="tags" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tags (Comma separated)</FormLabel>
                  <FormControl><Input placeholder="Stakeholder, Partner" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createContact.isPending}>
                  {createContact.isPending ? "Saving..." : "Save Contact"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ImportContactsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />

      <ConnectSheetDialog
        open={sheetDialogOpen}
        onOpenChange={setSheetDialogOpen}
        syncStatus={sheetStatus}
        onStatusChange={refreshSheetStatus}
      />

      <ContactDetailsSheet 
        key={selectedContactId ?? "closed"}
        contactId={selectedContactId} 
        onClose={() => setSelectedContactId(null)} 
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-40 bg-muted rounded-lg animate-pulse"></div>)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {!contacts?.length && (
            <div className="col-span-full py-12 text-center border-2 border-dashed rounded-lg bg-muted/20">
              <ContactIcon className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground">No contacts yet</h3>
              <p className="text-muted-foreground mb-4">Start by adding your first stakeholder.</p>
              <Button onClick={handleNew} variant="outline" className="gap-2">
                <Plus className="w-4 h-4" /> Add Contact
              </Button>
            </div>
          )}
          {contacts?.map((contact, i) => (
            <Card 
              key={contact.id} 
              className={`stagger-${(i % 5) + 1} overflow-hidden group cursor-pointer hover:shadow-md transition-all hover:border-primary/30`}
              onClick={() => setSelectedContactId(contact.id)}
            >
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="w-12 h-12 border shadow-sm">
                      <AvatarFallback className="bg-primary/10 text-primary font-bold">
                        {getInitials(contact.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-bold text-lg leading-tight group-hover:text-primary transition-colors">
                        {contact.fullName}
                      </h3>
                      {contact.role && (
                        <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          {contact.role}
                        </p>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 text-muted-foreground hover:text-foreground">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem 
                        onClick={(e) => handleDelete(contact.id, e)} 
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                
                {contact.organization && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                    <Building2 className="w-4 h-4" />
                    {contact.organization}
                  </div>
                )}
                
                <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
                  {contact.tags?.map(tag => (
                    <Badge key={tag} variant="outline" className={getTagColor(tag)}>
                      {tag}
                    </Badge>
                  ))}
                  {(!contact.tags || contact.tags.length === 0) && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Tag className="w-3 h-3" /> No tags
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactDetailsSheet({ contactId, onClose }: { contactId: number | null, onClose: () => void }) {
  const { data: contact, isLoading } = useGetContact(contactId!, { query: { enabled: !!contactId, queryKey: getGetContactQueryKey(contactId!) } });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const addMethod = useAddContactMethod({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId!) });
        toast({ title: "Method added" });
        form.reset();
      }
    }
  });

  const deleteMethod = useDeleteContactMethod({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId!) });
        toast({ title: "Method removed" });
      }
    }
  });

  const form = useForm<z.infer<typeof methodSchema>>({
    resolver: zodResolver(methodSchema),
    defaultValues: { channelType: "email", channelValue: "" }
  });

  function onSubmit(values: z.infer<typeof methodSchema>) {
    if (!contactId) return;
    addMethod.mutate({
      id: contactId,
      data: { channelType: values.channelType, channelValue: values.channelValue, isPreferred: false }
    });
  }

  return (
    <Sheet open={!!contactId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col h-full bg-background border-l">
        {isLoading || !contact ? (
          <div className="p-6 space-y-4">
            <div className="h-8 w-48 bg-muted animate-pulse rounded"></div>
            <div className="h-4 w-32 bg-muted animate-pulse rounded"></div>
          </div>
        ) : (
          <>
            <SheetHeader className="p-6 border-b bg-muted/20">
              <div className="flex items-center gap-4">
                <Avatar className="w-16 h-16 border-2 shadow-sm">
                  <AvatarFallback className="bg-primary/10 text-primary font-bold text-xl">
                    {getInitials(contact.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <SheetTitle className="text-2xl">{contact.fullName}</SheetTitle>
                  <SheetDescription className="mt-1 flex items-center gap-2">
                    {contact.role && <span>{contact.role}</span>}
                    {contact.role && contact.organization && <span>•</span>}
                    {contact.organization && <span className="font-medium text-foreground">{contact.organization}</span>}
                  </SheetDescription>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {contact.tags?.map(tag => (
                  <Badge key={tag} variant="outline" className={getTagColor(tag)}>{tag}</Badge>
                ))}
              </div>
            </SheetHeader>

            <ScrollArea className="flex-1 p-6">
              <div className="space-y-6">
                <ContactEditSection contact={contact} />
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Communication Methods</h3>
                  <div className="space-y-3">
                    {!contact.methods?.length && (
                      <p className="text-sm text-muted-foreground italic">No communication methods configured.</p>
                    )}
                    {contact.methods?.map((method: ContactMethod) => (
                      <div key={method.id} className="flex items-center justify-between p-3 rounded-md border bg-card shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                            <ContactMethodIcon type={method.channelType} className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase">{method.channelType}</p>
                            <p className="text-sm font-medium">{method.channelValue}</p>
                          </div>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => deleteMethod.mutate({ id: contact.id, methodId: method.id })}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Add New Method</h3>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <FormField control={form.control} name="channelType" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Channel Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="whatsapp">WhatsApp</SelectItem>
                              <SelectItem value="sms">SMS</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="channelValue" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Value (Email or Phone Number)</FormLabel>
                          <FormControl><Input placeholder="+1234567890" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <Button type="submit" className="w-full" disabled={addMethod.isPending}>
                        {addMethod.isPending ? "Adding..." : "Add Method"}
                      </Button>
                    </form>
                  </Form>
                </div>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
