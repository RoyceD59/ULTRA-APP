import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Radio, Loader2, Bot, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAuthHeaders } from "@/lib/team-auth";
import { Task } from "@workspace/api-client-react";
import { API_ORIGIN } from "@/lib/api-base";

const BASE = API_ORIGIN;

interface Agent {
  id: number;
  name: string;
  role: string;
  status: string;
}

interface PushTaskDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function PushTaskDialog({ task, open, onOpenChange, onSuccess }: PushTaskDialogProps) {
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentLoadError, setAgentLoadError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [pushing, setPushing] = useState(false);

  // Fetch agent list when dialog opens
  useEffect(() => {
    if (!open) return;
    setLoadingAgents(true);
    setAgentLoadError(null);

    const authHeaders = getAuthHeaders() ?? {};
    fetch(`${BASE}/api/ai/agents`, { headers: authHeaders })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Server returned ${r.status}`);
        }
        return r.json() as Promise<Agent[]>;
      })
      .then((data) => {
        setAgents(data);
        if (data.length > 0) {
          setSelectedAgent((prev) => prev ?? data[0]);
        }
      })
      .catch((err: unknown) => {
        setAgentLoadError(err instanceof Error ? err.message : "Failed to load agents");
        setAgents([]);
      })
      .finally(() => setLoadingAgents(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handlePush() {
    if (!selectedAgent) return;
    setPushing(true);
    try {
      const authHeaders = getAuthHeaders() ?? {};
      const res = await fetch(`${BASE}/api/ai/push-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          taskId: task.id,
          agentId: selectedAgent.id,
          agentName: selectedAgent.name,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Push failed");
      toast({
        title: "Task dispatched",
        description: `"${task.title}" sent to ${selectedAgent.name}.`,
      });
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Dispatch failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPushing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            Push Task to Agent
          </DialogTitle>
          <DialogDescription>
            Send <span className="font-medium text-foreground">"{task.title}"</span> to an agent
            worker via the orchestrator webhook.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Select target agent
          </p>

          {loadingAgents ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading agents…
            </div>
          ) : agentLoadError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{agentLoadError}</span>
            </div>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No agents available.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    selectedAgent?.id === agent.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Bot className="w-3 h-3" />
                    <span className="font-medium">{agent.name}</span>
                  </div>
                  <p className="text-xs opacity-70 capitalize">{agent.role.replace(/_/g, " ")}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pushing}>
            Cancel
          </Button>
          <Button
            onClick={handlePush}
            disabled={pushing || !selectedAgent || loadingAgents || !!agentLoadError}
            className="gap-2"
          >
            {pushing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Radio className="w-4 h-4" />
            )}
            {pushing ? "Sending…" : "Push to Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
