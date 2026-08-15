import { Router, type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { createHash } from "node:crypto";
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
const REMOTE_CACHE_DIR = path.join(os.tmpdir(), "uc-remote-image-cache");

/** Strict filename allow-list — also blocks any path traversal. */
const FILE_RE = /^[a-z0-9][a-z0-9._-]*\.(jpe?g|png)$/i;

/**
 * Hosts whose images we are willing to proxy-resize. WooCommerce products
 * reference originals on the store site / WordPress CDN — anything else is
 * refused (SSRF guard) and left as a direct URL.
 */
const REMOTE_HOSTS = new Set([
  "ucfilters.com",
  "www.ucfilters.com",
  "i0.wp.com",
  "i1.wp.com",
  "i2.wp.com",
  "i3.wp.com",
]);

/** Max original bytes we will pull through the resizer. */
const REMOTE_MAX_BYTES = 20 * 1024 * 1024;

/** Total disk budget for cached remote derivatives (evicted oldest-first). */
const REMOTE_CACHE_MAX_BYTES = 200 * 1024 * 1024;

/** Max simultaneous cold-cache upstream fetches; beyond this we fall back to
 *  redirecting to the original instead of queueing unbounded work. */
const REMOTE_MAX_COLD_FETCHES = 4;

/** The store WAF 403s non-browser user agents — send a browser-like UA. */
const REMOTE_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Fetches a remote image enforcing the host allow-list on EVERY redirect hop
 * (redirect:"follow" would validate only the first URL — an allowed host
 * could bounce us to an internal address), a content-type check, and a
 * streaming byte cap so an upstream cannot force unbounded memory allocation.
 */
async function fetchRemoteImage(src: string): Promise<Buffer> {
  let url = src;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !REMOTE_HOSTS.has(u.hostname)) {
      throw new Error(`redirect to disallowed target ${u.hostname}`);
    }
    const resp = await fetch(url, {
      headers: { "User-Agent": REMOTE_UA, Accept: "image/*" },
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      await resp.body?.cancel().catch(() => {});
      if (!loc) throw new Error(`redirect ${resp.status} without location`);
      url = new URL(loc, url).toString();
      continue;
    }
    if (!resp.ok) throw new Error(`upstream ${resp.status}`);
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) throw new Error(`upstream content-type ${ct || "missing"}`);
    const declared = parseInt(resp.headers.get("content-length") ?? "", 10);
    if (!isNaN(declared) && declared > REMOTE_MAX_BYTES) {
      await resp.body?.cancel().catch(() => {});
      throw new Error(`upstream content-length ${declared} over cap`);
    }
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("upstream body missing");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > REMOTE_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(`upstream body exceeded ${REMOTE_MAX_BYTES} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    if (total === 0) throw new Error("upstream body empty");
    return Buffer.concat(chunks);
  }
  throw new Error("too many redirects");
}

/** Oldest-first eviction keeping the remote derivative cache under budget. */
let pruneRunning = false;
async function pruneRemoteCache(): Promise<void> {
  if (pruneRunning) return;
  pruneRunning = true;
  try {
    const names = await fsp.readdir(REMOTE_CACHE_DIR).catch(() => [] as string[]);
    const files: { p: string; size: number; mtimeMs: number }[] = [];
    for (const name of names) {
      const p = path.join(REMOTE_CACHE_DIR, name);
      const st = await fsp.stat(p).catch(() => null);
      if (st?.isFile()) files.push({ p, size: st.size, mtimeMs: st.mtimeMs });
    }
    let total = files.reduce((s, f) => s + f.size, 0);
    if (total <= REMOTE_CACHE_MAX_BYTES) return;
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of files) {
      if (total <= REMOTE_CACHE_MAX_BYTES * 0.8) break;
      await fsp.rm(f.p, { force: true }).catch(() => {});
      total -= f.size;
    }
  } finally {
    pruneRunning = false;
  }
}

let coldFetchesInFlight = 0;

/**
 * Maps a remote catalogue image URL to its resizable proxy path, or null if
 * the URL is not eligible (wrong protocol/host, not parseable). Path-based
 * (no query string) so the mobile app can append `?w=…&fmt=webp` unchanged.
 */
export function remoteImageProxyPath(src: unknown): string | null {
  if (typeof src !== "string" || src.length === 0 || src.length > 2000) return null;
  try {
    const u = new URL(src);
    if (u.protocol !== "https:" || !REMOTE_HOSTS.has(u.hostname)) return null;
    return `/api/uc/product-images/remote/${Buffer.from(src).toString("base64url")}`;
  } catch {
    return null;
  }
}

/** Reverses remoteImageProxyPath's key back to a validated original URL. */
function decodeRemoteKey(key: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,4000}$/.test(key)) return null;
  try {
    const src = Buffer.from(key, "base64url").toString("utf8");
    const u = new URL(src);
    if (u.protocol !== "https:" || !REMOTE_HOSTS.has(u.hostname)) return null;
    return src;
  } catch {
    return null;
  }
}

const router = Router();

/**
 * GET /api/uc/product-images/remote/<base64url(originalUrl)>?w=<px>&fmt=webp
 *
 * Proxy-resizes WooCommerce catalogue images (which live on the store site /
 * WordPress CDN as multi-megapixel originals). Without this, the product
 * gallery downloads and decodes five ~2500px JPEGs at once — the cause of
 * sluggish, stuttering image paging on product pages.
 *
 * Any failure (bad width, fetch error, oversized original, sharp error)
 * falls back to a 302 redirect to the original URL — resizing must never
 * make an image FAIL to load.
 */
router.get("/remote/:key", async (req: Request, res: Response): Promise<void> => {
  const src = decodeRemoteKey(String(req.params["key"] ?? ""));
  if (!src) {
    res.status(404).json({ error: "Unknown image" });
    return;
  }

  const wRaw = parseInt(String(req.query["w"] ?? ""), 10);
  if (isNaN(wRaw) || wRaw <= 0) {
    res.redirect(302, src);
    return;
  }

  try {
    const width = snapWidth(wRaw);
    const webp = String(req.query["fmt"] ?? "") === "webp";
    const ext = webp ? "webp" : "jpeg";
    const hash = createHash("sha256").update(src).digest("base64url").slice(0, 24);
    const cacheFile = `${hash}-w${width}.${ext}`;

    const cachePath = await getOrCreateDerivative(REMOTE_CACHE_DIR, cacheFile, async (tmpPath) => {
      if (coldFetchesInFlight >= REMOTE_MAX_COLD_FETCHES) {
        throw new Error("resize backlog — serving original instead");
      }
      coldFetchesInFlight++;
      try {
        const buf = await fetchRemoteImage(src);
        // limitInputPixels guards against decompression bombs.
        const pipeline = sharp(buf, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize({ width, withoutEnlargement: true });
        await (webp
          ? pipeline.webp({ quality: 80 })
          : pipeline.jpeg({ quality: 80, mozjpeg: true })
        ).toFile(tmpPath);
      } finally {
        coldFetchesInFlight--;
      }
      void pruneRemoteCache();
    });

    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("Content-Type", webp ? "image/webp" : "image/jpeg");
    res.sendFile(cachePath, (err) => {
      if (err && !res.headersSent) res.redirect(302, src);
    });
  } catch (err) {
    req.log?.warn({ err, src }, "remote image resize failed — redirecting to original");
    if (!res.headersSent) res.redirect(302, src);
  }
});

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
