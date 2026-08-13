/**
 * Team Library — document storage for the ProjectHub team.
 *
 * POST   /api/library/request-upload — presigned GCS upload URL
 * POST   /api/library/docs           — save doc metadata after upload
 * GET    /api/library/docs           — list all library documents
 * DELETE /api/library/docs/:id       — delete a document (admin only)
 * GET    /api/library/download/:id   — stream download (team auth)
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { randomUUID } from "crypto";
import { db, teamLibraryDocsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { verifyToken } from "../lib/jwt.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();

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
  if (fileSize > 50 * 1024 * 1024) {
    res.status(400).json({ error: "File too large — maximum 50 MB" });
    return;
  }

  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    console.error("[library] presign error:", err);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ─── POST /api/library/docs ────────────────────────────────────────────────────
router.post("/library/docs", async (req: Request, res: Response): Promise<void> => {
  const member = requireMember(res, req.headers["authorization"]);
  if (!member) return;

  const { title, fileName, fileSize, fileType, objectPath } = req.body as {
    title?: string; fileName?: string; fileSize?: number; fileType?: string; objectPath?: string;
  };
  if (!title?.trim() || !fileName || typeof fileSize !== "number" || !fileType || !objectPath) {
    res.status(400).json({ error: "title, fileName, fileSize, fileType, and objectPath are required" });
    return;
  }
  // Enforce that the objectPath must be one issued by this server's upload endpoint.
  // Upload URLs always resolve to /objects/uploads/<uuid>; any other path is rejected
  // to prevent members from registering arbitrary private-bucket paths.
  if (!objectPath.startsWith("/objects/uploads/")) {
    res.status(400).json({ error: "Invalid objectPath — must be a path returned by the upload endpoint" });
    return;
  }

  try {
    const doc = {
      id:         randomUUID(),
      title:      title.trim().slice(0, 200),
      fileName:   fileName.slice(0, 255),
      fileSize,
      fileType:   fileType.slice(0, 100),
      objectPath: objectPath.slice(0, 500),
      uploadedBy: member.email,
    };
    await db.insert(teamLibraryDocsTable).values(doc);
    const [saved] = await db.select().from(teamLibraryDocsTable).where(eq(teamLibraryDocsTable.id, doc.id));
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
router.delete("/library/docs/:id", async (req: Request, res: Response): Promise<void> => {
  const member = requireMember(res, req.headers["authorization"]);
  if (!member) return;
  if (member.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const docId = String(req.params["id"] ?? "");
  try {
    const [doc] = await db.select().from(teamLibraryDocsTable)
      .where(eq(teamLibraryDocsTable.id, docId));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    // Delete from GCS (non-fatal if already gone)
    try {
      const file = await storage.getObjectEntityFile(doc.objectPath);
      await file.delete();
    } catch {
      // Object already deleted or not found — continue
    }

    await db.delete(teamLibraryDocsTable)
      .where(eq(teamLibraryDocsTable.id, docId));
    res.json({ ok: true });
  } catch (err) {
    console.error("[library] delete error:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ─── GET /api/library/download/:id ────────────────────────────────────────────
router.get("/library/download/:id", async (req: Request, res: Response): Promise<void> => {
  const member = requireMember(res, req.headers["authorization"]);
  if (!member) return;

  const docId = String(req.params["id"] ?? "");
  try {
    const [doc] = await db.select().from(teamLibraryDocsTable)
      .where(eq(teamLibraryDocsTable.id, docId));
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
