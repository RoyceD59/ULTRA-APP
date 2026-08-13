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
import { eq, desc } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { verifyToken } from "../lib/jwt.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();

// Allowed MIME-type prefix — reject anything that is not a document/image/PDF.
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
    // 1. Look up the pending slot.
    const [slot] = await db
      .select()
      .from(teamLibraryPendingUploadsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
      .where(eq(teamLibraryPendingUploadsTable.id as any, uploadId))
      .limit(1);

    if (!slot) {
      res.status(404).json({ error: "Upload slot not found — request a new upload URL" });
      return;
    }
    // 2. Ownership check.
    if (slot.uploadedBy !== member.email) {
      res.status(403).json({ error: "Upload slot belongs to a different user" });
      return;
    }
    // 3. Consumed check.
    if (slot.consumed) {
      res.status(409).json({ error: "Upload slot already used — request a new upload URL" });
      return;
    }
    // 4. Expiry check.
    if (new Date() > slot.expiresAt) {
      res.status(410).json({ error: "Upload slot expired — request a new upload URL" });
      return;
    }

    // 5. Verify the object actually landed in GCS.
    let gcsFile;
    try {
      gcsFile = await storage.getObjectEntityFile(slot.objectPath);
    } catch {
      res.status(422).json({ error: "Uploaded file not found in storage — upload may have failed" });
      return;
    }

    // 6. Size / type guard using GCS metadata as ground truth.
    const [gcsMeta] = await gcsFile.getMetadata();
    const actualContentType = String((gcsMeta as Record<string, unknown>)["contentType"] ?? "");
    const actualSize = Number((gcsMeta as Record<string, unknown>)["size"] ?? 0);

    if (actualSize > MAX_FILE_BYTES) {
      res.status(422).json({ error: "Uploaded file exceeds maximum allowed size" });
      return;
    }
    const allowedType = ALLOWED_MIME_PREFIXES.some((p) => fileType.startsWith(p));
    if (!allowedType) {
      res.status(422).json({ error: "File type not allowed" });
      return;
    }
    // Ensure the declared MIME category matches GCS's detected one (coarse check).
    const declaredCategory = ALLOWED_MIME_PREFIXES.find((p) => slot.declaredType.startsWith(p));
    const actualCategory   = ALLOWED_MIME_PREFIXES.find((p) => actualContentType.startsWith(p));
    if (declaredCategory && actualCategory && declaredCategory !== actualCategory) {
      res.status(422).json({ error: "File MIME type does not match the declared type" });
      return;
    }

    // 7. Promote to docs table and mark slot consumed.
    const doc = {
      id:         randomUUID(),
      title:      title.trim().slice(0, 200),
      fileName:   fileName.slice(0, 255),
      fileSize:   actualSize || fileSize,
      fileType:   actualContentType || fileType.slice(0, 100),
      objectPath: slot.objectPath,   // server-issued path, never from the client
      uploadedBy: member.email,
    };
    await db.insert(teamLibraryDocsTable).values(doc);
    await db
      .update(teamLibraryPendingUploadsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
      .set({ consumed: true })
      .where(eq(teamLibraryPendingUploadsTable.id as any, uploadId));

    const [saved] = await db
      .select()
      .from(teamLibraryDocsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
      .where(eq(teamLibraryDocsTable.id as any, doc.id));
    res.status(201).json(saved);
  } catch (err) {
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
  if (member.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const docId = String(req.params["id"]);
  try {
    const [doc] = await db.select().from(teamLibraryDocsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle text-PK type narrowing quirk with project references
      .where(eq(teamLibraryDocsTable.id as any, docId));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    // Delete from GCS (non-fatal if already gone)
    try {
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
