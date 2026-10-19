import { useState, useRef, useEffect } from "react";
import { getTeamToken, isTeamAdmin } from "@/lib/team-auth";
import { apiUrl } from "@/lib/api-base";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { LibraryKnowledgeReview, type KnowledgeMetadata } from "@/components/library-knowledge-review";
import {
  Upload, FileText, FileImage, Film, Archive, File, Download, Trash2,
  BookOpen, Search, Loader2, FolderOpen,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface LibraryDoc {
  id:         string;
  title:      string;
  fileName:   string;
  fileSize:   number;
  fileType:   string;
  objectPath: string;
  uploadedBy: string;
  createdAt:  string;
  knowledgeStatus: "private" | "approved" | "revoked";
  knowledgeRevision: number;
  knowledgeTitle: string | null;
  knowledgeReviewedAt: string | null;
  knowledgeReviewedBy: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return <FileImage className="h-5 w-5 text-blue-500" />;
  if (mime.startsWith("video/")) return <Film className="h-5 w-5 text-purple-500" />;
  if (mime === "application/pdf") return <FileText className="h-5 w-5 text-red-500" />;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar"))
    return <Archive className="h-5 w-5 text-orange-500" />;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv"))
    return <FileText className="h-5 w-5 text-green-600" />;
  if (mime.includes("word") || mime.includes("document"))
    return <FileText className="h-5 w-5 text-blue-700" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

function mimeLabel(mime: string): string {
  const map: Record<string, string> = {
    "application/pdf": "PDF",
    "text/plain": "Text",
    "text/csv": "CSV",
    "image/jpeg": "JPEG", "image/png": "PNG", "image/gif": "GIF", "image/webp": "WebP",
    "video/mp4": "MP4", "video/quicktime": "MOV",
    "application/zip": "ZIP",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/vnd.ms-excel": "XLS",
  };
  return map[mime] ?? mime.split("/")[1]?.toUpperCase() ?? "File";
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getTeamToken();
  const res = await fetch(apiUrl(path), {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res;
}

// ─── Upload Dialog ──────────────────────────────────────────────────────────────

interface UploadDialogProps {
  open:     boolean;
  onClose:  () => void;
  onUpload: (doc: LibraryDoc) => void;
}

function UploadDialog({ open, onClose, onUpload }: UploadDialogProps) {
  const { toast } = useToast();
  const [file,    setFile]    = useState<File | null>(null);
  const [title,   setTitle]   = useState("");
  const [stage,   setStage]   = useState<"idle" | "uploading" | "saving">("idle");
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null); setTitle(""); setStage("idle"); setProgress(0);
    if (fileRef.current) fileRef.current.value = "";
  }
  function handleClose() { reset(); onClose(); }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;
    const fileType = (!file.type || file.type === "application/octet-stream")
      ? (/\.(md|markdown)$/i.test(file.name) ? "text/markdown" : /\.txt$/i.test(file.name) ? "text/plain" : file.type)
      : file.type;

    try {
      // Step 1: request presigned URL — server creates the upload slot and returns
      // an opaque uploadId.  We never touch objectPath; the server controls it.
      setStage("uploading");
      setProgress(10);
      const { uploadURL, uploadId } = await apiFetch("/api/library/request-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileSize: file.size, fileType }),
      }).then(r => r.json()) as { uploadURL: string; uploadId: string };

      // Step 2: upload directly to GCS via presigned URL (no auth header — signed URL is self-authenticating)
      setProgress(30);
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(30 + Math.round((ev.loaded / ev.total) * 55));
        };
        xhr.onload  = () => xhr.status < 300 ? resolve() : reject(new Error(`GCS upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", fileType);
        xhr.send(file);
      });

      // Step 3: finalise — send uploadId (not objectPath) so the server can
      // verify ownership, expiry, and actual GCS metadata before promoting.
      setProgress(90);
      setStage("saving");
      const doc = await apiFetch("/api/library/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(), fileName: file.name,
          fileSize: file.size, fileType, uploadId,
        }),
      }).then(r => r.json()) as LibraryDoc;

      setProgress(100);
      toast({ title: "Document uploaded", description: `"${doc.title}" added to the library.` });
      onUpload(doc);
      reset();
      onClose();
    } catch (err) {
      console.error("[library] upload error:", err);
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
      setStage("idle");
      setProgress(0);
    }
  }

  const busy = stage !== "idle";

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            Choose a file and give it a descriptive title. Maximum 50 MB.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {/* File picker */}
          <div>
            <Label>File</Label>
            <div
              className="mt-1.5 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/60 transition-colors"
              onClick={() => fileRef.current?.click()}>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
                disabled={busy}
              />
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  {fileIcon(file.type)}
                  <div className="text-left">
                    <p className="text-sm font-medium truncate max-w-xs">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to choose a file</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, Word, Excel, images, video — up to 50 MB</p>
                </>
              )}
            </div>
          </div>

          {/* Title */}
          <div>
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Q3 Sales Report"
              maxLength={200}
              disabled={busy}
              className="mt-1.5"
            />
          </div>

          {/* Progress */}
          {busy && (
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {stage === "uploading" ? "Uploading…" : "Saving…"} {progress}%
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={!file || !title.trim() || busy}>
              {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading…</> : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const { toast } = useToast();
  const admin = isTeamAdmin();

  const [docs,         setDocs]         = useState<LibraryDoc[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [search,       setSearch]       = useState("");
  const [showUpload,   setShowUpload]   = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LibraryDoc | null>(null);
  const [deleting,     setDeleting]     = useState(false);
  const [downloading,  setDownloading]  = useState<string | null>(null);
  const [reviewDoc, setReviewDoc] = useState<LibraryDoc | null>(null);

  // ── Fetch docs ──────────────────────────────────────────────────────────────
  useEffect(() => {
    loadDocs();
    const refresh = () => {
      apiFetch("/api/library/docs").then(r => r.json()).then(({ docs: list }: { docs: LibraryDoc[] }) => setDocs(list))
        .catch(() => { /* foreground reload retains the explicit error state */ });
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, []);

  async function loadDocs() {
    setLoading(true);
    setError(null);
    try {
      const { docs: list } = await apiFetch("/api/library/docs").then(r => r.json()) as { docs: LibraryDoc[] };
      setDocs(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/library/docs/${deleteTarget.id}`, { method: "DELETE" });
      setDocs(prev => prev.filter(d => d.id !== deleteTarget.id));
      toast({ title: "Document deleted", description: `"${deleteTarget.title}" has been removed.` });
    } catch (err) {
      toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  // ── Download ────────────────────────────────────────────────────────────────
  async function handleDownload(doc: LibraryDoc) {
    if (downloading) return;
    setDownloading(doc.id);
    try {
      const res = await apiFetch(`/api/library/download/${doc.id}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Download failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  }

  // ── Filtered view ───────────────────────────────────────────────────────────
  const filtered = docs.filter(d =>
    !search.trim() ||
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.fileName.toLowerCase().includes(search.toLowerCase()) ||
    d.uploadedBy.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" /> Library
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Team document repository — SOPs, reports, guides, and reference files.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Uploads are private by default. Administrators can review UTF-8 Markdown/text (32 KB) or text-based PDFs (5 MB, 40 pages) for Alison. Extracted text is limited to 16,000 characters.
          </p>
        </div>
        <Button onClick={() => setShowUpload(true)}>
          <Upload className="h-4 w-4 mr-2" /> Upload Document
        </Button>
      </div>

      {/* Search */}
      {docs.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search documents…"
            className="pl-9"
          />
        </div>
      )}

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading library…
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-20 space-y-3">
          <p className="text-destructive font-medium">{error}</p>
          <Button variant="outline" onClick={loadDocs}>Retry</Button>
        </div>
      )}

      {!loading && !error && docs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <FolderOpen className="h-12 w-12 text-muted-foreground/40" />
          <h3 className="font-semibold text-lg">No documents yet</h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            Upload your first document — SOPs, reports, guides — anything the team needs quick access to.
          </p>
          <Button className="mt-2" onClick={() => setShowUpload(true)}>
            <Upload className="h-4 w-4 mr-2" /> Upload first document
          </Button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && docs.length > 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No documents match <span className="font-medium">"{search}"</span>
        </div>
      )}

      {/* Document grid */}
      {!loading && !error && filtered.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(doc => (
            <div
              key={doc.id}
              className="border rounded-xl p-4 bg-card hover:shadow-md transition-shadow flex flex-col gap-3">
              {/* Top row: icon + title */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{fileIcon(doc.fileType)}</div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm leading-snug line-clamp-2">{doc.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{doc.fileName}</p>
                </div>
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {mimeLabel(doc.fileType)}
                </Badge>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{formatBytes(doc.fileSize)}</span>
                <span>·</span>
                <span className="truncate">{doc.uploadedBy.split("@")[0]}</span>
                <span>·</span>
                <span className="whitespace-nowrap">{formatDate(doc.createdAt)}</span>
              </div>

              {/* Actions */}
              <div className="space-y-1">
                <Badge variant={doc.knowledgeStatus === "approved" ? "default" : "secondary"}>
                  {doc.knowledgeStatus === "approved" ? "Approved for Alison" : doc.knowledgeStatus === "revoked" ? "Alison approval revoked" : "Private — not used by Alison"}
                </Badge>
                {doc.knowledgeReviewedAt && <p className="text-xs text-muted-foreground">
                  Reviewed {formatDate(doc.knowledgeReviewedAt)}
                  {doc.knowledgeTitle ? ` · ${doc.knowledgeTitle}` : ""}
                </p>}
                {admin && <Button size="sm" variant="outline" className="w-full" onClick={() => setReviewDoc(doc)}
                  disabled={doc.knowledgeStatus !== "approved" && (doc.fileType === "application/pdf" ? doc.fileSize > 5 * 1024 * 1024 : !["text/plain", "text/markdown", "text/x-markdown"].includes(doc.fileType) || doc.fileSize > 32 * 1024)}>
                  {doc.knowledgeStatus === "approved" ? "Review / revoke Alison approval" : "Review for Alison"}
                </Button>}
                {admin && (doc.fileType === "application/pdf" ? doc.fileSize > 5 * 1024 * 1024 : !["text/plain", "text/markdown", "text/x-markdown"].includes(doc.fileType) || doc.fileSize > 32 * 1024)
                  && <p className="text-xs text-muted-foreground">For Alison, upload public Markdown/text (32 KB) or a text-based PDF (5 MB, 40 pages). Word and scanned PDFs are unsupported.</p>}
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => handleDownload(doc)}
                  disabled={downloading === doc.id}>
                  {downloading === doc.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <><Download className="h-3.5 w-3.5 mr-1.5" />Download</>}
                </Button>
                {admin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteTarget(doc)}
                    disabled={!!deleting}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload dialog */}
      {reviewDoc && <LibraryKnowledgeReview doc={reviewDoc} request={apiFetch} onClose={() => setReviewDoc(null)}
        onChanged={(metadata: KnowledgeMetadata) => {
          setDocs(prev => prev.map(doc => doc.id === metadata.id ? { ...doc, ...metadata } : doc));
          toast({ title: metadata.knowledgeStatus === "approved" ? "Approved for Alison" : "Alison approval revoked" });
        }} />}
      <UploadDialog
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUpload={doc => setDocs(prev => [doc, ...prev])}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.title}</strong> from the library and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting…</> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
