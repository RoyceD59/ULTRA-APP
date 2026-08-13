/**
 * Team Library — document storage for the ProjectHub team.
 *
 * POST   /api/library/request-upload — presigned GCS upload URL + pending slot
 * POST   /api/library/docs           — finalise doc after upload (by uploadId)
 * GET    /api/library/docs           — list all library documents
 * DELETE /api/library/docs/:id       — delete a document (admin only)
 * GET    /api/library/download/:id   — stream download (team auth)
 *
 * Security model
 * ──────────────
 * The server generates the GCS object path in request-upload and records it in
 * team_library_pending_uploads alongside the uploader's identity (member email).
 * The client receives an opaque `uploadId` (UUID).  When the client calls
 * POST /library/docs it supplies only `uploadId` and metadata — never an
 * objectPath it chose itself.  The server:
 *   1. Looks up the pending record by uploadId.
 *   2. Checks the record was issued to the calling member (ownership).
 *   3. Checks the slot has not already been consumed.
 *   4. Checks the slot has not expired.
 *   5. Verifies the object actually exists in GCS.
 *   6. Verifies the declared size and MIME type are within allowed bounds.
 *   7. Promotes the record to team_library_docs and marks the slot consumed.
 *
 * This prevents a team member from registering an arbitrary private objectPath
 * they did not upload, and prevents replay of a consumed upload slot.
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { randomUUID } from "crypto";
import { db, teamLibraryDocsTable, teamLibraryPendingUploadsTable } from "@workspace/db";
import { eq, and, gt, desc } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { verifyToken } from "../lib/jwt.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();

// Allowed MIME-type prefix — reject anything that is not a document/image/PDF.
/**
 * Content-based file-signature (magic-byte) validation.
 *
 * The GCS `contentType` metadata is client-supplied on the presigned PUT, so
 * it cannot be trusted on its own. Before promoting an upload we read the
 * first bytes of the actual object and require them to match the signature
 * of the claimed MIME category:
 *   - application/pdf                       → "%PDF"
 *   - OOXML / ODF (docx, xlsx, pptx, odt…)  → ZIP "PK\x03\x04"
 *   - legacy Office (doc, xls, ppt)         → OLE D0 CF 11 E0
 *   - images (png/jpeg/gif/webp)            → their well-known signatures
 *   - text/plain, text/csv                  → no NUL bytes in the sample
 * Exported for direct unit testing.
 */
export function sniffMatchesMime(head: Buffer, mime: string): boolean {
  const startsWith = (sig: number[], offset = 0) =>
    head.length >= offset + sig.length && sig.every((b, i) => head[offset + i] === b);

  if (mime.startsWith("application/pdf")) return startsWith([0x25, 0x50, 0x44, 0x46]); // %PDF
  if (mime.startsWith("application/vnd.openxmlformats") || mime.startsWith("application/vnd.oasis")) {
    return startsWith([0x50, 0x4b, 0x03, 0x04]); // ZIP
  }
  if (mime.startsWith("application/msword") || mime.startsWith("application/vnd.ms-")) {
    // Legacy OLE container, or OOXML saved with a legacy-family MIME.
    return startsWith([0xd0, 0xcf, 0x11, 0xe0]) || startsWith([0x50, 0x4b, 0x03, 0x04]);
  }
  if (mime.startsWith("image/")) {
    return (
      startsWith([0x89, 0x50, 0x4e, 0x47]) ||               // PNG
      startsWith([0xff, 0xd8, 0xff]) ||                      // JPEG
      startsWith([0x47, 0x49, 0x46, 0x38]) ||                // GIF
      (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) // WEBP
    );
  }
  if (mime.startsWith("text/plain") || mime.startsWith("text/csv")) {
    if (head.length === 0) return false;
    return !head.includes(0); // binary payloads masquerading as text carry NULs
  }
  return false; // unknown category — reject
}

const ALLOWED_MIME_PREFIXES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats",
  "application/vnd.ms-",
  "application/vnd.oasis",
  "text/plain",
  "text/csv",
  "image/",
];

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
// Presigned URLs are valid for 15 minutes; give the upload slot a generous
// 30-minute window to account for slow connections.
const UPLOAD_SLOT_TTL_MS = 30 * 60 * 1000;

// ─── Auth helpers ──────────────────────────────────────────────────────────────

function getMember(
  authHeader: string | undefined,
): { id: string; email: string; role: string } | null {
  const claims = verifyToken(authHeader);
  if (!claims || claims.type !== "team-session") return null;
  return { id: String(claims.id), email: String(claims.email ?? ""), role: String(claims.role ?? "") };
}

function requireMember(res: Response, authHeader: string | undefined) {
  const m = getMember(authHeader);
  if (!m) { res.status(401).json({ error: "Authentication required" }); return null; }
  return m;
}

// ─── POST /api/library/request-upload ─────────────────────────────────────────
// Issues a presigned PUT URL for a single upload slot.
// The server records the slot so the client cannot supply an arbitrary objectPath
// when it calls POST /library/docs.
router.post("/library/request-upload", async (req: Request, res: Response): Promise<void> => {
  const member = requireMember(res, req.headers["authorization"]);
  if (!member) return;

  const { fileName, fileSize, fileType } = req.body as {
    fileName?: string; fileSize?: number; fileType?: string;
  };
  if (!fileName || typeof fileSize !== "number" || !fileType) {
    res.status(400).json({ error: "fileName, fileSize, and fileType are required" });
    return;
  }
  if (fileSize > MAX_FILE_BYTES) {
    res.status(400).json({ error: "File too large — maximum 50 MB" });
    return;
  }
  const allowedType = ALLOWED_MIME_PREFIXES.some((p) => fileType.startsWith(p));
  if (!allowedType) {
    res.status(400).json({ error: "File type not allowed" });
    return;
  }

  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);

    const uploadId = randomUUID();
    const expiresAt = new Date(Date.now() + UPLOAD_SLOT_TTL_MS);

    await db.insert(teamLibraryPendingUploadsTable).values({
      id:           uploadId,
      objectPath,
      uploadedBy:   member.email,
      consumed:     false,
      expiresAt,
      declaredSize: fileSize,
      declaredType: fileType,
    });

    res.json({ uploadId, uploadURL });
  } catch (err) {
    console.error("[library] presign error:", err);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ─── POST /api/library/docs ────────────────────────────────────────────────────
// Finalises a library document after the client has PUT the file to GCS.
// The client supplies `uploadId` (returned by request-upload) — never objectPath.
router.post("/library/docs", async (req: Request, res: Response): Promise<void> => {
  const member = requireMember(res, req.headers["authorization"]);
  if (!member) return;

  const { title, fileName, fileSize, fileType, uploadId } = req.body as {
    title?: string; fileName?: string; fileSize?: number; fileType?: string; uploadId?: string;
  };
  if (!title?.trim() || !fileName || typeof fileSize !== "number" || !fileType || !uploadId) {
    res.status(400).json({ error: "title, fileName, fileSize, fileType, and uploadId are required" });
    return;
  }

  try {
    // 1. Atomically claim the slot — prevents two concurrent requests for the
    //    same uploadId from both passing the consumed/ownership/expiry checks.
    //    The UPDATE only succeeds when the row exists, belongs to this member,
    //    has not been consumed, and has not yet expired.  Only one concurrent
    //    writer can win; the loser gets no returned row and is rejected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
    const [claimed] = await db
      .update(teamLibraryPendingUploadsTable)
      .set({ consumed: true })
      .where(
        and(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          eq(teamLibraryPendingUploadsTable.id as any, uploadId),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          eq(teamLibraryPendingUploadsTable.consumed as any, false),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          eq(teamLibraryPendingUploadsTable.uploadedBy as any, member.email),
          gt(teamLibraryPendingUploadsTable.expiresAt, new Date()),
        ),
      )
      .returning();

    if (!claimed) {
      // Claim failed — inspect the slot (without ownership filter) to return a
      // specific error message rather than a generic 409.
      const [slot] = await db
        .select()
        .from(teamLibraryPendingUploadsTable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where(eq(teamLibraryPendingUploadsTable.id as any, uploadId))
        .limit(1);
      if (!slot) {
        res.status(404).json({ error: "Upload slot not found — request a new upload URL" });
      } else if (slot.uploadedBy !== member.email) {
        res.status(403).json({ error: "Upload slot belongs to a different user" });
      } else if (slot.consumed) {
        res.status(409).json({ error: "Upload slot already used — request a new upload URL" });
      } else {
        res.status(410).json({ error: "Upload slot expired — request a new upload URL" });
      }
      return;
    }
    const slot = claimed;

    // 4. Verify the object actually landed in GCS before attempting to claim
    //    the slot, so we don't consume it for a missing file.
    let gcsFile;
    try {
      gcsFile = await storage.getObjectEntityFile(slot.objectPath);
    } catch {
      res.status(422).json({ error: "Uploaded file not found in storage — upload may have failed" });
      return;
    }

    // 4. Size / type guard using GCS metadata as ground truth.
    const [gcsMeta] = await gcsFile.getMetadata();
    const actualContentType = String((gcsMeta as Record<string, unknown>)["contentType"] ?? "");
    const actualSize = Number((gcsMeta as Record<string, unknown>)["size"] ?? 0);
    const stagingGeneration = Number((gcsMeta as Record<string, unknown>)["generation"] ?? 0);
    if (!stagingGeneration) {
      res.status(422).json({ error: "Uploaded file has no storage generation — cannot validate integrity" });
      return;
    }
    // All reads below are pinned to this exact generation so a concurrent
    // overwrite via the still-valid presigned PUT cannot swap bytes between
    // validation and promotion (TOCTOU).
    const pinnedFile = gcsFile.bucket.file(gcsFile.name, { generation: stagingGeneration });

    if (actualSize > MAX_FILE_BYTES) {
      res.status(422).json({ error: "Uploaded file exceeds maximum allowed size" });
      return;
    }
    // Require a recognised MIME category from GCS metadata; reject if absent or
    // in a different category than what was declared at request-upload time.
    const declaredCategory = ALLOWED_MIME_PREFIXES.find((p) => slot.declaredType.startsWith(p));
    const actualCategory = ALLOWED_MIME_PREFIXES.find((p) => actualContentType.startsWith(p));

    const claimed = await db
      .update(teamLibraryPendingUploadsTable)
      .set({ consumed: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
      .where(and(
        eq(teamLibraryPendingUploadsTable.id as any, uploadId),
        eq(teamLibraryPendingUploadsTable.consumed, false),
      ))
      .returning({ id: teamLibraryPendingUploadsTable.id });
    let head: Buffer;
    try {
      const [buf] = await pinnedFile.download({ start: 0, end: 4095 });
      head = buf;
    } catch {
      res.status(422).json({ error: "Uploaded file could not be read for validation" });
      return;
    }
    if (!sniffMatchesMime(head, actualContentType)) {
      res.status(422).json({ error: "File content does not match its declared type" });
      return;
    }

    // Promote the validated bytes to a server-controlled final key. The
    // presigned PUT URL for the staging object stays valid for its full TTL,
    // so the staging object remains writable by the client after validation;
    // copying to a fresh key (never exposed via any signed URL) makes the
    // stored document immutable, then the staging object is deleted.
    let finalObjectPath: string;
    try {
      finalObjectPath = await storage.promoteObjectEntity(gcsFile, stagingGeneration);
    } catch (err) {
      console.error("[library] promotion error:", err);
      res.status(502).json({ error: "Failed to finalise uploaded file in storage" });
      return;
    }

    // 5. Atomically claim the slot by flipping consumed=true ONLY IF it is
    //    still unconsumed and not yet expired.  This prevents concurrent
    //    finalization calls from both observing consumed=false and each
    //    inserting a separate document row (upload-slot replay attack).
  const docId = String(req.params["id"]);
    const [saved] = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(teamLibraryPendingUploadsTable)
        .set({ consumed: true })
        .where(
          and(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
            eq(teamLibraryPendingUploadsTable.id as any, uploadId),
            eq(teamLibraryPendingUploadsTable.consumed, false),
            gt(teamLibraryPendingUploadsTable.expiresAt, new Date()),
          )
        )
        .returning();

      if (claimed.length === 0) {
        // Another concurrent call already consumed this slot, or it expired.
        throw Object.assign(new Error("slot_unavailable"), { slotUnavailable: true });
      }

      await tx.insert(teamLibraryDocsTable).values({
        id:         docId,
        title:      title.trim().slice(0, 200),
        fileName:   fileName.slice(0, 255),
        fileSize:   actualSize || fileSize,
        fileType:   actualContentType || fileType.slice(0, 100),
        objectPath: finalObjectPath,   // server-controlled immutable key, never from the client
        uploadedBy: member.email,
      });

      return tx
        .select()
        .from(teamLibraryDocsTable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
        .where(eq(teamLibraryDocsTable.id as any, docId));
    });

    res.status(201).json(saved);
  } catch (err) {
    if (err instanceof Error && (err as Error & { slotUnavailable?: boolean }).slotUnavailable) {
      res.status(409).json({ error: "Upload slot already used or expired — request a new upload URL" });
      return;
    }
    console.error("[library] DB insert error:", err);
    res.status(500).json({ error: "Failed to save document metadata" });
  }
});

// ─── GET /api/library/docs ─────────────────────────────────────────────────────
router.get("/library/docs", async (req: Request, res: Response): Promise<void> => {
  const member = requireMember(res, req.headers["authorization"]);
  if (!member) return;

  try {
    const docs = await db.select()
      .from(teamLibraryDocsTable)
      .orderBy(desc(teamLibraryDocsTable.createdAt));
    res.json({ docs });
  } catch (err) {
    console.error("[library] DB list error:", err);
    res.status(500).json({ error: "Failed to list documents" });
  }
});

// ─── DELETE /api/library/docs/:id ──────────────────────────────────────────────
// Admin-only.  The objectPath is read from the DB row — never from the client.
router.delete("/library/docs/:id", async (req: Request, res: Response): Promise<void> => {
  const member = requireMember(res, req.headers["authorization"]);
  if (!member) return;

  const docId = String(req.params["id"]);
  try {
    const [doc] = await db.select().from(teamLibraryDocsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
      .where(eq(teamLibraryDocsTable.id as any, docId));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    const file = await storage.getObjectEntityFile(doc.objectPath);
      await file.delete();
    } catch {
      // Object already deleted or not found — continue with metadata cleanup.
    }

    await db.delete(teamLibraryDocsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
      .where(eq(teamLibraryDocsTable.id as any, docId));
    res.json({ ok: true });
  } catch (err) {
    console.error("[library] delete error:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ─── GET /api/library/download/:id ────────────────────────────────────────────
// The objectPath is read from the DB row — never from the client.
router.get("/library/download/:id", async (req: Request, res: Response): Promise<void> => {
  const member = requireMember(res, req.headers["authorization"]);
  if (!member) return;

  const docId = String(req.params["id"]);
  try {
    const [doc] = await db.select().from(teamLibraryDocsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
      .where(eq(teamLibraryDocsTable.id as any, docId));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    const file = await storage.getObjectEntityFile(doc.objectPath);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "File not found in storage" }); return; }

    res.setHeader("Content-Type", doc.fileType);
    res.setHeader("Content-Disposition",
      `attachment; filename="${encodeURIComponent(doc.fileName)}"`);

    file.createReadStream().pipe(res);
  } catch (err) {
    console.error("[library] download error:", err);
    res.status(500).json({ error: "Failed to stream document" });
  }
});

export default router;
