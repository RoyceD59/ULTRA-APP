import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Source modules live under src/lib; the production bundle lives under dist.
 * Neither layout depends on the directory from which the API was started.
 */
export function resolveProductImageDirectory(moduleUrl: string): string {
  const candidates = [
    new URL("../public/products/", moduleUrl),
    new URL("../../public/products/", moduleUrl),
  ].map(url => fileURLToPath(url));
  const directory = candidates.find(existsSync);
  if (!directory) throw new Error("Required catalogue image directory is missing from the API package");
  return directory;
}

export const productImageDirectory = resolveProductImageDirectory(import.meta.url);
