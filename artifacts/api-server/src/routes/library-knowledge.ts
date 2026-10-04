import { Router, type Request, type Response } from "express";
import { db, teamLibraryDocsTable, teamUsersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { ObjectStorageService } from "../lib/objectStorage.js";
import { verifyToken } from "../lib/jwt.js";
import { isLibraryPath, normalizeMime } from "../lib/libraryFinalizer.js";
import { extractLibraryReference, MAX_REFERENCE_BYTES, readReferenceStream, ReferenceExtractionError } from "../lib/library-knowledge.js";

export async function requireLibraryAdmin(req: Request, res: Response) {
  const claims = verifyToken(req.headers.authorization);
  if (!claims || claims.type !== "team-session") {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const [member] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.id, String(claims.id)));
  if (!member?.isActive || member.role !== "admin") {
    res.status(403).json({ error: "Active administrator access required" });
    return null;
  }
  return member;
}

export function createLibraryKnowledgeRouter(storage: Pick<ObjectStorageService, "getObjectEntityFile">) {
  const router = Router();
  router.use("/library/docs/:id/knowledge", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  async function extract(doc: typeof teamLibraryDocsTable.$inferSelect) {
    if (!isLibraryPath(doc.objectPath)) throw new ReferenceExtractionError("Unexpected document storage path.");
    const file = await storage.getObjectEntityFile(doc.objectPath);
    const [meta] = await file.getMetadata();
    if (Number(meta.size) > MAX_REFERENCE_BYTES) throw new ReferenceExtractionError("Alison references must be at most 32 KB.");
    if (normalizeMime(String(meta.contentType ?? "")) !== normalizeMime(doc.fileType)) {
      throw new ReferenceExtractionError("Document content type changed; upload a new document.");
    }
    return extractLibraryReference(await readReferenceStream(file.createReadStream()), String(meta.contentType ?? ""));
  }

  router.get("/library/docs/:id/knowledge", async (req, res) => {
    try {
      if (!await requireLibraryAdmin(req, res)) return;
      const [doc] = await db.select().from(teamLibraryDocsTable).where(eq(teamLibraryDocsTable.id, String(req.params.id)));
      if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
      const reference = await extract(doc);
      res.json({ ...reference, revision: doc.knowledgeRevision, status: doc.knowledgeStatus,
        title: doc.knowledgeTitle ?? "", approvedText: doc.knowledgeText });
    } catch (error) {
      res.status(error instanceof ReferenceExtractionError ? 422 : 503).json({
        error: error instanceof ReferenceExtractionError ? error.message : "Document review is temporarily unavailable",
      });
    }
  });

  router.post("/library/docs/:id/knowledge", async (req, res) => {
    try {
      const member = await requireLibraryAdmin(req, res);
      if (!member) return;
      const { action, revision, hash, title, publicReferenceConfirmed } = req.body ?? {};
      if (!["approve", "revoke"].includes(action) || !Number.isSafeInteger(revision) || revision < 0) {
        res.status(400).json({ error: "A valid action and review revision are required" }); return;
      }
      const [doc] = await db.select().from(teamLibraryDocsTable).where(eq(teamLibraryDocsTable.id, String(req.params.id)));
      if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
      if (doc.knowledgeRevision !== revision) {
        res.status(409).json({ error: "Another administrator changed this document. Reload and review again." }); return;
      }
      let approved: { knowledgeTitle: string; knowledgeText: string; knowledgeHash: string } | null = null;
      if (action === "approve") {
        if (publicReferenceConfirmed !== true || typeof title !== "string" || !title.trim() || title.trim().length > 160
          || /https?:|gs:|\/objects\/|@|[\x00-\x1f]/i.test(title)) {
          res.status(400).json({ error: "Enter a public source title (1–160 characters, no URLs or email addresses) and confirm the privacy review." }); return;
        }
        const reference = await extract(doc);
        if (typeof hash !== "string" || hash !== reference.hash) {
          res.status(409).json({ error: "Document changed since preview. Reload and review again." }); return;
        }
        approved = { knowledgeTitle: title.trim(), knowledgeText: reference.text, knowledgeHash: reference.hash };
      }
      const [saved] = await db.update(teamLibraryDocsTable).set({
        knowledgeStatus: action === "approve" ? "approved" : "revoked",
        knowledgeTitle: approved?.knowledgeTitle ?? null,
        knowledgeText: approved?.knowledgeText ?? null,
        knowledgeHash: approved?.knowledgeHash ?? null,
        knowledgeReviewedBy: member.id,
        knowledgeReviewedAt: new Date(),
        knowledgeRevision: sql`${teamLibraryDocsTable.knowledgeRevision} + 1`,
      }).where(and(eq(teamLibraryDocsTable.id, doc.id), eq(teamLibraryDocsTable.knowledgeRevision, revision)))
        .returning({ id: teamLibraryDocsTable.id, knowledgeStatus: teamLibraryDocsTable.knowledgeStatus,
          knowledgeRevision: teamLibraryDocsTable.knowledgeRevision, knowledgeTitle: teamLibraryDocsTable.knowledgeTitle,
          knowledgeReviewedAt: teamLibraryDocsTable.knowledgeReviewedAt, knowledgeReviewedBy: teamLibraryDocsTable.knowledgeReviewedBy });
      if (!saved) { res.status(409).json({ error: "Document changed. Reload and review again." }); return; }
      res.json(saved);
    } catch (error) {
      res.status(error instanceof ReferenceExtractionError ? 422 : 503).json({
        error: error instanceof ReferenceExtractionError ? error.message : "Document approval is temporarily unavailable",
      });
    }
  });
  return router;
}