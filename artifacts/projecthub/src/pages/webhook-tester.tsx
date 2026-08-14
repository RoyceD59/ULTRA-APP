import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Webhook, Terminal, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getAuthHeaders } from "@/lib/team-auth";

const API = "/api";

const webhookSchema = z.object({
  event: z.string().min(1, "Event name is required"),
  sourcePlatform: z.string().min(1, "Source platform is required"),
  taskData: z.string().refine(val => {
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  }, "Must be valid JSON").optional(),
});

type DispatchResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

async function dispatchTestWebhook(payload: {
  event: string;
  sourcePlatform: string;
  taskData?: unknown;
}): Promise<unknown> {
  const authHeaders = getAuthHeaders();
  if (!authHeaders) throw new Error("Not authenticated");

  const res = await fetch(`${API}/webhook/test-dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as Record<string, unknown>)["error"])
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export default function WebhookTester() {
  const [result, setResult] = useState<DispatchResult | null>(null);

  const dispatchMutation = useMutation({
    mutationFn: dispatchTestWebhook,
    onSuccess: (data) => {
      setResult({ success: true, data });
    },
    onError: (error: unknown) => {
      const msg = error instanceof Error ? error.message : "Failed to dispatch webhook";
      setResult({ success: false, error: msg });
    },
  });

  const form = useForm<z.infer<typeof webhookSchema>>({
    resolver: zodResolver(webhookSchema),
    defaultValues: {
      event: "task.created",
      sourcePlatform: "jira",
      taskData: "{\n  \"title\": \"Update API documentation\",\n  \"description\": \"Sync swagger docs with recent code changes\",\n  \"priority\": \"high\"\n}"
    }
  });

  function onSubmit(values: z.infer<typeof webhookSchema>) {
    let parsedData;
    try {
      if (values.taskData) {
        parsedData = JSON.parse(values.taskData);
      }
    } catch {
      // Handled by validation
    }

    dispatchMutation.mutate({
      event: values.event,
      sourcePlatform: values.sourcePlatform,
      taskData: parsedData,
    });
  }

  return (
    <div className="space-y-8 animate-in-up max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Webhook className="w-8 h-8 text-amber-500" />
          Webhook Ingestion Tester
        </h1>
        <p className="text-muted-foreground mt-1 text-lg">Simulate incoming payloads from external orchestration systems.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
        <div className="md:col-span-3 space-y-6">
          <Card className="border-amber-500/20 shadow-md">
            <CardHeader className="bg-amber-500/5 border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Terminal className="w-5 h-5 text-amber-600" />
                POST /api/webhook/ingest
              </CardTitle>
              <CardDescription>Send a test payload to the active environment. The server signs the request on your behalf.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="sourcePlatform" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Source Platform</FormLabel>
                        <FormControl><Input placeholder="salesforce, jira, etc." {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="event" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Event Name</FormLabel>
                        <FormControl><Input placeholder="task.created" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  
                  <FormField control={form.control} name="taskData" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Task Data (JSON payload)</FormLabel>
                      <FormControl>
                        <Textarea 
                          className="font-mono text-sm min-h-[200px] bg-slate-950 text-slate-200 border-slate-800" 
                          {...field} 
                        />
                      </FormControl>
                      <FormDescription>Valid JSON object mapping to task properties.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  
                  <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold gap-2" disabled={dispatchMutation.isPending}>
                    {dispatchMutation.isPending ? "Transmitting..." : "Send Payload"} <ArrowRight className="w-4 h-4" />
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2 space-y-6">
          <Card className="shadow-sm h-full flex flex-col">
            <CardHeader className="bg-muted/30 border-b">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Response</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 flex-1 bg-slate-950 rounded-b-lg p-0 overflow-hidden border-t-0">
              <div className="p-4 h-full font-mono text-xs overflow-auto">
                {!result ? (
                  <span className="text-slate-600">Waiting for transmission...</span>
                ) : (
                  <div className="space-y-4 animate-in-up">
                    <div className={`flex items-center gap-2 ${result.success ? "text-emerald-400" : "text-destructive"}`}>
                      {result.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      <span className="font-bold text-sm">HTTP {result.success ? "200 OK" : "Error"}</span>
                    </div>
                    <pre className="text-slate-300 whitespace-pre-wrap break-all">
                      {JSON.stringify(result.success ? result.data : { error: result.error }, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Alert className="bg-muted/50 border-border">
        <Terminal className="h-4 w-4 text-primary" />
        <AlertTitle>Schema Reference</AlertTitle>
        <AlertDescription className="mt-2 text-sm text-muted-foreground space-y-2">
          <p>The <code>taskData</code> object can contain any of the following fields:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><code>title</code> (required) - Name of the task</li>
            <li><code>description</code> - Detailed context</li>
            <li><code>assigneeId</code> - Numeric ID of team member</li>
            <li><code>projectId</code> - Numeric ID of associated project</li>
            <li><code>priority</code> - low, medium, high, urgent</li>
            <li><code>resourceRequired</code> - Boolean flag</li>
            <li><code>notifyVia</code> - e.g. "email,whatsapp"</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
