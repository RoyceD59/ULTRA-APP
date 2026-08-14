/**
 * Alison Feedback Review — ProjectHub admin page
 *
 * Displays customer thumbs-up / thumbs-down ratings collected by the Alison AI
 * chat (GET /api/uc/ai/chat-feedback — admin-only, requires a valid admin JWT).
 *
 * The team uses this to spot recurring knowledge gaps and improve her prompts.
 *
 * Features:
 *  - Protected by the standard ProjectHub team JWT (same login used everywhere)
 *  - 7-day stats (server-computed from the full log, not the paged slice)
 *  - Topic breakdown: client-side keyword frequency on thumbs-down questions
 *  - Most-flagged question card (highest repeat question in thumbs-down set)
 *  - Filter tabs: Unhelpful / Helpful / All with live counts
 *  - Expand / collapse full answer text per entry
 *  - Auto-refresh every 60 s; manual refresh button
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  ThumbsUp, ThumbsDown, RefreshCw, MessageSquare,
  ChevronDown, ChevronUp, Bot, AlertCircle, LogOut,
  BarChart2, Flag, Download, X, RotateCcw, Search, Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTeamToken, clearTeamAuth, handleUnauthorizedResponse } from '@/lib/team-auth';

const BASE             = import.meta.env.BASE_URL.replace(/\/$/, '');
const AUTO_REFRESH_MS  = 60_000;

// ── TopicBreakdown component ──────────────────────────────────────────────────
// Fetches server-computed keyword frequencies across ALL thumbs-down entries
// (not just the current page) from GET /api/uc/ai/chat-feedback/topics.

interface TopicData {
  keywords:    [string, number][];
  totalDown:   number;
  mostFlagged: { question: string; count: number } | null;
}

function TopicBreakdown({
  token,
  activeKeyword,
  onKeywordClick,
}: {
  token: string;
  activeKeyword: string | null;
  onKeywordClick: (word: string) => void;
}) {
  const [topics,     setTopics]     = useState<TopicData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [fetchKey,   setFetchKey]   = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // recomputing=true means the user clicked the button; pass ?force=1 to bypass the server cache
    const url = recomputing
      ? `${BASE}/api/uc/ai/chat-feedback/topics?force=1`
      : `${BASE}/api/uc/ai/chat-feedback/topics`;
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() as Promise<TopicData> : Promise.reject(r.status))
      .then(d => { if (!cancelled) { setTopics(d); setLoading(false); setRecomputing(false); } })
      .catch(() => { if (!cancelled) { setLoading(false); setRecomputing(false); } });
    return () => { cancelled = true; };
  }, [token, fetchKey]); // recomputing is read inside effect; fetchKey change triggers it

  function handleRecompute() {
    setRecomputing(true);
    setFetchKey(k => k + 1);
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-48 bg-muted rounded-lg animate-pulse" />
        <div className="h-48 bg-muted rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!topics || topics.totalDown === 0) return null;

  const { keywords, totalDown, mostFlagged } = topics;
  const maxCount = keywords[0]?.[1] ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart2 className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold tracking-tight">Topic breakdown</h2>
        <span className="text-xs text-muted-foreground ml-1">
          — keywords from {totalDown} unhelpful {totalDown === 1 ? 'question' : 'questions'} (full history)
        </span>
        <button
          onClick={handleRecompute}
          disabled={recomputing}
          title="Recompute topics from latest data"
          className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw className={cn('w-3.5 h-3.5', recomputing && 'animate-spin')} />
          {recomputing ? 'Recomputing…' : 'Recompute'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Keyword frequency bar chart */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Most common words in thumbs-down questions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 pb-4">
            {keywords.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Not enough text to extract keywords yet.
              </p>
            ) : (
              keywords.map(([word, count]) => {
                const isActive = activeKeyword === word;
                return (
                  <button
                    key={word}
                    onClick={() => onKeywordClick(word)}
                    title={`Filter entries by "${word}"`}
                    className={cn(
                      'flex items-center gap-3 w-full rounded px-1 py-0.5 transition-colors',
                      isActive
                        ? 'bg-destructive/15 ring-1 ring-destructive/40'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <span className={cn(
                      'w-24 text-xs font-mono truncate flex-shrink-0 text-left',
                      isActive ? 'text-destructive font-semibold' : 'text-foreground',
                    )}>
                      {word}
                    </span>
                    <div className="flex-1 h-5 bg-muted rounded-sm overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-sm transition-all duration-300',
                          isActive ? 'bg-destructive' : 'bg-destructive/70',
                        )}
                        style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-6 text-right flex-shrink-0">
                      {count}
                    </span>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Most-flagged question */}
        <Card className={mostFlagged ? 'shadow-sm border-destructive/30 bg-destructive/5' : 'shadow-sm border-dashed'}>
          <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
            <Flag className="w-4 h-4 text-destructive flex-shrink-0" />
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Most-repeated unhelpful question
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {mostFlagged ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground leading-snug">
                  "{mostFlagged.question}"
                </p>
                <Badge variant="destructive" className="text-xs">
                  Asked {mostFlagged.count}× and rated unhelpful
                </Badge>
                <p className="text-xs text-muted-foreground">
                  Prioritise improving Alison's answer to this question.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
                <Flag className="w-6 h-6 opacity-25" />
                <p className="text-xs text-center">
                  No question has been rated unhelpful more than once yet.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeedbackEntry {
  id?:              number | null;
  ts:               string;
  rating:           'up' | 'down';
  question:         string;
  answer:           string;
  improvementNote?: string | null;
}

const NOTE_MAX = 250;

interface FeedbackResponse {
  totalInLog: number;
  weekStats:  { total: number; up: number; down: number };
  count:      number;
  items:      FeedbackEntry[];
  keyword:    string | null;
}

type Filter = 'all' | 'down' | 'up';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function absTime(ts: string): string {
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Entry card ────────────────────────────────────────────────────────────────

/**
 * Splits `text` on any of the provided `keywords` (case-insensitive) and
 * returns an array of React nodes where every match is wrapped in a
 * highlighted <mark> span.  Accepts multiple terms so both the keyword-chip
 * filter and the free-text search box can highlight simultaneously.
 */
function HighlightedText({ text, keywords }: { text: string; keywords: string[] }) {
  const active = keywords.filter(Boolean);
  if (!active.length || !text) return <>{text}</>;
  const pattern = active
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-amber-200/80 text-amber-900 font-semibold rounded-sm px-0.5 not-italic"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function EntryCard({
  entry, token, highlights,
}: { entry: FeedbackEntry; token: string; highlights?: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const isDown = entry.rating === 'down';

  // Improvement suggestion editor — 250-char team note, saved per entry
  const [noteOpen,  setNoteOpen]  = useState(false);
  const [note,      setNote]      = useState(entry.improvementNote ?? '');
  const [savedNote, setSavedNote] = useState(entry.improvementNote ?? '');
  const [saving,    setSaving]    = useState(false);
  const [noteError, setNoteError] = useState('');
  const canEditNote = entry.id != null;

  // Keep the editor in sync with refreshed server data (60 s auto-refresh /
  // manual refresh) — but never clobber a draft the user is mid-editing.
  // savedRef mirrors the last value we know the server holds.
  const savedRef = useRef(entry.improvementNote ?? '');
  useEffect(() => {
    const serverNote = entry.improvementNote ?? '';
    if (serverNote === savedRef.current) return;
    // Only replace the draft when it is clean (equals the last-known saved value)
    setNote(prev => (prev === savedRef.current ? serverNote : prev));
    savedRef.current = serverNote;
    setSavedNote(serverNote);
  }, [entry.improvementNote]);

  async function saveNote() {
    if (entry.id == null) return;
    setSaving(true);
    setNoteError('');
    try {
      const res = await fetch(`${BASE}/api/uc/ai/chat-feedback/${entry.id}/note`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ note: note.trim() }),
      });
      if (res.status === 401 || res.status === 403) {
        handleUnauthorizedResponse();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const trimmed = note.trim();
      savedRef.current = trimmed;
      setSavedNote(trimmed);
      setNote(trimmed);
      if (!trimmed) setNoteOpen(false);
    } catch {
      setNoteError('Could not save — try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className={cn(
      'transition-shadow hover:shadow-md',
      isDown ? 'border-l-4 border-l-destructive/60' : 'border-l-4 border-l-green-500/60',
    )}>
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex items-start gap-2 min-w-0">
          {isDown
            ? <ThumbsDown className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            : <ThumbsUp   className="w-4 h-4 text-green-500  flex-shrink-0 mt-0.5" />
          }
          <p className="text-sm font-medium text-foreground leading-snug">
            {entry.question
              ? (highlights && highlights.length > 0)
                ? <HighlightedText text={entry.question} keywords={highlights} />
                : entry.question
              : <em className="text-muted-foreground font-normal">No question recorded</em>
            }
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge
            variant={isDown ? 'destructive' : 'outline'}
            className={cn('text-xs', !isDown && 'border-green-500 text-green-600')}
          >
            {isDown ? 'Unhelpful' : 'Helpful'}
          </Badge>
          <span
            className="text-xs text-muted-foreground whitespace-nowrap"
            title={absTime(entry.ts)}
          >
            {relTime(entry.ts)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-2">
        <div className="bg-muted/40 rounded-md p-3 text-sm text-muted-foreground leading-relaxed">
          {expanded
            ? entry.answer
            : `${entry.answer.slice(0, 220)}${entry.answer.length > 220 ? '…' : ''}`
          }
        </div>
        {entry.answer.length > 220 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {expanded
              ? <><ChevronUp   className="w-3 h-3" /> Show less</>
              : <><ChevronDown className="w-3 h-3" /> Show full answer</>
            }
          </button>
        )}

        {/* Team improvement suggestion — 250-char note saved per entry */}
        {canEditNote && (
          (noteOpen || savedNote) ? (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                Team improvement suggestion
              </div>
              <Textarea
                value={note}
                maxLength={NOTE_MAX}
                onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))}
                placeholder="How should Alison answer this better?"
                className="text-sm min-h-[60px] resize-none"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  'text-xs',
                  note.length >= NOTE_MAX ? 'text-destructive font-medium' : 'text-muted-foreground',
                )}>
                  {note.length}/{NOTE_MAX}
                </span>
                {noteError && <span className="text-xs text-destructive">{noteError}</span>}
                <div className="ml-auto flex items-center gap-2">
                  {savedNote && (
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 text-xs text-muted-foreground"
                      disabled={saving}
                      onClick={() => { setNote(''); }}
                      title="Clear the text, then Save to remove the suggestion"
                    >
                      Clear
                    </Button>
                  )}
                  <Button
                    variant="outline" size="sm"
                    className="h-7 text-xs"
                    disabled={saving || note.trim() === savedNote}
                    onClick={saveNote}
                  >
                    {saving ? 'Saving…' : 'Save suggestion'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setNoteOpen(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors pt-1"
            >
              <Lightbulb className="w-3.5 h-3.5" />
              Add improvement suggestion
            </button>
          )
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AlisonFeedbackPage() {
  const [token,          setToken]          = useState<string | null>(getTeamToken);
  const [data,           setData]           = useState<FeedbackResponse | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');
  const [filter,         setFilter]         = useState<Filter>('down');
  const [keywordFilter,  setKeywordFilter]  = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('keyword') || null;
  });
  const [exporting,      setExporting]      = useState(false);
  const [searchQuery,    setSearchQuery]    = useState('');

  // Keep ?keyword= query param in sync so filtered views are bookmarkable / shareable
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    const url = new URL(window.location.href);
    if (keywordFilter) {
      url.searchParams.set('keyword', keywordFilter);
    } else {
      url.searchParams.delete('keyword');
    }
    window.history.replaceState(null, '', url.toString());
  }, [keywordFilter]);

  const load = useCallback(async (
    silent  = false,
    tok     = token,
    kw?: string | null,               // undefined = use current keywordFilter; null = cleared
  ) => {
    if (!tok) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const activeKw = kw !== undefined ? kw : keywordFilter;
      if (activeKw) params.set('keyword', activeKw);
      const res = await fetch(`${BASE}/api/uc/ai/chat-feedback?${params}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.status === 403 || res.status === 401) {
        handleUnauthorizedResponse();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as FeedbackResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feedback');
    } finally {
      setLoading(false);
    }
  }, [token, keywordFilter]);

  useEffect(() => {
    if (!token) return;
    load();
    const id = setInterval(() => load(true), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [token, load]);

  function handleSignOut() {
    clearTeamAuth();
    setToken(null);
  }

  async function downloadCsv() {
    if (!token) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filter === 'up' || filter === 'down') params.set('rating', filter);
      const res = await fetch(`${BASE}/api/uc/ai/chat-feedback/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        handleUnauthorizedResponse();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob    = await res.blob();
      const dateStr = new Date().toISOString().slice(0, 10);
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement('a');
      a.href        = url;
      a.download    = `alison-feedback-${dateStr}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const all        = data?.items ?? [];
  const ws         = data?.weekStats ?? { total: 0, up: 0, down: 0 };
  const pct        = ws.total > 0 ? Math.round((ws.up / ws.total) * 100) : null;
  const downEntries = all.filter(e => e.rating === 'down');

  // Server already filters by keyword and returns only the requested rating slice.
  // We apply the rating tab filter client-side only to the server-returned slice
  // (the server doesn't paginate when keyword is active so all matches are present).
  const byTab = filter === 'all' ? all : all.filter(e => e.rating === filter);

  // Client-side free-text search (AND with keywordFilter chip)
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const shown = normalizedSearch
    ? byTab.filter(e =>
        e.question.toLowerCase().includes(normalizedSearch) ||
        e.answer.toLowerCase().includes(normalizedSearch),
      )
    : byTab;

  const tabCounts = {
    down: downEntries.length,
    up:   all.filter(e => e.rating === 'up').length,
    all:  all.length,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 animate-in-up">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Bot className="w-7 h-7 text-primary" />
            Alison Feedback
          </h1>
          <p className="text-muted-foreground mt-1">
            Customer ratings on Alison's answers — use these to improve her knowledge and prompts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => load()} disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={downloadCsv}
            disabled={exporting || !data}
            className="gap-2"
            title={filter === 'all' ? 'Download all feedback as CSV' : `Download ${filter === 'down' ? 'unhelpful' : 'helpful'} feedback as CSV`}
          >
            <Download className={cn('w-4 h-4', exporting && 'animate-pulse')} />
            {exporting ? 'Exporting…' : 'Download CSV'}
          </Button>
          <Button
            variant="ghost" size="sm"
            onClick={handleSignOut}
            className="gap-2 text-muted-foreground"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>
      </div>

      {/* 7-day headline — server-side weekStats over the FULL log */}
      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-28 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <p className="text-sm font-medium text-muted-foreground">Ratings (last 7 days)</p>
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{ws.total}</div>
              <p className="text-xs text-muted-foreground mt-1">{data?.totalInLog ?? 0} total in log</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-green-500/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <p className="text-sm font-medium text-muted-foreground">Helpful (7 days)</p>
              <ThumbsUp className="w-4 h-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">{ws.up}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {pct !== null ? `${pct}% satisfaction rate` : 'No ratings yet'}
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-destructive/20 bg-destructive/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <p className="text-sm font-medium text-muted-foreground">Unhelpful (7 days)</p>
              <ThumbsDown className="w-4 h-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">{ws.down}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {ws.down > 0 ? 'Review below to spot patterns' : 'None flagged this week'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Topic breakdown — server-computed across full history, shown once data loads */}
      {!loading && data && token && (
        <TopicBreakdown
          token={token}
          activeKeyword={keywordFilter}
          onKeywordClick={word => {
            // Toggle: clicking the active keyword clears it; either way reload from server
            const next = keywordFilter === word ? null : word;
            setKeywordFilter(next);
            load(false, token, next);
          }}
        />
      )}

      {/* Filter tabs + list */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {([
            { key: 'down', label: 'Unhelpful' },
            { key: 'up',   label: 'Helpful'   },
            { key: 'all',  label: 'All'        },
          ] as { key: Filter; label: string }[]).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setFilter(tab.key); setSearchQuery(''); load(false, token, keywordFilter); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                filter === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              {tab.label}
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded-full',
                filter === tab.key
                  ? 'bg-primary-foreground/20 text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}>
                {tabCounts[tab.key]}
              </span>
            </button>
          ))}

          {/* Free-text search box */}
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              placeholder="Search entries…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-8 h-8 w-48 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Active keyword filter chip */}
        {keywordFilter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Filtered by:</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/15 text-destructive text-xs font-medium ring-1 ring-destructive/30">
              {keywordFilter}
              <button
                onClick={() => { setKeywordFilter(null); load(false, token, null); }}
                className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5 transition-colors"
                aria-label="Clear keyword filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
            <span className="text-xs text-muted-foreground">
              — {shown.length} {shown.length === 1 ? 'entry' : 'entries'} match
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {!loading && shown.length === 0 && !error && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Bot className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">
                {normalizedSearch
                  ? `No ${filter === 'down' ? 'unhelpful' : filter === 'up' ? 'helpful' : ''} entries match "${searchQuery}"${keywordFilter ? ` + "${keywordFilter}"` : ''}.`
                  : keywordFilter
                    ? `No ${filter === 'down' ? 'unhelpful' : filter === 'up' ? 'helpful' : ''} entries contain "${keywordFilter}".`
                    : filter === 'down'
                      ? 'No unhelpful ratings yet — Alison is doing well!'
                      : filter === 'up'
                        ? 'No helpful ratings recorded yet.'
                        : 'No feedback recorded yet.'}
              </p>
              <p className="text-xs">
                {normalizedSearch || keywordFilter
                  ? 'Try a different search term or clear the filters to see all entries.'
                  : 'Ratings appear here as customers use the Alison chat.'}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {shown.map((entry, i) => (
            <EntryCard
              key={entry.id != null ? `fb-${entry.id}` : `${entry.ts}-${i}`}
              entry={entry}
              token={token ?? ''}
              highlights={[keywordFilter, normalizedSearch].filter(Boolean) as string[]}
            />
          ))}
        </div>

        {shown.length > 0 && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            Showing {shown.length}{normalizedSearch ? ` matched` : ''} of {data?.count ?? 0} entr{(data?.count ?? 0) === 1 ? 'y' : 'ies'}
            {' '}· 7-day stats computed over full log of {data?.totalInLog ?? 0}
            {' '}· Auto-refreshes every minute
          </p>
        )}
      </div>
    </div>
  );
}
