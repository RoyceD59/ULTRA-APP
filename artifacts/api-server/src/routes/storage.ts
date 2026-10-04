import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { Router, type IRouter, type Request, type Response } from "express";
import sharp from "sharp";

import { getOrCreateDerivative, snapWidth } from "../lib/image-derivatives";

import { verifyToken } from "../lib/jwt.js";
import { pool } from "@workspace/db";
import { getLiveWaterTestsAccess } from "../lib/adminAuth.js";
import { authorizeInstantActionUpload } from "../lib/instant-water-check-service.js";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

type StorageAdapter = Pick<ObjectStorageService,
  "getPrivateUploadURL" | "normalizeObjectEntityPath" | "getObjectEntityFile" | "downloadObject">;

/** Disposable per-instance cache of resized upload thumbnails (see image-derivatives). */
const STORAGE_THUMB_CACHE_DIR = path.join(os.tmpdir(), "uc-storage-thumb-cache");

// ─── Upload allowlist ─────────────────────────────────────────────────────────
// Only these MIME types may receive a presigned PUT URL. Everything else is
// rejected before a URL is minted so unsafe files (executables, HTML, SVG with
// XSS payloads, etc.) never land in the storage bucket.
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // iOS devices often produce HEIC/HEIF; safe to allow, rejected at serve time
  // if not image/* (forced to octet-stream attachment).
  "image/heic",
  "image/heif",
]);
const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  // Android devices commonly produce webm/3gpp; both are safe container formats.
  "video/webm",
  "video/3gpp",
]);
const PDF_TYPES = new Set(["application/pdf"]);

/** Instance-local adapter keeps route tests independent of real object storage. */
export function createStorageRouter(objectStorageService: StorageAdapter = new ObjectStorageService()): IRouter {
const router: IRouter = Router();

/**
 * POST /api/uc/uploads/request-url
 *
 * Step 1 of the two-step upload flow used by the Companion app (review media,
 * ticket media, product media). Requires a valid UC bearer token so anonymous
 * callers cannot mint write-capable URLs. The client then PUTs the file bytes
 * directly to the returned presigned GCS URL — never through this server.
 */
router.post("/uc/uploads/request-url", async (req: Request, res: Response): Promise<void> => {
  const { assessmentId: uploadAssessmentId, actionToken } = req.body as { assessmentId?: string; actionToken?: string };
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims && !(uploadAssessmentId && actionToken)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (actionToken && uploadAssessmentId) {
    try {
      await authorizeInstantActionUpload(actionToken, uploadAssessmentId);
    } catch {
      res.status(401).json({ error: "Assessment action token required" });
      return;
    }
  }
  let privateNamespace: string | null = null;
  let uploaderUserId: string | null = claims ? String(claims.id) : null;
  if (uploadAssessmentId) {
    if (actionToken) {
      privateNamespace = `water-tests/${uploadAssessmentId}/lead`;
      uploaderUserId = null;
    } else if (claims) {
      const owner = await pool.query(
        `SELECT 1 FROM instant_water_assessments
          WHERE id = $1 AND customer_user_id = $2 AND account_link_state = 'attached'
          LIMIT 1`,
        [uploadAssessmentId, String(claims.id)],
      );
      if (!owner.rows[0]) {
        res.status(403).json({ error: "Assessment owner required" });
        return;
      }
      privateNamespace = `water-tests/${uploadAssessmentId}/customer-${String(claims.id)}`;
    } else {
      res.status(401).json({ error: "Assessment action token required" });
      return;
    }
  }

  const { name, size, contentType } = req.body as {
    name?: string; size?: number; contentType?: string; assessmentId?: string;
  };
  if (!name || typeof size !== "number" || !contentType) {
    res.status(400).json({ error: "name, size and contentType are required" });
    return;
  }

  const isImage = IMAGE_TYPES.has(contentType);
  const isVideo = VIDEO_TYPES.has(contentType);
  const isPdf   = PDF_TYPES.has(contentType);
  if (uploadAssessmentId && isPdf) {
    res.status(400).json({ error: "Assessment evidence must be an image or video" });
    return;
  }
  if (!isImage && !isVideo && !isPdf) {
    res.status(400).json({
      error: `File type not allowed: ${contentType}. Accepted types are images (JPEG, PNG, WebP, GIF), videos (MP4, QuickTime), and PDFs.`,
    });
    return;
  }
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size <= 0 || size > maxBytes) {
    res.status(400).json({
      error: `File too large — ${isVideo ? "videos" : "images and PDFs"} must be under ${Math.round(maxBytes / 1024 / 1024)} MB`,
    });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getPrivateUploadURL(privateNamespace ?? "uploads");
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    await pool.query(
      `INSERT INTO instant_water_media_uploads
        (object_path, uploader_user_id, assessment_id, declared_type, declared_size, scan_status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', now() + interval '30 minutes')
       ON CONFLICT (object_path) DO UPDATE SET
         uploader_user_id = EXCLUDED.uploader_user_id,
         assessment_id = EXCLUDED.assessment_id,
         declared_type = EXCLUDED.declared_type,
         declared_size = EXCLUDED.declared_size,
          scan_status = 'pending',
         expires_at = EXCLUDED.expires_at`,
      [objectPath, uploaderUserId, uploadAssessmentId ?? null, contentType, size],
    );
    res.json({ uploadURL, objectPath, kind: isVideo ? "video" : isPdf ? "document" : "photo" });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /api/storage/objects/*
 *
 * Serves only generic uploads. Assessment evidence uses the private route below.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = req.params["path"];
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : String(raw);
    // Only objects minted by the upload endpoint above (uploads/<uuid>) are
    // servable. Everything else under PRIVATE_OBJECT_DIR stays private.
    const guidePrefix = "library/guides/";
    const guideParts = wildcardPath.startsWith(guidePrefix) ? wildcardPath.slice(guidePrefix.length).split("/") : [];
    const isGuideObject = guideParts.length > 0 &&
      guideParts.every((part) => part.length > 0 && part !== "." && part !== ".." && !part.includes("..") && !part.includes("\\"));
    if (!/^uploads\/[A-Za-z0-9-]+$/.test(wildcardPath) && !isGuideObject) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    const objectPath = `/objects/${wildcardPath}`;
    if (isGuideObject) {
      const guideObject = await pool.query(
        `SELECT 1 FROM uc_guide_media m JOIN uc_guide_sections s ON s.id=m.section_id
          JOIN uc_guides g ON g.id=s.guide_id
         WHERE m.object_path=$1 AND g.status='published' LIMIT 1`,
        [objectPath],
      );
      if (!guideObject.rows[0]) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
    }
    const bound = await pool.query(
      `SELECT 1 FROM instant_water_media_uploads
        WHERE object_path = $1 AND assessment_id IS NOT NULL
        LIMIT 1`,
      [objectPath],
    );
    if (bound.rows[0]) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    // Thumbnail request (?w=<px>): serve a width-bucketed WebP derivative so
    // review-list thumbnails don't download multi-megabyte originals over
    // mobile data. Any failure (video, GIF, HEIC, storage hiccup) falls
    // through to streaming the original bytes below.
    const wRaw = parseInt(String(req.query["w"] ?? ""), 10);
    // Guide media is immutable and must be served byte-for-byte: in particular,
    // never send animated GIF/WebP through sharp, which can drop animation
    // frames. Guide clients use the original object and its poster instead.
    if (!isGuideObject && !isNaN(wRaw) && wRaw > 0) {
      const width = snapWidth(wRaw);
      const uuid = wildcardPath.slice("uploads/".length);
      try {
        const cachePath = await getOrCreateDerivative(
          STORAGE_THUMB_CACHE_DIR,
          `${uuid}-w${width}.webp`,
          async (tmpPath) => {
            const file = await objectStorageService.getObjectEntityFile(objectPath);
            const original = await objectStorageService.downloadObject(file, 3600 * 24 * 7);
            const contentType = String(original.headers.get("content-type") ?? "");
            if (!/^image\/(jpe?g|png|webp)$/i.test(contentType)) {
              throw new Error(`not a resizable image: ${contentType}`);
            }
            const buf = Buffer.from(await original.arrayBuffer());
            await sharp(buf)
              .resize({ width, withoutEnlargement: true })
              .webp({ quality: 80 })
              .toFile(tmpPath);
          },
        );
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Content-Type", "image/webp");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.sendFile(cachePath);
        return;
      } catch (err) {
        req.log?.debug({ err, objectPath }, "thumbnail unavailable — serving original");
      }
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile, 3600 * 24 * 7);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    // These are user-uploaded bytes served from our origin: never let the
    // browser sniff HTML/JS out of them, and only render image/video inline.
    res.setHeader("X-Content-Type-Options", "nosniff");
    // uploads/<uuid> content never changes once written — let devices and any
    // intermediate cache keep it for a year instead of re-downloading review
    // photos and product media on every visit.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    const contentType = String(response.headers.get("content-type") ?? "");
    if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment");
    }

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

router.get("/storage/private/water-tests/*path", async (req: Request, res: Response): Promise<void> => {
  const claims = verifyToken(req.headers["authorization"]);
  const raw = req.params["path"];
  const wildcardPath = Array.isArray(raw) ? raw.join("/") : String(raw);
  const match = wildcardPath.match(/^([A-Za-z0-9_-]+)\/(?:customer-[A-Za-z0-9_-]+|lead)\/([A-Za-z0-9-]+)$/);
  if (!match || !claims) {
    res.status(404).json({ error: "Object not found" });
    return;
  }
  const assessmentId = match[1];
  try {
    const teamAccess = await getLiveWaterTestsAccess(req.headers.authorization);
    let allowed = !!teamAccess;
    if (!allowed) {
      const owner = await pool.query(
        `SELECT 1 FROM instant_water_assessments
          WHERE id = $1 AND customer_user_id = $2 AND account_link_state = 'attached'
          LIMIT 1`,
        [assessmentId, String(claims.id)],
      );
      allowed = !!owner.rows[0];
    }
    if (!allowed) {
      res.status(403).json({ error: "Assessment access denied" });
      return;
    }
    const objectPath = `/objects/water-tests/${wildcardPath}`;
    const verified = await pool.query(
      `SELECT 1 FROM instant_water_media_uploads
        WHERE object_path = $1 AND assessment_id = $2 AND scan_status = 'clean'
        LIMIT 1`,
      [objectPath, assessmentId],
    );
    if (!verified.rows[0]) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile, 0);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving private water evidence");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

return router;
}

export default createStorageRouter();
