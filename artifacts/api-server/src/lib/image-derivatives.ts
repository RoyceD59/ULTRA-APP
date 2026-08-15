import path from "node:path";
import fsp from "node:fs/promises";

/**
 * Shared helpers for the resized-image derivative cache.
 *
 * Derivatives live in os.tmpdir() — a disposable per-instance cache that is
 * simply regenerated after a restart or on a fresh deploy replica. Cheap to
 * rebuild (one sharp call per image+width), so no persistence is needed.
 */

/**
 * Allowed derivative widths (device pixels). Requested widths snap UP to the
 * nearest bucket so slightly different screens share cache entries and the
 * cache stays small.
 */
export const WIDTH_BUCKETS = [128, 256, 384, 512, 768] as const;

export const snapWidth = (w: number): number =>
  WIDTH_BUCKETS.find((b) => b >= w) ?? WIDTH_BUCKETS[WIDTH_BUCKETS.length - 1]!;

/**
 * Coalesces concurrent cold-cache requests for the same derivative: the first
 * request runs `produce`, the rest await the same promise instead of each
 * spinning up their own sharp pipeline.
 */
const inFlight = new Map<string, Promise<string>>();

/**
 * Returns the absolute path of the cached derivative, generating it via
 * `produce(tmpPath)` on a cache miss. `produce` must write the finished bytes
 * to `tmpPath`; the file is then atomically renamed into place so a reader
 * never sees a half-written image. Failed temp files are cleaned up.
 */
export async function getOrCreateDerivative(
  cacheDir: string,
  cacheFile: string,
  produce: (tmpPath: string) => Promise<void>,
): Promise<string> {
  const cachePath = path.join(cacheDir, cacheFile);

  const existing = await fsp.stat(cachePath).catch(() => null);
  if (existing?.isFile()) return cachePath;

  const pending = inFlight.get(cachePath);
  if (pending) return pending;

  const job = (async () => {
    await fsp.mkdir(cacheDir, { recursive: true });
    const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await produce(tmpPath);
      await fsp.rename(tmpPath, cachePath);
    } catch (err) {
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
      throw err;
    }
    return cachePath;
  })();

  inFlight.set(cachePath, job);
  try {
    return await job;
  } finally {
    inFlight.delete(cachePath);
  }
}
