import { useState, useRef, useCallback } from "react";
import { 
  useListSystemStatus,
  useCreateSystemStatus,
  useUpdateSystemStatus,
  usePingPlatform,
  getListSystemStatusQueryKey
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Activity, Plus, Server, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Clock } from "lucide-react";
import { WhatsAppQrCard } from "@/components/whatsapp-qr-card";
import { formatRelativeDate } from "@/components/shared/badges";

const platformSchema = z.object({
  platform: z.string().min(1, "Platform name is required"),
  notes: z.string().optional(),
});

function StatusIndicator({ status }: { status: string }) {
  if (status === 'connected') {
    return <span className="flex items-center gap-1.5 text-emerald-500 font-medium text-sm"><CheckCircle2 className="w-4 h-4" /> Connected</span>;
  }
  if (status === 'degraded') {
    return <span className="flex items-center gap-1.5 text-amber-500 font-medium text-sm"><AlertTriangle className="w-4 h-4" /> Degraded</span>;
  }
  if (status === 'disconnected') {
    return <span className="flex items-center gap-1.5 text-destructive font-medium text-sm"><XCircle className="w-4 h-4" /> Disconnected</span>;
  }
  return <span className="text-muted-foreground">{status}</span>;
}

export default function SystemStatus() {
  const { data: statuses, isLoading } = useListSystemStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pingingId, setPingingId] = useState<number | null>(null);

  const createPlatform = useCreateSystemStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSystemStatusQueryKey() });
        toast({ title: "Platform added to Watchdog" });
        setDialogOpen(false);
      }
    }
  });

  const pingPlatform = usePingPlatform({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSystemStatusQueryKey() });
        toast({ title: "Heartbeat successful" });
      },
      onSettled: () => {
        setPingingId(null);
      }
    }
  });

  const updatePlatform = useUpdateSystemStatus({
    mutation: {
      onSuccess: () => {
        toast({ title: "Notes updated" });
      }
    }
  });

  const form = useForm<z.infer<typeof platformSchema>>({
    resolver: zodResolver(platformSchema),
    defaultValues: { platform: "", notes: "" }
  });

  function onSubmit(values: z.infer<typeof platformSchema>) {
    createPlatform.mutate({ 
      data: { platform: values.platform, status: "connected", notes: values.notes }
    });
  }

  const handlePing = (id: number) => {
    setPingingId(id);
    pingPlatform.mutate({ id });
  };

  const updateFnRef = useRef(updatePlatform.mutate);
  updateFnRef.current = updatePlatform.mutate;

  const handleNotesBlur = useCallback((id: number, newNotes: string, oldNotes?: string) => {
    if (newNotes !== oldNotes) {
      updateFnRef.current({ id, data: { notes: newNotes } });
    }
  }, []);

  return (
    <div className="space-y-8 animate-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Activity className="w-8 h-8 text-amber-500" />
            System Status Watchdog
          </h1>
          <p className="text-muted-foreground mt-1 text-lg">Monitor connectivity with external orchestration platforms.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2 shadow-sm font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950">
          <Plus className="w-4 h-4" /> Add Platform
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Register Platform</DialogTitle>
            <DialogDescription>
              Add a new external platform to the connectivity watchdog.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="platform" render={({ field }) => (
                <FormItem>
                  <FormLabel>Platform Name</FormLabel>
                  <FormControl><Input placeholder="Jira, Salesforce, etc." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl><Textarea placeholder="Endpoint details..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createPlatform.isPending} className="bg-amber-500 hover:bg-amber-600 text-slate-950">
                  {createPlatform.isPending ? "Adding..." : "Add Platform"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* WhatsApp connection — always shown first */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-2">
        <WhatsAppQrCard />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          [1, 2, 3].map(i => <div key={i} className="h-48 bg-muted rounded-lg animate-pulse"></div>)
        ) : !statuses?.length ? (
           <div className="col-span-full py-12 text-center border-2 border-dashed rounded-lg bg-muted/20">
             <Server className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
             <h3 className="text-lg font-medium text-foreground">No platforms monitored</h3>
             <p className="text-muted-foreground mb-4">Register your first integration endpoint.</p>
             <Button onClick={() => setDialogOpen(true)} variant="outline" className="gap-2 border-amber-500/20 text-amber-600">
               <Plus className="w-4 h-4" /> Add Platform
             </Button>
           </div>
        ) : (
          statuses.map((sys, i) => (
            <Card key={sys.id} className={`stagger-${(i % 5) + 1} overflow-hidden flex flex-col`}>
              <CardHeader className="pb-3 border-b bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-muted-foreground" />
                    {sys.platform}
                  </CardTitle>
                  <StatusIndicator status={sys.status} />
                </div>
              </CardHeader>
              <CardContent className="pt-4 flex-1 flex flex-col">
                <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs block mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Last Checked</span>
                    <span className="font-medium">{formatRelativeDate(sys.lastChecked)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block mb-1 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Last Sync</span>
                    <span className="font-medium">{formatRelativeDate(sys.lastSync)}</span>
                  </div>
                </div>
                
                <div className="mt-auto pt-4 border-t space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1.5 block">Notes</label>
                    <Textarea 
                      defaultValue={sys.notes || ""}
                      onBlur={(e) => handleNotesBlur(sys.id, e.target.value, sys.notes)}
                      className="min-h-[60px] text-sm resize-none bg-muted/30 focus:bg-background border-transparent hover:border-border focus:border-primary transition-colors"
                      placeholder="Add connection notes..."
                    />
                  </div>
                  <Button 
                    variant="outline" 
                    className="w-full gap-2"
                    onClick={() => handlePing(sys.id)}
                    disabled={pingingId === sys.id}
                  >
                    <RefreshCw className={`w-4 h-4 ${pingingId === sys.id ? "animate-spin" : ""}`} />
                    {pingingId === sys.id ? "Pinging..." : "Ping Heartbeat"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
