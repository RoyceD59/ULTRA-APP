import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Preview = { text: string; hash: string; revision: number; status: string; title: string; approvedText: string | null };
export type KnowledgeMetadata = {
  id: string; knowledgeStatus: "private" | "approved" | "revoked"; knowledgeRevision: number;
  knowledgeTitle: string | null; knowledgeReviewedAt: string | null; knowledgeReviewedBy: string | null;
};

export function LibraryKnowledgeReview({ doc, request, onClose, onChanged }: {
  doc: { id: string; title: string; knowledgeStatus: string; knowledgeRevision: number };
  request: (path: string, options?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onChanged: (metadata: KnowledgeMetadata) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [title, setTitle] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setPreview(null); setConfirmed(false); setError("");
    request(`/api/library/docs/${doc.id}/knowledge`).then(r => r.json()).then((result: Preview) => {
      if (active) { setPreview(result); setTitle(result.title); }
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [doc.id, request, reload]);

  async function decide(action: "approve" | "revoke") {
    if (!preview && action !== "revoke") return;
    setBusy(true); setError("");
    try {
      const result = await request(`/api/library/docs/${doc.id}/knowledge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, revision: preview?.revision ?? doc.knowledgeRevision, hash: preview?.hash,
          title, publicReferenceConfirmed: confirmed }),
      }).then(r => r.json()) as KnowledgeMetadata;
      onChanged(result); onClose();
    } catch (err) {
      setError((err as Error).message);
      setConfirmed(false);
    } finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Review customer knowledge</DialogTitle>
        <DialogDescription>
          {doc.title}. Only the text below and your public source title will be available to Alison.
          The original file remains private. Links, images, HTML and metadata are removed.
          Text-based PDFs are limited to 5 MB and 40 pages; all previews are limited to 16,000 characters.
          Scanned, image-only, encrypted PDFs and Word files are unsupported.
          Check PDF reading order and any tables carefully before approving.
        </DialogDescription>
      </DialogHeader>
      {error && <div role="alert" className="text-sm text-destructive">{error}
        <Button variant="outline" size="sm" className="ml-2" disabled={busy} onClick={() => setReload(n => n + 1)}>Reload review</Button>
      </div>}
      {!preview && !error && <p role="status">Extracting reference text…</p>}
      {preview && <>
        <p className="text-sm">Status: {preview.status === "approved" ? "Approved for Alison" : preview.status === "revoked" ? "Revoked — excluded from Alison" : "Private — excluded from Alison"}</p>
        <pre className="whitespace-pre-wrap break-words rounded border bg-muted p-3 max-h-72 overflow-y-auto text-sm" tabIndex={0} aria-label="Extracted reference text">{preview.text}</pre>
        {preview.approvedText && preview.approvedText !== preview.text && <p className="text-sm text-destructive">
          The uploaded text differs from the approved snapshot. Approval replaces the snapshot after review.
        </p>}
        <div className="space-y-2">
          <Label htmlFor="public-source-title">Public source title</Label>
          <Input id="public-source-title" value={title} maxLength={160} disabled={busy}
            placeholder="e.g. Cartridge cleaning reference" onChange={e => { setTitle(e.target.value); setConfirmed(false); }} />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />
          <span>I reviewed the full text and source title. They contain only public customer-facing reference facts,
            no customer records, personal data, confidential information, or instructions to the assistant.</span>
        </label>
        <p className="text-xs text-muted-foreground">Approval affects subsequent Alison lookups. Revocation removes this reference from future lookups, but cannot erase answers already sent or currently being generated.</p>
      </>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        {(preview?.status ?? doc.knowledgeStatus) === "approved" && <Button variant="destructive" disabled={busy} onClick={() => decide("revoke")}>Revoke approval</Button>}
        <Button disabled={busy || !preview || !confirmed || !title.trim()} onClick={() => decide("approve")}>
          {busy ? "Saving…" : "Approve for Alison"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}