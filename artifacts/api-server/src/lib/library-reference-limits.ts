export const MAX_REFERENCE_BYTES = 32 * 1024;
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_PAGES = 40;
export const MAX_REFERENCE_CHARACTERS = 16_000;
export const REFERENCE_TIMEOUT_MS = 5_000;
export class ReferenceExtractionError extends Error {}

export function referenceByteLimit(mime: string): number {
  if (mime === "application/pdf") return MAX_PDF_BYTES;
  if (["text/plain", "text/markdown", "text/x-markdown"].includes(mime)) return MAX_REFERENCE_BYTES;
  throw new ReferenceExtractionError("Only text-based PDF, UTF-8 plain text and Markdown are supported. Word and other formats must be converted to reviewed text.");
}