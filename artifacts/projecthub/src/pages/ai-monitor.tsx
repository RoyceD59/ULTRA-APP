import { useState, useRef, useEffect } from 'react';
import { Bot, RefreshCw, Send, Zap, AlertTriangle, CheckCircle2, Loader2, Radio, Network } from 'lucide-react';
import { useGetAiReport, useGenerateAiReport, usePushToOrchestrator } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
}

interface Agent {
  id: number;
  name: string;
  role: string;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTs(d: Date | string) {
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ─── AI Report panel ─────────────────────────────────────────────────────────
function ReportPanel() {
  const { data: report, isLoading, refetch } = useGetAiReport();
  const { mutate: generate, isPending: generating } = useGenerateAiReport();
  const { mutate: push, isPending: pushing, data: pushResult } = usePushToOrchestrator();
  const busy = isLoading || generating;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Status Report</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={pushing} onClick={() => push()} className="gap-1.5 text-xs">
            {pushing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radio className="w-3 h-3" />}
            Push to Orchestrator
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => generate(undefined, { onSuccess: () => refetch() })} className="gap-1.5 text-xs">
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </Button>
        </div>
      </div>

      {pushResult && (
        <div className={cn('rounded-lg border px-4 py-3 text-sm flex items-start gap-2',
          pushResult.success
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
            : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
        )}>
          {pushResult.success ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <span>{pushResult.message}</span>
        </div>
      )}

      {busy && !report ? (
        <div className="rounded-xl border bg-muted/40 p-8 flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">Analysing project data with Claude…</p>
        </div>
      ) : report ? (
        <div className="space-y-4">
          <div className="rounded-xl border bg-primary/5 border-primary/20 p-5">
            <p className="text-sm leading-relaxed text-foreground">{report.summary}</p>
            <p className="text-xs text-muted-foreground mt-3">Generated {formatTs(report.generatedAt)}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border bg-emerald-50/50 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-800/40 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Highlights</span>
              </div>
              {report.highlights.length === 0 ? <p className="text-xs text-muted-foreground">None yet</p> : (
                <ul className="space-y-2">
                  {report.highlights.map((h, i) => (
                    <li key={i} className="text-sm text-foreground flex gap-2">
                      <span className="text-emerald-500 flex-shrink-0 mt-0.5">•</span>{h}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border bg-amber-50/50 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-800/40 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Risks & Blockers</span>
              </div>
              {report.risks.length === 0 ? <p className="text-sm text-emerald-600 dark:text-emerald-400">No risks flagged</p> : (
                <ul className="space-y-2">
                  {report.risks.map((r, i) => (
                    <li key={i} className="text-sm text-foreground flex gap-2">
                      <span className="text-amber-500 flex-shrink-0 mt-0.5">•</span>{r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Chat panel ───────────────────────────────────────────────────────────────
function ChatPanel() {
  const [messages, setMessages] = useState<ChatMsg[]>([{
    id: '0', role: 'assistant',
    content: "Hi — I'm the ProjectHub AI monitor powered by Claude. Ask me anything about the Team-AI-Embedded project: tasks, agent progress, deadlines, or blockers.",
  }]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const convIdRef = useRef<number | null>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function ensureConversation(): Promise<number> {
    if (convIdRef.current !== null) return convIdRef.current;
    const res = await fetch(`${BASE}/api/anthropic/conversations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'ProjectHub Monitor Chat' }),
    });
    const data = await res.json();
    convIdRef.current = data.id as number;
    return data.id as number;
  }

  async function send() {
    const q = input.trim();
    if (!q || streaming) return;
    setInput('');
    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'user', content: q };
    const assistantMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, userMsg, { id: assistantMsgId, role: 'assistant', content: '', loading: true }]);
    setStreaming(true);
    try {
      const convId = await ensureConversation();
      const res = await fetch(`${BASE}/api/anthropic/conversations/${convId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: q }),
      });
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value, { stream: true }).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.done) break;
          if (payload.content) {
            accumulated += payload.content;
            setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: accumulated, loading: false } : m));
          }
        }
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: 'Something went wrong. Please try again.', loading: false } : m));
    } finally { setStreaming(false); }
  }

  return (
    <div className="flex flex-col h-[480px]">
      <h2 className="text-base font-semibold text-foreground mb-4">Ask the AI Monitor</h2>
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-4">
        {messages.map(msg => (
          <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className={cn('max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
              msg.role === 'user' ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-muted text-foreground rounded-tl-sm'
            )}>
              {msg.loading ? <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Thinking…</span>
                : <span className="whitespace-pre-wrap">{msg.content}</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <input type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask about tasks, agents, deadlines…"
          disabled={streaming}
          className="flex-1 rounded-xl border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 transition"
        />
        <Button size="sm" onClick={send} disabled={streaming || !input.trim()} className="px-3 rounded-xl">
          {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

// ─── Sub-agent verification panel ────────────────────────────────────────────
const KNOWN_AGENTS: Agent[] = [
  { id: 1, name: 'Orchestrator',  role: 'orchestrator',  status: 'active' },
  { id: 2, name: 'Product Data',  role: 'product_data',  status: 'active' },
  { id: 3, name: 'SEO',           role: 'seo',           status: 'active' },
  { id: 4, name: 'Content',       role: 'content',       status: 'active' },
  { id: 5, name: 'CRO',           role: 'cro',           status: 'active' },
  { id: 6, name: 'Support',       role: 'support',       status: 'active' },
  { id: 7, name: 'Inventory',     role: 'inventory',     status: 'active' },
  { id: 8, name: 'Analytics',     role: 'analytics',     status: 'active' },
];

function AgentVerificationPanel() {
  const [selectedAgent, setSelectedAgent] = useState<Agent>(KNOWN_AGENTS[0]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ answer: string; agentName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function query() {
    if (!question.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/ai/agent-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selectedAgent.id, agentName: selectedAgent.name, question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Query failed');
      setResult({ answer: data.answer, agentName: data.agentName ?? selectedAgent.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Network className="w-4 h-4 text-primary" />
        <h2 className="text-base font-semibold text-foreground">Agent Verification</h2>
        <span className="ml-auto text-xs text-muted-foreground">Query Team-AI-Embedded agents directly</span>
      </div>

      {/* Agent selector */}
      <div className="grid grid-cols-4 gap-2">
        {KNOWN_AGENTS.map(agent => (
          <button
            key={agent.id}
            onClick={() => { setSelectedAgent(agent); setResult(null); setError(null); }}
            className={cn(
              'rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors',
              selectedAgent.id === agent.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground'
            )}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className={cn('w-1.5 h-1.5 rounded-full', agent.id === 1 ? 'bg-emerald-500' : 'bg-blue-400')} />
              {agent.id === 1 ? 'Lead' : ''}
            </div>
            {agent.name}
          </button>
        ))}
      </div>

      {/* Question input */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Querying <span className="font-medium text-foreground">{selectedAgent.name}</span>
          {selectedAgent.id === 1 ? ' — Lead Orchestrator' : ' — Sub-agent'}
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && query()}
            placeholder={selectedAgent.id === 1
              ? 'Ask the Orchestrator anything…'
              : `Ask the ${selectedAgent.name} agent to verify something…`}
            disabled={loading}
            className="flex-1 rounded-xl border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 transition"
          />
          <Button size="sm" onClick={query} disabled={loading || !question.trim()} className="px-3 rounded-xl">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Result */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-400 flex gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium mb-1">Could not reach {selectedAgent.name}</p>
            <p className="text-xs opacity-80">{error}</p>
            <p className="text-xs opacity-60 mt-1">Complete the Team-Horizon <code>/api/external/agent-query</code> endpoint to enable this.</p>
          </div>
        </div>
      )}
      {result && (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bot className="w-3 h-3" />
            <span className="font-medium text-foreground">{result.agentName}</span> responded
          </div>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{result.answer}</p>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AiMonitor() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">AI Monitor</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live link between ProjectHub and Team-AI-Embedded.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-full px-3 py-1">
          <Zap className="w-3 h-3" />
          Claude Sonnet live
        </div>
      </div>

      {/* Report + Chat */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <ReportPanel />
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <ChatPanel />
        </div>
      </div>

      {/* Agent Verification */}
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <AgentVerificationPanel />
      </div>

      {/* Integration reference */}
      <div className="rounded-xl border bg-muted/30 p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Team-AI-Embedded Integration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[
            { label: 'Inbound from Orchestrator', value: 'POST /api/ai/query', desc: 'Orchestrator sends a question; ProjectHub answers with live task data' },
            { label: 'Outbound report push',       value: 'POST /webhook/projecthub', desc: 'ProjectHub pushes status reports to Team-Horizon Orchestrator' },
            { label: 'Agent verification',         value: 'POST /api/external/agent-query', desc: 'Query any of the 8 agents for verification (add to Team-Horizon)' },
            { label: 'Scheduled push',             value: 'Daily 08:00 UTC', desc: 'Automatic daily summary pushed to Team-Horizon Orchestrator' },
          ].map(item => (
            <div key={item.label} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{item.label}</p>
              <code className="text-xs font-mono bg-background border rounded px-2 py-0.5 text-primary">{item.value}</code>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
