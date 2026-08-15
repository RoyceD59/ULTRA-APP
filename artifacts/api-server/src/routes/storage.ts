import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { Router, type IRouter, type Request, type Response } from "express";
import sharp from "sharp";

import { getOrCreateDerivative, snapWidth } from "../lib/image-derivatives";

import { verifyToken } from "../lib/jwt.js";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

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

/**
 * POST /api/uc/uploads/request-url
 *
 * Step 1 of the two-step upload flow used by the Companion app (review media,
 * ticket media, product media). Requires a valid UC bearer token so anonymous
 * callers cannot mint write-capable URLs. The client then PUTs the file bytes
 * directly to the returned presigned GCS URL — never through this server.
 */
router.post("/uc/uploads/request-url", async (req: Request, res: Response): Promise<void> => {
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { name, size, contentType } = req.body as {
    name?: string; size?: number; contentType?: string;
  };
  if (!name || typeof size !== "number" || !contentType) {
    res.status(400).json({ error: "name, size and contentType are required" });
    return;
  }

  const isImage = IMAGE_TYPES.has(contentType);
  const isVideo = VIDEO_TYPES.has(contentType);
  const isPdf   = PDF_TYPES.has(contentType);
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
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath, kind: isVideo ? "video" : isPdf ? "document" : "photo" });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /api/storage/objects/*
 *
 * Serves uploaded objects (review media, product media). These are shown to
 * every app user inside reviews and product galleries, so they are served
 * without auth — upload capability is what's restricted, not viewing.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = req.params["path"];
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : String(raw);
    // Only objects minted by the upload endpoint above (uploads/<uuid>) are
    // servable. Everything else under PRIVATE_OBJECT_DIR stays private.
    if (!/^uploads\/[A-Za-z0-9-]+$/.test(wildcardPath)) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    const objectPath = `/objects/${wildcardPath}`;

    // Thumbnail request (?w=<px>): serve a width-bucketed WebP derivative so
    // review-list thumbnails don't download multi-megabyte originals over
    // mobile data. Any failure (video, GIF, HEIC, storage hiccup) falls
    // through to streaming the original bytes below.
    const wRaw = parseInt(String(req.query["w"] ?? ""), 10);
    if (!isNaN(wRaw) && wRaw > 0) {
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

export default router;
