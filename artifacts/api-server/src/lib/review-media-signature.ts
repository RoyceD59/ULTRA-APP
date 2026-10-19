import type { File } from "@google-cloud/storage";

export const IMAGE_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
]);
export const VIDEO_TYPES = new Set([
  "video/mp4", "video/quicktime", "video/webm", "video/3gpp",
]);

const ASCII = (bytes: Buffer, start: number, length: number): string =>
  bytes.subarray(start, start + length).toString("ascii");

const startsWith = (bytes: Buffer, signature: number[]): boolean =>
  bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);

const ISO_IMAGE_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1",
]);
const ISO_QUICKTIME_BRANDS = new Set(["qt  "]);
const ISO_3GPP_BRANDS = new Set([
  "3ge6", "3ge7", "3gg6", "3gp4", "3gp5", "3gp6", "3gp7", "3gr6", "3gs7",
]);
const ISO_MP4_BRANDS = new Set([
  "avc1", "dash", "iso2", "iso3", "iso4", "iso5", "iso6", "isom",
  "M4V ", "mp41", "mp42", "MSNV",
]);

function isoBmffBrands(bytes: Buffer): string[] {
  if (bytes.length < 12 || ASCII(bytes, 4, 4) !== "ftyp") return [];
  const brands = [ASCII(bytes, 8, 4)];
  for (let offset = 16; offset + 4 <= bytes.length; offset += 4) {
    brands.push(ASCII(bytes, offset, 4));
  }
  return brands;
}

/**
 * Detects only the review-media formats accepted by the upload API.
 * Returns null for unknown or ambiguous content so callers fail closed.
 */
export function detectReviewMediaMime(bytes: Buffer): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ASCII(bytes, 0, 6) === "GIF87a" || ASCII(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (bytes.length >= 12 && ASCII(bytes, 0, 4) === "RIFF" && ASCII(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";

  const brands = isoBmffBrands(bytes);
  if (brands.some((brand) => ISO_IMAGE_BRANDS.has(brand))) return "image/heic";
  if (brands.some((brand) => ISO_QUICKTIME_BRANDS.has(brand))) return "video/quicktime";
  if (brands.some((brand) => ISO_3GPP_BRANDS.has(brand))) return "video/3gpp";
  if (brands.some((brand) => ISO_MP4_BRANDS.has(brand))) return "video/mp4";
  return null;
}

export function mediaMimeFamily(contentType: string): "photo" | "video" | null {
  if (IMAGE_TYPES.has(contentType)) return "photo";
  if (VIDEO_TYPES.has(contentType)) return "video";
  return null;
}

/** Stored MIME metadata is uploader-controlled, even after presigning.
 * Read a bounded prefix for every attachment, not only unlabelled objects. */
export async function verifyReviewMediaContent(
  file: Pick<File, "createReadStream">,
  contentType: string,
  family: "photo" | "video",
): Promise<string | null> {
  if (contentType && contentType !== "application/octet-stream" &&
      mediaMimeFamily(contentType) !== family) return null;
  const header = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = file.createReadStream({ start: 0, end: 63 });
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
  const detectedType = detectReviewMediaMime(header);
  return detectedType && mediaMimeFamily(detectedType) === family ? detectedType : null;
}