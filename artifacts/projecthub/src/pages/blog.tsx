import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowDownToLine, ArrowLeft, BookOpen, Check, ChevronRight, Clock3,
  FileText, Globe2, History, Loader2, Newspaper, Plus, RefreshCw, Save, Search,
  Send, Sparkles, Upload, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, refreshTeamUser } from "@/lib/team-auth";

type SourceLink = { url: string; title?: string };
type PublishedSnapshot = {
  title: string;
  summary: string;
  content: string;
  category: string;
  sources: SourceLink[];
};
type Article = {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  status: string;
  origin: string;
  rationale: string;
  rejectionFeedback: string;
  sources: SourceLink[];
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  publishedSnapshot?: PublishedSnapshot;
  version?: number;
};
type ArticleHistory = Record<string, unknown>;
type BlogRun = Record<string, unknown>;
type ArticleForm = Omit<Article, "id" | "createdAt" | "updatedAt" | "publishedAt" | "publishedSnapshot" | "version" | "status">;

const BLANK_FORM: ArticleForm = {
  title: "", summary: "", content: "", category: "Water education",
  origin: "human", rationale: "", rejectionFeedback: "", sources: [],
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", pending_review: "Needs review", in_review: "In review",
  published: "Published", rejected: "Needs changes", unpublished: "Unpublished",
  failed: "Failed",
};

function normalizeSources(value: unknown): SourceLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SourceLink[] => {
    if (typeof item === "string") return [{ url: item }];
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    return typeof source.url === "string"
      ? [{ url: source.url, ...(typeof source.title === "string" ? { title: source.title } : {}) }]
      : [];
  });
}

function normalizeArticle(value: unknown): Article | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  const rawSnapshot = row.publishedSnapshot;
  const snapshot = rawSnapshot && typeof rawSnapshot === "object"
    ? rawSnapshot as Record<string, unknown>
    : null;
  const publishedSnapshot = snapshot
    && typeof snapshot.title === "string"
    && typeof snapshot.summary === "string"
    && typeof snapshot.category === "string"
    && (typeof snapshot.body === "string" || typeof snapshot.content === "string")
    ? {
        title: snapshot.title,
        summary: snapshot.summary,
        content: String(snapshot.content ?? snapshot.body),
        category: snapshot.category,
        sources: normalizeSources(snapshot.sources),
      }
    : undefined;
  return {
    id: row.id,
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    content: String(row.content ?? row.body ?? row.markdown ?? ""),
    category: String(row.category ?? "Water education"),
    status: String(row.status ?? "draft"),
    origin: String(row.origin ?? row.source ?? "human"),
    rationale: String(row.rationale ?? ""),
    rejectionFeedback: String(row.rejectionFeedback ?? row.rejection_feedback ?? ""),
    sources: normalizeSources(row.sources),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
    publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : undefined,
    publishedSnapshot,
    version: typeof row.version === "number" ? row.version : undefined,
  };
}

function hasUnpublishedChanges(form: ArticleForm, snapshot: PublishedSnapshot | undefined): boolean {
  if (!snapshot) return false;
  const current = {
    title: form.title.trim(),
    summary: form.summary.trim(),
    content: form.content.trim(),
    category: form.category.trim(),
    sources: form.sources.filter((source) => source.url.trim()).map((source) => ({
      url: source.url.trim(),
      title: source.title?.trim() || source.url.trim(),
    })),
  };
  const published = {
    title: snapshot.title.trim(),
    summary: snapshot.summary.trim(),
    content: snapshot.content.trim(),
    category: snapshot.category.trim(),
    sources: snapshot.sources.filter((source) => source.url.trim()).map((source) => ({
      url: source.url.trim(),
      title: source.title?.trim() || source.url.trim(),
    })),
  };
  return JSON.stringify(current) !== JSON.stringify(published);
}

function getStatusClass(status: string) {
  if (status === "published") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "rejected" || status === "failed") return "border-destructive/40 bg-destructive/10 text-destructive";
  if (status === "pending_review" || status === "in_review") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-border bg-muted text-muted-foreground";
}

function displayDate(value: unknown) {
  if (typeof value !== "string" && !(value instanceof Date)) return "Date unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function isSafeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Extract text from the document.xml entry of an ordinary DOCX ZIP in-browser. */
async function readDocx(file: File): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot read DOCX files. Save the article as .txt or .md instead.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = 0x02014b50;
  let entryOffset = -1;
  for (let offset = 0; offset + 46 < bytes.length; offset += 1) {
    if (view.getUint32(offset, true) === signature) {
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (name === "word/document.xml") { entryOffset = offset; break; }
      offset += 45 + nameLength + extraLength + commentLength;
    }
  }
  if (entryOffset < 0) throw new Error("The DOCX file does not contain a readable Word document.");

  const method = view.getUint16(entryOffset + 10, true);
  const compressedSize = view.getUint32(entryOffset + 20, true);
  const nameLength = view.getUint16(entryOffset + 28, true);
  const extraLength = view.getUint16(entryOffset + 30, true);
  const localOffset = view.getUint32(entryOffset + 42, true);
  if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("The DOCX archive is malformed.");
  const localNameLength = view.getUint16(localOffset + 26, true);
  const localExtraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const compressed = bytes.slice(dataStart, dataStart + compressedSize);
  let xmlBytes: Uint8Array;
  if (method === 0) xmlBytes = compressed;
  else if (method === 8) {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    throw new Error("This DOCX uses a compression format this browser cannot read.");
  }
  const documentXml = new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes), "application/xml");
  if (documentXml.querySelector("parsererror")) throw new Error("The DOCX document could not be decoded.");
  const paragraphs = Array.from(documentXml.getElementsByTagNameNS("*", "p"));
  const text = paragraphs.map((paragraph) => {
    const words = Array.from(paragraph.getElementsByTagNameNS("*", "t"))
      .map((node) => node.textContent ?? "").join("");
    if (!words) return "";
    const style = paragraph.getElementsByTagNameNS("*", "pStyle")[0]?.getAttribute("w:val")
      ?? paragraph.getElementsByTagNameNS("*", "pStyle")[0]?.getAttribute("val") ?? "";
    if (/^Heading[1-6]$/i.test(style)) return `${"#".repeat(Number(style.slice(-1)))} ${words}`;
    return words;
  }).filter(Boolean).join("\n\n").trim();
  return text;
}

async function importArticleFile(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose a document smaller than 8 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "docx") return readDocx(file);
  if (extension === "txt" || extension === "md") return file.text();
  throw new Error("Choose a .txt, .md, or .docx article.");
}

function SafeArticlePreview({ content }: { content: string }) {
  const blocks = content.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (!blocks.length) return <p className="text-sm text-muted-foreground">Your article preview will appear here.</p>;
  return <div className="space-y-4 text-sm leading-7">
    {blocks.map((block, index) => {
      const heading = block.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const Tag = heading[1]!.length === 1 ? "h2" : heading[1]!.length === 2 ? "h3" : "h4";
        return <Tag key={index} className="font-semibold leading-tight">{heading[2]}</Tag>;
      }
      const lines = block.split("\n");
      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        return <ul key={index} className="list-disc space-y-1 pl-5">{lines.map((line, lineIndex) => <li key={lineIndex}>{line.replace(/^[-*]\s+/, "")}</li>)}</ul>;
      }
      return <p key={index} className="whitespace-pre-wrap">{block}</p>;
    })}
  </div>;
}

function readRunValue(run: BlogRun, ...keys: string[]): unknown {
  for (const key of keys) if (run[key] !== undefined && run[key] !== null) return run[key];
  return undefined;
}

export default function CompanionBlogPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [runs, setRuns] = useState<BlogRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [history, setHistory] = useState<ArticleHistory[]>([]);
  const [form, setForm] = useState<ArticleForm>(BLANK_FORM);
  const [brief, setBrief] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rejectionFeedback, setRejectionFeedback] = useState("");
  const [queuedMessage, setQueuedMessage] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [runError, setRunError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [preview, setPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const loadArticles = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    if (!quiet) setError("");
    try {
      const result = await apiFetch<{ articles?: unknown[] }>("/uc/editor/blog");
      setArticles((result.articles ?? []).map(normalizeArticle).filter((article): article is Article => article !== null));
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "Could not load the editorial queue.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    setRunError("");
    try {
      const result = await apiFetch<{ runs?: BlogRun[] }>("/uc/editor/blog/runs");
      setRuns(result.runs ?? []);
    } catch (reason) {
      setRunError(reason instanceof Error ? reason.message : "Weekly run health is unavailable.");
    }
  }, []);

  const selectArticle = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setError("");
    try {
      const result = await apiFetch<{ article?: unknown; history?: ArticleHistory[] }>(`/uc/editor/blog/${encodeURIComponent(id)}`);
      const article = normalizeArticle(result.article);
      if (!article) throw new Error("The article response was incomplete.");
      setSelectedArticle(article);
      setHistory(result.history ?? []);
      setForm({
        title: article.title, summary: article.summary, content: article.content,
        category: article.category, origin: article.origin, rationale: article.rationale,
        rejectionFeedback: article.rejectionFeedback, sources: article.sources,
      });
      setRejectionFeedback(article.rejectionFeedback);
      setPreview(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this article.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refreshTeamUser().then((user) => {
      if (active) setIsAdmin(user.role === "admin");
    }).catch(() => {
      if (active) setIsAdmin(false);
    });
    void loadArticles();
    void loadRuns();
    return () => { active = false; };
  }, [loadArticles, loadRuns]);

  const runsInProgress = runs.some((run) => ["queued", "pending", "running", "processing"].includes(
    String(readRunValue(run, "status", "outcome") ?? "").toLowerCase(),
  ));
  useEffect(() => {
    if (!runsInProgress && !activeRunId) return;
    const interval = window.setInterval(() => {
      void loadArticles(true);
      void loadRuns();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [activeRunId, loadArticles, loadRuns, runsInProgress]);

  const filteredArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return articles.filter((article) => {
      if (statusFilter !== "all" && article.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return `${article.title} ${article.summary} ${article.category} ${article.origin}`
        .toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [articles, query, statusFilter]);

  const startNewArticle = () => {
    setSelectedId(null);
    setSelectedArticle(null);
    setHistory([]);
    setForm(BLANK_FORM);
    setRejectionFeedback("");
    setPreview(false);
    setError("");
  };

  const saveArticle = async (): Promise<Article> => {
    const body = {
      title: form.title.trim(),
      summary: form.summary.trim(),
      content: form.content.trim(),
      category: form.category.trim(),
      origin: form.origin,
      rationale: form.rationale.trim(),
      sources: form.sources.filter((source) => source.url.trim()).map((source) => ({
        url: source.url.trim(), title: source.title?.trim() || source.url.trim(),
      })),
      body: form.content.trim(),
    };
    if (!body.title || !body.summary || !body.content) {
      throw new Error("Add a title, short summary, and article body before saving.");
    }
    if (body.sources.some((source) => !isSafeSourceUrl(source.url))) {
      throw new Error("Every source must be a valid HTTPS link without embedded credentials.");
    }
    const result = selectedId
      ? await apiFetch<{ article?: unknown }>(`/uc/editor/blog/${encodeURIComponent(selectedId)}`, {
          method: "PATCH", body: JSON.stringify(body),
        })
      : await apiFetch<{ article?: unknown }>("/uc/editor/blog", {
          method: "POST", body: JSON.stringify(body),
        });
    const article = normalizeArticle(result.article);
    if (!article) throw new Error("The save succeeded but the server returned no article.");
    setSelectedId(article.id);
    setSelectedArticle(article);
    setForm({
      title: article.title, summary: article.summary, content: article.content,
      category: article.category, origin: article.origin, rationale: article.rationale,
      rejectionFeedback: article.rejectionFeedback, sources: article.sources,
    });
    return article;
  };

  const saveDraft = async () => {
    setSaving(true);
    setError("");
    try {
      const article = await saveArticle();
      await Promise.all([loadArticles(), selectArticle(article.id)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The article could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const generateFromBrief = async () => {
    if (!brief.trim()) return;
    setGenerating(true);
    setError("");
    try {
      const result = await apiFetch<{ article?: unknown; draft?: unknown; run?: unknown; reused?: boolean }>("/uc/editor/blog/draft-from-brief", {
        method: "POST",
        body: JSON.stringify({ brief: brief.trim() }),
      });
      const queuedRun = result.run && typeof result.run === "object" ? result.run as Record<string, unknown> : null;
      const article = normalizeArticle(result.article ?? result.draft);
      setBrief("");
      if (article) {
        setQueuedMessage("Your brief has been drafted and added to the review queue.");
        setActiveRunId(null);
        await loadArticles();
        await selectArticle(article.id);
      } else if (queuedRun) {
        const runId = queuedRun.id ?? queuedRun.runId;
        setActiveRunId(runId == null ? "pending" : String(runId));
        setQueuedMessage(result.reused
          ? "Your brief is queued with an existing research run. New drafts will appear in the editorial queue when it finishes."
          : "Your brief is queued for research and drafting. New articles will appear in the editorial queue when the run finishes.");
        await Promise.all([loadRuns(), loadArticles(true)]);
      } else {
        throw new Error("Draft request returned neither a completed article nor a queued run.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The draft could not be generated.");
    } finally {
      setGenerating(false);
    }
  };

  const runAction = async (action: "publish" | "reject" | "unpublish") => {
    if (!isAdmin) {
      setError("Only a live-verified administrator can review or publish an article.");
      return;
    }
    if (!selectedId && action !== "publish") return;
    if (action === "reject" && !rejectionFeedback.trim()) {
      setError("Add clear feedback before returning an article for changes.");
      return;
    }
    if (action === "publish" && (!form.sources.length || form.sources.some((source) => !isSafeSourceUrl(source.url)))) {
      setError("Add at least one valid HTTPS source before publishing this article.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const articleId = action === "reject" || action === "publish"
        ? (await saveArticle()).id
        : selectedId!;
      await apiFetch(`/uc/editor/blog/${encodeURIComponent(articleId)}/${action}`, {
        method: "POST",
        ...(action === "reject" ? { body: JSON.stringify({ feedback: rejectionFeedback.trim() }) } : {}),
      });
      await Promise.all([loadArticles(), selectArticle(articleId)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not ${action} this article.`);
    } finally {
      setSaving(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setError("");
    try {
      const content = await importArticleFile(file);
      const filenameTitle = file.name.replace(/\.(txt|md|docx)$/i, "").replace(/[_-]+/g, " ").trim();
      setSelectedId(null);
      setSelectedArticle(null);
      setHistory([]);
      setForm((current) => ({
        ...current,
        title: current.title || filenameTitle,
        content,
        origin: "human_upload",
        rationale: current.rationale || `Imported from ${file.name}; review and confirm all claims and sources.`,
      }));
      setPreview(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import this article.");
    } finally {
      setImporting(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const addSource = () => setForm((current) => ({ ...current, sources: [...current.sources, { url: "", title: "" }] }));
  const updateSource = (index: number, updates: Partial<SourceLink>) => setForm((current) => ({
    ...current, sources: current.sources.map((source, sourceIndex) => sourceIndex === index ? { ...source, ...updates } : source),
  }));
  const removeSource = (index: number) => setForm((current) => ({
    ...current, sources: current.sources.filter((_, sourceIndex) => sourceIndex !== index),
  }));

  const lastRun = runs[0];
  const runStatus = String(readRunValue(lastRun ?? {}, "status", "outcome") ?? "");
  const selectedStatus = selectedArticle?.status ?? "draft";
  const revisionHasChanges = selectedArticle?.status === "published"
    && hasUnpublishedChanges(form, selectedArticle.publishedSnapshot);
  const trackedRun = activeRunId === "pending"
    ? lastRun
    : activeRunId
      ? runs.find((run) => String(readRunValue(run, "id", "runId") ?? "") === activeRunId)
      : undefined;
  const trackedStatus = String(readRunValue(trackedRun ?? {}, "status", "outcome") ?? "").toLowerCase();
  const generationFinished = !!trackedRun && !["queued", "pending", "running", "processing"].includes(trackedStatus);
  useEffect(() => {
    if (!generationFinished) return;
    setQueuedMessage(trackedStatus === "failed" || trackedStatus === "error"
      ? "The queued research run finished with an error. Review run health below and retry your brief when ready."
      : "The research run finished. Refreshing the article queue for new drafts.");
    setActiveRunId(null);
    void loadArticles(true);
  }, [generationFinished, loadArticles, trackedStatus]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <section className="relative overflow-hidden rounded-xl border bg-card">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <Newspaper className="h-4 w-4" /> Companion editorial desk
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">Good water stories start with good sources.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Shape practical, evidence-led articles for Companion. Every draft stays private until a human editor approves it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="button-new-blog-article" onClick={startNewArticle}><Plus className="mr-2 h-4 w-4" />New article</Button>
            <Button data-testid="button-import-blog-article" variant="outline" onClick={() => uploadRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import article
            </Button>
            <input ref={uploadRef} data-testid="input-blog-upload" type="file" accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(event) => void importFile(event.target.files?.[0])} />
          </div>
        </div>
        <div className="grid gap-3 border-t bg-muted/30 p-4 sm:grid-cols-3 sm:px-7">
          <div className="flex items-center gap-3"><BookOpen className="h-4 w-4 text-primary" /><div><p className="text-xs text-muted-foreground">In your queue</p><p data-testid="text-blog-queue-count" className="text-sm font-semibold">{articles.length} {articles.length === 1 ? "article" : "articles"}</p></div></div>
          <div className="flex items-center gap-3"><Globe2 className="h-4 w-4 text-primary" /><div><p className="text-xs text-muted-foreground">Publishing</p><p className="text-sm font-semibold">Admin approval required</p></div></div>
          <div className="flex items-center gap-3"><Clock3 className="h-4 w-4 text-primary" /><div><p className="text-xs text-muted-foreground">Weekly research</p><p className="text-sm font-semibold">{lastRun ? `${runStatus || "Run recorded"} · ${displayDate(readRunValue(lastRun, "completedAt", "createdAt", "startedAt"))}` : "No run recorded yet"}</p></div></div>
        </div>
      </section>

      {error && <div role="alert" data-testid="status-blog-error" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
      {queuedMessage && <div role="status" data-testid="status-blog-generation" className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm sm:flex-row sm:items-center"><span className="flex-1">{activeRunId && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}{queuedMessage}</span><Button data-testid="button-refresh-blog-generation" variant="outline" size="sm" onClick={() => { void loadRuns(); void loadArticles(true); }}>Refresh status</Button></div>}

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.75fr)]">
        <aside className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Editorial queue</h2>
                <Button data-testid="button-refresh-blog-queue" variant="ghost" size="icon" className="h-9 w-9" onClick={() => void loadArticles()} aria-label="Refresh article queue"><RefreshCw className="h-4 w-4" /></Button>
              </div>
              <div className="relative mt-3"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input data-testid="input-blog-search" className="pl-9" placeholder="Search articles" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
              <Label htmlFor="blog-status-filter" className="sr-only">Filter by status</Label>
              <select id="blog-status-filter" data-testid="select-blog-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
              </select>
            </div>
            <div className="max-h-[600px] overflow-y-auto divide-y">
              {loading && <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading articles…</div>}
              {!loading && filteredArticles.map((article) => (
                <button key={article.id} data-testid={`button-select-blog-${article.id}`} onClick={() => void selectArticle(article.id)} className={`w-full min-w-0 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === article.id ? "bg-primary/5" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{article.title || "Untitled draft"}</span>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{article.summary || "No summary yet."}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] ${getStatusClass(article.status)}`}>{STATUS_LABELS[article.status] ?? article.status}</Badge>
                    <span className="text-[10px] text-muted-foreground">{article.origin.replace(/_/g, " ")}</span>
                    {article.updatedAt && <span className="ml-auto text-[10px] text-muted-foreground">{displayDate(article.updatedAt)}</span>}
                  </div>
                </button>
              ))}
              {!loading && !filteredArticles.length && <div className="px-5 py-8 text-center"><FileText className="mx-auto h-5 w-5 text-muted-foreground" /><p data-testid="text-blog-empty" className="mt-2 text-sm font-medium">{articles.length ? "No articles match that search." : "Your queue is clear."}</p><p className="mt-1 text-xs text-muted-foreground">{articles.length ? "Try another title or status." : "Start an article, import a document, or draft from a brief."}</p></div>}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">Draft from a brief</h2></div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Ask for a useful angle. Generated drafts and sources still need editorial review.</p>
            <Textarea data-testid="textarea-blog-brief" className="mt-3 min-h-24 resize-y" placeholder="For example: Explain when household water should be tested after heavy rain, with practical next steps for Kenyan families." value={brief} onChange={(event) => setBrief(event.target.value)} />
            <Button data-testid="button-generate-blog-draft" className="mt-3 w-full" onClick={() => void generateFromBrief()} disabled={generating || !brief.trim()}>
              {generating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Preparing a sourced draft…</> : <><Sparkles className="mr-2 h-4 w-4" />Generate review draft</>}
            </Button>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h2 className="font-semibold">Weekly research health</h2></div>
            {runError && <div role="status" className="mt-3 rounded-md bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"><p>Weekly run details are unavailable.</p><p className="mt-1">{runError}</p><Button data-testid="button-retry-blog-runs" variant="outline" size="sm" className="mt-2" onClick={() => void loadRuns()}>Retry</Button></div>}
            {!runError && !runs.length && <p data-testid="text-blog-runs-empty" className="mt-3 text-xs leading-5 text-muted-foreground">No weekly research runs have been recorded. Run summaries and failures will appear here.</p>}
            <div className="mt-3 space-y-3">
              {runs.slice(0, 3).map((run, index) => {
                const status = String(readRunValue(run, "status", "outcome") ?? "unknown");
                const failures = readRunValue(run, "failures", "error", "errors");
                const topics = readRunValue(run, "topicsProposed", "draftsCreated", "proposedCount");
                const resultSummary = readRunValue(run, "resultSummary", "summary");
                const briefText = readRunValue(run, "brief", "requestBrief");
                const runType = String(readRunValue(run, "runType", "type") ?? "").toLowerCase();
                const hasFailure = failures !== undefined && failures !== null
                  && (Array.isArray(failures) ? failures.length > 0 : String(failures).trim().length > 0);
                return <div key={String(run.id ?? index)} data-testid={`card-blog-run-${String(run.id ?? index)}`} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{displayDate(readRunValue(run, "completedAt", "createdAt", "startedAt"))}</span><Badge variant="outline" className={`text-[10px] ${getStatusClass(status === "success" || status === "completed" ? "published" : status === "failed" || status === "error" ? "failed" : "draft")}`}>{status}</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">{topics !== undefined ? `${String(topics)} draft${Number(topics) === 1 ? "" : "s"} proposed` : runType === "brief" || briefText ? "Brief research run" : "Weekly research run"}</p>
                  {typeof resultSummary === "string" && resultSummary.trim() && <p className="mt-2 text-xs leading-5">{resultSummary}</p>}
                  {typeof briefText === "string" && briefText.trim() && <p className="mt-2 text-xs leading-5 text-muted-foreground"><strong>Brief:</strong> {briefText}</p>}
                  {hasFailure && <p className="mt-2 break-words text-xs text-destructive">{Array.isArray(failures) ? failures.map(String).join(" · ") : String(failures)}</p>}
                  {typeof run.rationale === "string" && <p className="mt-2 text-xs leading-5 text-muted-foreground">{run.rationale}</p>}
                </div>;
              })}
            </div>
          </div>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              {selectedId && <Button data-testid="button-back-blog-queue" variant="ghost" size="icon" className="h-9 w-9 shrink-0 xl:hidden" onClick={startNewArticle} aria-label="Start a new article"><ArrowLeft className="h-4 w-4" /></Button>}
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{selectedId ? "Article workspace" : "New story"}</p>
                <h2 className="truncate font-semibold">{form.title || "Untitled article"}</h2>
              </div>
              {selectedArticle && <Badge variant="outline" className={getStatusClass(selectedStatus)}>{STATUS_LABELS[selectedStatus] ?? selectedStatus}</Badge>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button data-testid="button-toggle-blog-preview" variant="outline" onClick={() => setPreview((current) => !current)}><BookOpen className="mr-2 h-4 w-4" />{preview ? "Edit" : "Preview"}</Button>
              {isAdmin && !selectedId && <Button data-testid="button-create-publish-blog-article" variant="secondary" onClick={() => void runAction("publish")} disabled={saving || !form.sources.length || form.sources.some((source) => !isSafeSourceUrl(source.url))}><Check className="mr-2 h-4 w-4" />Save &amp; publish</Button>}
              <Button data-testid="button-save-blog-article" onClick={() => void saveDraft()} disabled={saving || detailLoading || loading}><Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save draft"}</Button>
            </div>
          </div>
          {isAdmin && !selectedId && !form.sources.length && <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground sm:px-6">Add at least one verified HTTPS source to enable direct publishing.</p>}

          {detailLoading && <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Opening article…</div>}
          {!detailLoading && preview && <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_240px]">
            <article className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">{form.category || "Water education"}</p>
              <h1 className="mt-3 text-3xl font-semibold leading-tight">{form.title || "Untitled article"}</h1>
              <p className="mt-3 text-base leading-7 text-muted-foreground">{form.summary || "A short introduction will appear here."}</p>
              <div className="my-6 border-t" />
              <SafeArticlePreview content={form.content} />
            </article>
            <aside className="space-y-5 border-t pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources</p>{form.sources.filter((source) => source.url).length ? <ul className="mt-2 space-y-2">{form.sources.filter((source) => source.url).map((source, index) => <li key={index}>{isSafeSourceUrl(source.url) ? <a href={source.url} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-primary underline underline-offset-2">{source.title || source.url}</a> : <span className="break-all text-xs text-destructive">Invalid source URL: {source.url}</span>}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">No source links have been added.</p>}</div>
              <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Editorial rationale</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{form.rationale || "Not supplied."}</p></div>
            </aside>
          </div>}
          {!detailLoading && !preview && <div className="space-y-6 p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="blog-title">Article title</Label><Input data-testid="input-blog-title" id="blog-title" placeholder="A clear, useful headline" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="blog-category">Category</Label><Input data-testid="input-blog-category" id="blog-category" placeholder="Water education" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="blog-origin">Draft origin</Label><Input data-testid="input-blog-origin" id="blog-origin" value={form.origin.replace(/_/g, " ")} readOnly className="capitalize" /><p className="text-[11px] text-muted-foreground">Set by this workflow: human, upload, brief, or weekly research.</p></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="blog-summary">Short introduction</Label><Textarea data-testid="textarea-blog-summary" id="blog-summary" rows={2} placeholder="What will readers take away?" value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} /></div>
              <div className="space-y-2 sm:col-span-2"><div className="flex flex-wrap items-end justify-between gap-2"><Label htmlFor="blog-content">Article body</Label><Button data-testid="button-reimport-blog-file" type="button" size="sm" variant="ghost" onClick={() => uploadRef.current?.click()}><ArrowDownToLine className="mr-2 h-4 w-4" />Replace from file</Button></div><p className="text-xs text-muted-foreground">Plain text and Markdown are supported. Use # headings and - bullets for a readable preview.</p><Textarea data-testid="textarea-blog-content" id="blog-content" className="min-h-[280px] resize-y font-mono text-sm leading-6" placeholder={"## Start with the question people ask\n\nExplain what is known, what readers can do next, and where the evidence comes from."} value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} /></div>
            </div>

            <section className="space-y-3 border-t pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Sources</h3><p className="text-xs text-muted-foreground">Only add real, reviewable references. Links must use HTTPS.</p></div><Button data-testid="button-add-blog-source" type="button" variant="outline" size="sm" onClick={addSource}><Plus className="mr-1.5 h-4 w-4" />Add source</Button></div>
              {!form.sources.length && <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">No sources added yet. Add the original research behind the article before asking for approval.</p>}
              {form.sources.map((source, index) => <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto]">
                <Input data-testid={`input-blog-source-url-${index}`} aria-label={`Source ${index + 1} URL`} type="url" placeholder="https://…" value={source.url} onChange={(event) => updateSource(index, { url: event.target.value })} />
                <Input data-testid={`input-blog-source-title-${index}`} aria-label={`Source ${index + 1} title`} placeholder="Source title (optional)" value={source.title ?? ""} onChange={(event) => updateSource(index, { title: event.target.value })} />
                <Button data-testid={`button-remove-blog-source-${index}`} type="button" variant="ghost" size="icon" aria-label={`Remove source ${index + 1}`} onClick={() => removeSource(index)}><X className="h-4 w-4" /></Button>
              </div>)}
            </section>

            <div className="space-y-2"><Label htmlFor="blog-rationale">Why this article belongs in Companion</Label><Textarea data-testid="textarea-blog-rationale" id="blog-rationale" rows={3} placeholder="Reader need, Alison theme or research angle, and the evidence gap it addresses." value={form.rationale} onChange={(event) => setForm((current) => ({ ...current, rationale: event.target.value }))} /></div>

            {selectedArticle && <div className="grid gap-5 border-t pt-5 lg:grid-cols-2">
              <section className="space-y-3">
                <div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h3 className="font-semibold">Article history</h3></div>
                <p className="text-xs text-muted-foreground">Current version {selectedArticle.version ?? "—"} · updated {displayDate(selectedArticle.updatedAt)}</p>
                {!history.length && <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">No revision history recorded yet.</p>}
                {history.slice(0, 8).map((entry, index) => <div key={String(entry.id ?? index)} data-testid={`blog-history-${String(entry.id ?? index)}`} className="border-l-2 border-primary/30 pl-3">
                  <p className="text-xs font-medium">{String(entry.action ?? entry.status ?? entry.event ?? "Revision")} <span className="font-normal text-muted-foreground">· {displayDate(entry.createdAt ?? entry.changedAt ?? entry.at)}</span></p>
                  {typeof (entry.rationale ?? entry.feedback ?? entry.note) === "string" && <p className="mt-1 text-xs leading-5 text-muted-foreground">{String(entry.rationale ?? entry.feedback ?? entry.note)}</p>}
                </div>)}
              </section>
              <section className="space-y-3">
                <div className="flex items-center gap-2"><Send className="h-4 w-4 text-primary" /><h3 className="font-semibold">Review decision</h3></div>
                {selectedArticle.rejectionFeedback && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5"><strong>Latest editor feedback:</strong> {selectedArticle.rejectionFeedback}</p>}
                {isAdmin ? <div className="flex flex-wrap gap-2">
                  {selectedStatus !== "published" && <Button data-testid="button-publish-blog-article" disabled={saving || !form.sources.length || form.sources.some((source) => !isSafeSourceUrl(source.url))} onClick={() => void runAction("publish")}><Check className="mr-2 h-4 w-4" />Approve &amp; publish</Button>}
                  {selectedStatus !== "published" && !form.sources.length && <p className="w-full text-xs text-muted-foreground">Add at least one verified HTTPS source to enable publishing.</p>}
                  {selectedStatus === "published" && <Button data-testid="button-publish-blog-revision" disabled={saving || !revisionHasChanges || !form.sources.length || form.sources.some((source) => !isSafeSourceUrl(source.url))} onClick={() => void runAction("publish")}><Check className="mr-2 h-4 w-4" />Publish revision</Button>}
                  {selectedStatus === "published" && <Button data-testid="button-unpublish-blog-article" variant="outline" disabled={saving} onClick={() => void runAction("unpublish")}>Unpublish</Button>}
                </div> : <p className="text-xs text-muted-foreground">Publishing controls are available only to a live-verified admin. Your saved draft remains private.</p>}
                {isAdmin && selectedStatus === "published" && <p className="text-xs text-muted-foreground">{!selectedArticle.publishedSnapshot ? "The live snapshot is unavailable, so a revision cannot be safely compared or approved." : revisionHasChanges ? "Publishing saves this working copy as the next public snapshot. The current live article stays available; you do not need to unpublish first." : "The working copy matches the live snapshot. Make and save an editorial change to enable revision publishing."}</p>}
                {isAdmin && selectedStatus !== "published" && <div className="space-y-2"><Label htmlFor="blog-rejection-feedback">Return with feedback</Label><Textarea data-testid="textarea-blog-rejection-feedback" id="blog-rejection-feedback" rows={3} placeholder="Name the claims, sourcing, or edits needed before this can go live." value={rejectionFeedback} onChange={(event) => setRejectionFeedback(event.target.value)} /><Button data-testid="button-reject-blog-article" variant="outline" disabled={saving || !rejectionFeedback.trim()} onClick={() => void runAction("reject")}>Return for changes</Button></div>}
              </section>
            </div>}
            {selectedArticle && selectedStatus === "published" && <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs"><span className="text-muted-foreground">Public snapshot is live; saved editorial changes do not republish it.</span>{isAdmin && <Button data-testid="button-unpublish-blog-article-inline" variant="outline" size="sm" disabled={saving} onClick={() => void runAction("unpublish")}>Unpublish</Button>}</div>}
          </div>}
        </section>
      </section>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Drafts and rejected articles stay out of Companion. Article edits do not change the public version until an administrator approves and publishes them.</p>
    </div>
  );
}