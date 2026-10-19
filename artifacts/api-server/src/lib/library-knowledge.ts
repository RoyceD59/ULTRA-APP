import { createHash } from "node:crypto";
import { normalizeMime } from "./libraryFinalizer.js";
import { extractPdfText } from "./library-pdf.js";
import { MAX_REFERENCE_BYTES, MAX_REFERENCE_CHARACTERS, REFERENCE_TIMEOUT_MS, referenceByteLimit, ReferenceExtractionError } from "./library-reference-limits.js";

export { MAX_REFERENCE_BYTES, referenceByteLimit, ReferenceExtractionError } from "./library-reference-limits.js";

/** Extract text only. Never render HTML, follow links, execute Markdown, or load attachments. */
export async function extractLibraryReference(bytes: Buffer, mime: string): Promise<{ text: string; hash: string }> {
  mime = normalizeMime(mime);
  if (bytes.length > referenceByteLimit(mime)) {
    throw new ReferenceExtractionError(mime === "application/pdf" ? "PDF manuals must be at most 5 MB." : "Alison text references must be at most 32 KB.");
  }
  let text: string;
  try { text = mime === "application/pdf" ? await extractPdfText(bytes) : new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (error) {
    if (error instanceof ReferenceExtractionError) throw error;
    throw new ReferenceExtractionError("The document must contain valid UTF-8 text.");
  }
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
  if (!text || text.length > MAX_REFERENCE_CHARACTERS) {
    throw new ReferenceExtractionError("Extracted reference text must contain 1–16,000 characters; split longer documents.");
  }
  // Bind approval to both the original bytes and the exact derived preview.
  return { text, hash: createHash("sha256").update(bytes).update("\0").update(text).digest("hex") };
}

/** Bounds the stream itself, not only caller-supplied metadata. */
export async function readReferenceStream(stream: NodeJS.ReadableStream, maxBytes = MAX_REFERENCE_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    (stream as NodeJS.ReadableStream & { destroy?: (error: Error) => void }).destroy?.(new ReferenceExtractionError("Document read timed out. Try again."));
  }, REFERENCE_TIMEOUT_MS);
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        throw new ReferenceExtractionError("Document exceeds the review byte limit.");
      }
      chunks.push(bytes);
    }
    if (timedOut) throw new ReferenceExtractionError("Document read timed out. Try again.");
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
  }
}