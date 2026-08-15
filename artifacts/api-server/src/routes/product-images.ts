import { Router, type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import sharp from "sharp";
import { getOrCreateDerivative, snapWidth } from "../lib/image-derivatives";

/**
 * On-the-fly product image resizing.
 *
 * GET /api/uc/product-images/<file>?w=<px>&fmt=webp
 *
 * The mobile app displays catalogue images at small sizes (56–200 pt), but the
 * originals are 533×800 JPEGs. Serving a width-bucketed WebP derivative cuts
 * the transfer to a fraction of the original bytes — the single biggest lever
 * for perceived image speed on slow connections.
 *
 * - Derivatives are generated once with sharp and cached on local disk.
 * - Requests without `w` fall through to express.static (original bytes),
 *   as do any errors — resizing must never make an image FAIL to load.
 * - Responses are immutable-cacheable: the catalogue files change rarely and
 *   a changed image ships under a new filename.
 */

const SRC_DIR = path.join(process.cwd(), "public", "products");
const CACHE_DIR = path.join(os.tmpdir(), "uc-product-image-cache");

/** Strict filename allow-list — also blocks any path traversal. */
const FILE_RE = /^[a-z0-9][a-z0-9._-]*\.(jpe?g|png)$/i;

const router = Router();

router.get(
  "/:file",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const file = String(req.params["file"] ?? "");
    const wRaw = parseInt(String(req.query["w"] ?? ""), 10);

    // No/invalid width → serve the original via the static middleware.
    if (!FILE_RE.test(file) || isNaN(wRaw) || wRaw <= 0) {
      next();
      return;
    }

    try {
      const width = snapWidth(wRaw);
      const webp = String(req.query["fmt"] ?? "") === "webp";
      const ext = webp ? "webp" : "jpeg";

      const srcPath = path.join(SRC_DIR, file);
      // (FILE_RE forbids "/" and "..", so srcPath cannot escape SRC_DIR.)
      const srcStat = await fsp.stat(srcPath).catch(() => null);
      if (!srcStat?.isFile()) {
        next(); // static middleware produces the 404
        return;
      }

      // base64url of the original name → collision-free cache key even for
      // filenames that only differ in characters a lossy sanitizer would fold.
      const cacheFile = `${Buffer.from(file).toString("base64url")}-w${width}.${ext}`;

      const cachePath = await getOrCreateDerivative(CACHE_DIR, cacheFile, async (tmpPath) => {
        const pipeline = sharp(srcPath).resize({ width, withoutEnlargement: true });
        await (webp
          ? pipeline.webp({ quality: 80 })
          : pipeline.jpeg({ quality: 80, mozjpeg: true })
        ).toFile(tmpPath);
      });

      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      res.setHeader("Content-Type", webp ? "image/webp" : "image/jpeg");
      res.sendFile(cachePath, (err) => {
        if (err && !res.headersSent) next();
      });
    } catch (err) {
      req.log?.warn({ err, file }, "product image resize failed — serving original");
      if (!res.headersSent) next();
    }
  },
);

export default router;
