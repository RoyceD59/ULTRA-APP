/**
 * Pure business-logic core for finalising a Team Library upload.
 *
 * Extracted from the route handler so it can be unit-tested without a real
 * database or GCS bucket.  The route passes in a FinalizerDeps object whose
 * implementations wrap the real Drizzle queries and GCS calls.
 *
 * Security guarantees enforced here
 * ──────────────────────────────────
 * 1. Slot must exist, belong to the requesting member, and not be expired.
 * 2. consumeSlot performs a conditional UPDATE (WHERE consumed=false AND expiresAt>now)
 *    so only one concurrent caller can win — any replayed or racing request is
 *    rejected with 409 even if both callers pass the initial guard checks.
 * 3. MIME validation uses exact type matching after normalization (stripping
 *    parameters, lower-casing).  Prefix matching is NOT used so a type like
 *    "image/pnganything" cannot slip through by sharing a prefix with "image/png".
 * 4. Magic-byte validation reads the first 12 bytes of the actual GCS object so
 *    an attacker who mislabels bytes via a spoofed PUT Content-Type header is
 *    caught.  WebP requires the full RIFF…WEBP signature (bytes 0-3 and 8-11)
 *    to prevent RIFF audio files from being promoted as images.  TIFF accepts
 *    both little-endian (II) and big-endian (MM) byte orders.
 * 5. The validated staging object is atomically copied to a server-controlled
 *    finalised path using an ifSourceGenerationMatch precondition.  If the
 *    staging object is overwritten (via the still-valid presigned URL) between
 *    validation and copy, the precondition fails and finalization aborts (409).
 * 6. objectPath must be within the library/ sub-prefix (defence in depth) for
 *    finalised docs, checked by the route layer via isLibraryPath().
 */

import { randomUUID } from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

export const LIBRARY_PATH_PREFIX = "/objects/library/";

export function isLibraryPath(p: string): boolean {
  return p.startsWith(LIBRARY_PATH_PREFIX);
}

// ─── MIME normalization ────────────────────────────────────────────────────────

export function normalizeMime(raw: string): string {
  return (raw.split(";")[0] ?? "").trim().toLowerCase();
}

// ─── Closed MIME allowlist ─────────────────────────────────────────────────────

export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

// Backwards-compat alias — some tests and the route import this name.
export const ALLOWED_MIME_PREFIXES: readonly string[] = [...ALLOWED_MIME_TYPES];

// ─── Magic-byte validation ─────────────────────────────────────────────────────

type MagicEntry =
  | { kind: "prefix"; bytes: readonly number[] }
  | { kind: "webp" }
  | { kind: "tiff" };

const MAGIC_TABLE: Map<string, MagicEntry> = new Map([
  ["application/pdf",                                                                    { kind: "prefix", bytes: [0x25, 0x50, 0x44, 0x46] }],
  ["application/msword",                                                                 { kind: "prefix", bytes: [0xD0, 0xCF, 0x11, 0xE0] }],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document",           { kind: "prefix", bytes: [0x50, 0x4B, 0x03, 0x04] }],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",                { kind: "prefix", bytes: [0x50, 0x4B, 0x03, 0x04] }],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation",        { kind: "prefix", bytes: [0x50, 0x4B, 0x03, 0x04] }],
  ["application/vnd.ms-excel",                                                          { kind: "prefix", bytes: [0xD0, 0xCF, 0x11, 0xE0] }],
  ["application/vnd.ms-powerpoint",                                                     { kind: "prefix", bytes: [0xD0, 0xCF, 0x11, 0xE0] }],
  ["application/vnd.oasis.opendocument.text",                                           { kind: "prefix", bytes: [0x50, 0x4B, 0x03, 0x04] }],
  ["application/vnd.oasis.opendocument.spreadsheet",                                    { kind: "prefix", bytes: [0x50, 0x4B, 0x03, 0x04] }],
  ["application/vnd.oasis.opendocument.presentation",                                   { kind: "prefix", bytes: [0x50, 0x4B, 0x03, 0x04] }],
  ["image/png",                                                                          { kind: "prefix", bytes: [0x89, 0x50, 0x4E, 0x47] }],
  ["image/jpeg",                                                                         { kind: "prefix", bytes: [0xFF, 0xD8, 0xFF] }],
  ["image/gif",                                                                          { kind: "prefix", bytes: [0x47, 0x49, 0x46, 0x38] }],
  ["image/webp",                                                                         { kind: "webp" }],
  ["image/bmp",                                                                          { kind: "prefix", bytes: [0x42, 0x4D] }],
  ["image/tiff",                                                                         { kind: "tiff" }],
]);

export function validateMagicBytes(contentType: string, header: Buffer): boolean {
  const mime = normalizeMime(contentType);
  if (mime.startsWith("text/")) {
    if (header.length === 0) return false;
    return !header.includes(0);
  }

  const entry = MAGIC_TABLE.get(mime);
  if (!entry) return false;

  switch (entry.kind) {
    case "prefix": {
      const { bytes } = entry;
      if (header.length < bytes.length) return false;
      return bytes.every((b, i) => header[i] === b);
    }
    case "webp":
      if (header.length < 12) return false;
      return (
        header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
        header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50
      );
    case "tiff":
      if (header.length < 4) return false;
      return (
        (header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2A && header[3] === 0x00) ||
        (header[0] === 0x4D && header[1] === 0x4D && header[2] === 0x00 && header[3] === 0x2A)
      );
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SlotRow {
  uploadedBy: string;
  objectPath: string;
  declaredType: string;
  consumed: boolean;
  expiresAt: Date;
}

export interface GcsMeta {
  contentType: string;
  size: number;
  generation: string;
}

export interface NewDoc {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  objectPath: string;
  uploadedBy: string;
}

export interface FinalizerDeps {
  getSlot(uploadId: string): Promise<SlotRow | undefined>;
  consumeSlot(uploadId: string): Promise<boolean>;
  getGcsMeta(objectPath: string): Promise<GcsMeta | null>;
  readFirstBytes(objectPath: string, count: number): Promise<Buffer>;
  copyToFinal(stagingPath: string, generation: string, finalPath: string): Promise<{ ok: boolean }>;
  deleteStagingObject(stagingPath: string): Promise<void>;
  insertDoc(doc: NewDoc): Promise<unknown>;
  purgeExpired(): Promise<void>;
}

export interface FinalizeInput {
  uploadId: string;
  memberEmail: string;
  title: string;
  fileName: string;
}

export type FinalizeError = { kind: "error"; status: number; message: string };
export type FinalizeOk   = { kind: "ok"; doc: unknown };
export type FinalizeResult = FinalizeError | FinalizeOk;

// ─── Core logic ────────────────────────────────────────────────────────────────

export async function finalizeUpload(
  input: FinalizeInput,
  deps: FinalizerDeps,
): Promise<FinalizeResult> {
  const { uploadId, memberEmail, title, fileName } = input;

  const slot = await deps.getSlot(uploadId);
  if (!slot) return { kind: "error", status: 404, message: "Upload slot not found — request a new upload URL" };
  if (slot.uploadedBy !== memberEmail) return { kind: "error", status: 403, message: "Upload slot belongs to a different user" };
  if (slot.consumed) return { kind: "error", status: 409, message: "Upload slot already used — request a new upload URL" };
  if (new Date() > slot.expiresAt) return { kind: "error", status: 410, message: "Upload slot expired — request a new upload URL" };

  const won = await deps.consumeSlot(uploadId);
  if (!won) return { kind: "error", status: 409, message: "Upload slot already used — request a new upload URL" };

  const meta = await deps.getGcsMeta(slot.objectPath);
  if (!meta) return { kind: "error", status: 422, message: "Uploaded file not found in storage — upload may have failed" };
  if (meta.size > MAX_FILE_BYTES) return { kind: "error", status: 422, message: "Uploaded file exceeds maximum allowed size" };

  const actualType   = normalizeMime(meta.contentType);
  const declaredType = normalizeMime(slot.declaredType);

  if (!ALLOWED_MIME_TYPES.has(actualType)) return { kind: "error", status: 422, message: "Uploaded file content type is not allowed" };

  const getMimeCategory = (mime: string): string => {
    if (mime.startsWith("text/"))                          return "text";
    if (mime.startsWith("image/"))                         return "image";
    if (mime === "application/pdf")                        return "pdf";
    if (mime === "application/msword" ||
        mime === "application/vnd.ms-excel" ||
        mime === "application/vnd.ms-powerpoint")          return "ms-legacy";
    if (mime.startsWith("application/vnd.openxmlformats")) return "ooxml";
    if (mime.startsWith("application/vnd.oasis"))          return "odf";
    return "other";
  };
  if (ALLOWED_MIME_TYPES.has(declaredType) &&
      getMimeCategory(declaredType) !== getMimeCategory(actualType)) {
    return { kind: "error", status: 422, message: "Uploaded file content type does not match declared type" };
  }

  const header = await deps.readFirstBytes(slot.objectPath, 12);
  if (!validateMagicBytes(actualType, header)) {
    return { kind: "error", status: 422, message: "Uploaded file content does not match its declared type" };
  }

  // Atomic copy to server-controlled path with generation precondition.
  const docId     = randomUUID();
  const finalPath = `${LIBRARY_PATH_PREFIX}final/${docId}`;
  const { ok: copied } = await deps.copyToFinal(slot.objectPath, meta.generation, finalPath);
  if (!copied) return { kind: "error", status: 409, message: "Upload was modified during processing — please try again" };

  deps.deleteStagingObject(slot.objectPath).catch(() => {});

  const doc: NewDoc = {
    id:         docId,
    title:      title.trim().slice(0, 200),
    fileName:   fileName.slice(0, 255),
    fileSize:   meta.size,
    fileType:   actualType,
    objectPath: finalPath,
    uploadedBy: memberEmail,
  };
  const saved = await deps.insertDoc(doc);
  deps.purgeExpired().catch(() => {});
  return { kind: "ok", doc: saved };
}
