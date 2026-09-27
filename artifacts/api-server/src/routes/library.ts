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
 * Finalization business logic lives in ../lib/libraryFinalizer.ts.
 * This file contains only HTTP plumbing: auth, request validation, DB/GCS
 * adapter wiring, and response marshalling.
 *
 * Key guarantees (enforced in libraryFinalizer.ts):
 *  – uploadId is an opaque server-issued token; objectPath is never client-supplied.
 *  – Slot consumption is atomic (conditional UPDATE WHERE consumed=false AND expiresAt>now()).
 *  – GCS actual contentType is the sole authority for MIME validation.
 *  – All library objects are restricted to the /objects/library/ prefix.
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { randomUUID } from "crypto";
import {
  db,
  teamLibraryDocsTable,
  teamLibraryPendingUploadsTable,
} from "@workspace/db";
import { eq, and, gt, desc, lt } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { verifyToken } from "../lib/jwt.js";
import {
  finalizeUpload,
  purgeAbandonedSlots,
  isLibraryPath,
  ALLOWED_MIME_TYPES,
  normalizeMime,
  MAX_FILE_BYTES,
  LIBRARY_PATH_PREFIX,
  type FinalizerDeps,
} from "../lib/libraryFinalizer.js";

type LibraryStorage = Pick<
  ObjectStorageService,
  | "getLibraryUploadURL"
  | "normalizeObjectEntityPath"
  | "getObjectEntityFile"
  | "copyLibraryFileWithGenerationCheck"
>;

/**
 * Creates the Team Library router with an explicit storage dependency.
 * Production uses the default adapter; tests can supply an isolated in-memory
 * adapter without mutating ObjectStorageService's process-global prototype.
 */
export function createLibraryRouter(
  storage: LibraryStorage = new ObjectStorageService(),
): IRouter {
  const router: IRouter = Router();

// Presigned URLs are valid for 15 minutes; give the upload slot a generous
// 30-minute window to account for slow connections.
const UPLOAD_SLOT_TTL_MS = 30 * 60 * 1000;

// ─── Auth helpers ──────────────────────────────────────────────────────────────

function getMember(
  authHeader: string | undefined,
): { id: string; email: string; role: string } | null {
  const claims = verifyToken(authHeader);
  if (!claims || claims.type !== "team-session") return null;
  return {
    id:    String(claims.id),
    email: String(claims.email ?? ""),
    role:  String(claims.role ?? ""),
  };
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
  if (fileSize > MAX_FILE_BYTES) {
    res.status(400).json({ error: "File too large — maximum 50 MB" });
    return;
  }
  const allowedType = ALLOWED_MIME_TYPES.has(normalizeMime(fileType));
  if (!allowedType) {
    res.status(400).json({ error: "File type not allowed" });
    return;
  }

  try {
    const uploadURL  = await storage.getLibraryUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    const uploadId   = randomUUID();
    const expiresAt  = new Date(Date.now() + UPLOAD_SLOT_TTL_MS);

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
// Thin HTTP wrapper around finalizeUpload() in libraryFinalizer.ts.
router.post("/library/docs", async (req: Request, res: Response): Promise<void> => {
  const member = requireMember(res, req.headers["authorization"]);
  if (!member) return;

  const { title, fileName, fileSize, fileType, uploadId } = req.body as {
    title?: string; fileName?: string; fileSize?: number; fileType?: string; uploadId?: string;
  };
  // fileSize and fileType are accepted for client-side UX only; they are NOT used
  // for any security decision — GCS metadata is the authoritative source.
  if (!title?.trim() || !fileName || typeof fileSize !== "number" || !fileType || !uploadId) {
    res.status(400).json({ error: "title, fileName, fileSize, fileType, and uploadId are required" });
    return;
  }

  // Build the dependency adapter that bridges libraryFinalizer to real DB/GCS.
  const deps: FinalizerDeps = {
    async getSlot(id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [s] = await db.select().from(teamLibraryPendingUploadsTable)
        .where(eq(teamLibraryPendingUploadsTable.id as any, id)).limit(1);
      return s;
    },
    async consumeSlot(id) {
      // Atomic conditional UPDATE — only one concurrent caller wins.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await db.update(teamLibraryPendingUploadsTable)
        .set({ consumed: true })
        .where(and(
          eq(teamLibraryPendingUploadsTable.id as any, id),
          eq(teamLibraryPendingUploadsTable.consumed, false),
          gt(teamLibraryPendingUploadsTable.expiresAt, new Date()),
        ))
        .returning({ id: teamLibraryPendingUploadsTable.id });
      return rows.length > 0;
    },
    async getGcsMeta(objectPath) {
      try {
        const file = await storage.getObjectEntityFile(objectPath);
        const [meta] = await file.getMetadata();
        const m = meta as Record<string, unknown>;
        return {
          contentType: String(m["contentType"] ?? ""),
          size:        Number(m["size"] ?? 0),
          generation:  String(m["generation"] ?? "0"),
        };
      } catch {
        return null;
      }
    },
    async readFirstBytes(objectPath, count) {
      try {
        const file = await storage.getObjectEntityFile(objectPath);
        return await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          const stream = file.createReadStream({ start: 0, end: count - 1 });
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => resolve(Buffer.concat(chunks)));
          stream.on("error", reject);
        });
      } catch {
        return Buffer.alloc(0); // empty → magic check will fail → 422
      }
    },
    async copyToFinal(stagingPath, generation, finalPath) {
      const ok = await storage.copyLibraryFileWithGenerationCheck(
        stagingPath, finalPath, parseInt(generation, 10),
      );
      return { ok };
    },
    async deleteStagingObject(stagingPath) {
      try {
        const file = await storage.getObjectEntityFile(stagingPath);
        await file.delete();
      } catch { /* staging already gone — fine */ }
    },
    async insertDoc(doc) {
      await db.insert(teamLibraryDocsTable).values(doc);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [saved] = await db.select().from(teamLibraryDocsTable)
        .where(eq(teamLibraryDocsTable.id as any, doc.id));
      return saved;
    },
    async purgeExpired() {
      await purgeAbandonedSlots({
        async listExpiredSlots() {
          return db
            .select({
              objectPath: teamLibraryPendingUploadsTable.objectPath,
              consumed:   teamLibraryPendingUploadsTable.consumed,
            })
            .from(teamLibraryPendingUploadsTable)
            .where(lt(teamLibraryPendingUploadsTable.expiresAt, new Date()));
        },
        async deleteObject(objectPath) {
          try {
            const file = await storage.getObjectEntityFile(objectPath);
            await file.delete();
          } catch { /* already gone — fine */ }
        },
        async deleteExpiredSlots() {
          await db
            .delete(teamLibraryPendingUploadsTable)
            .where(lt(teamLibraryPendingUploadsTable.expiresAt, new Date()));
        },
      });
    },
  };

  try {
    const result = await finalizeUpload({ uploadId, memberEmail: member.email, title, fileName }, deps);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.message });
      return;
    }
    res.status(201).json(result.doc);
  } catch (err) {
    console.error("[library] finalise error:", err);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [doc] = await db.select().from(teamLibraryDocsTable)
      .where(eq(teamLibraryDocsTable.id as any, docId));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    // Enforce library prefix — refuse to stream objects outside the library sub-prefix.
    if (!doc.objectPath.startsWith(LIBRARY_PATH_PREFIX)) {
      res.status(400).json({ error: "Document has an unexpected storage path" });
      return;
    }

    try {
      const file = await storage.getObjectEntityFile(doc.objectPath);
      await file.delete();
    } catch {
      // Object already deleted or not found — continue with metadata cleanup.
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.delete(teamLibraryDocsTable).where(eq(teamLibraryDocsTable.id as any, docId));
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [doc] = await db.select().from(teamLibraryDocsTable)
      .where(eq(teamLibraryDocsTable.id as any, docId));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    // Enforce library prefix — refuse to stream objects outside the library sub-prefix.
    if (!doc.objectPath.startsWith(LIBRARY_PATH_PREFIX)) {
      res.status(400).json({ error: "Document has an unexpected storage path" });
      return;
    }

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

  return router;
}

const router = createLibraryRouter();
export default router;
