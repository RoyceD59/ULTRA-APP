import { createHash } from "node:crypto";
import { normalizeMime } from "./libraryFinalizer.js";

export const MAX_REFERENCE_BYTES = 32 * 1024;
export class ReferenceExtractionError extends Error {}

/** Extract text only. Never render HTML, follow links, execute Markdown, or load attachments. */
export function extractLibraryReference(bytes: Buffer, mime: string): { text: string; hash: string } {
  if (!["text/plain", "text/markdown", "text/x-markdown"].includes(normalizeMime(mime))) {
    throw new ReferenceExtractionError("Only UTF-8 plain text and Markdown can be approved for Alison.");
  }
  if (bytes.length > MAX_REFERENCE_BYTES) {
    throw new ReferenceExtractionError("Alison references must be at most 32 KB.");
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ReferenceExtractionError("The document must contain valid UTF-8 text."); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw new ReferenceExtractionError("Binary files and control characters are not supported.");
  }
  text = text.replace(/\r\n?/g, "\n")
    .replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "") // metadata is not customer reference text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>\n]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)\n]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)\n]*\)/g, "$1")
    .replace(/^\s*\[[^\]]+\]:.*$/gm, "")
    .replace(/(?:https?:\/\/|gs:\/\/|www\.)[^\s<>]+/gi, "")
    .replace(/\/(?:api\/storage\/|storage\/|objects\/)[^\s<>]+/gi, "")
    .trim();
  if (!text || text.length > 16_000) {
    throw new ReferenceExtractionError("Extracted reference text must contain 1–16,000 characters; split longer documents.");
  }
  return { text, hash: createHash("sha256").update(bytes).digest("hex") };
}

/** Bounds the stream itself, not only caller-supplied metadata. */
export async function readReferenceStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_REFERENCE_BYTES) {
        throw new ReferenceExtractionError("Alison references must be at most 32 KB.");
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally {
    (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
  }
}