import assert from "node:assert/strict";
import test from "node:test";

import { detectReviewMediaMime, mediaMimeFamily } from "../lib/review-media-signature.js";

const isoBmff = (brand: string): Buffer => {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write(brand, 8, "ascii");
  bytes.writeUInt32BE(0, 12);
  bytes.write(brand, 16, "ascii");
  return bytes;
};

test("detectReviewMediaMime recognizes accepted photo signatures", () => {
  assert.equal(detectReviewMediaMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(
    detectReviewMediaMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
  assert.equal(detectReviewMediaMime(Buffer.from("GIF89a", "ascii")), "image/gif");
  assert.equal(detectReviewMediaMime(Buffer.from("RIFFxxxxWEBP", "ascii")), "image/webp");
  assert.equal(detectReviewMediaMime(isoBmff("heic")), "image/heic");
});

test("detectReviewMediaMime recognizes accepted video signatures", () => {
  assert.equal(detectReviewMediaMime(isoBmff("isom")), "video/mp4");
  assert.equal(detectReviewMediaMime(isoBmff("qt  ")), "video/quicktime");
  assert.equal(detectReviewMediaMime(isoBmff("3gp6")), "video/3gpp");
  assert.equal(
    detectReviewMediaMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])),
    "video/webm",
  );
});

test("detectReviewMediaMime rejects unknown and misleading content", () => {
  assert.equal(detectReviewMediaMime(Buffer.from("<svg><script>alert(1)</script></svg>")), null);
  assert.equal(detectReviewMediaMime(Buffer.from("not really a jpeg")), null);
  assert.equal(detectReviewMediaMime(isoBmff("zzzz")), null);
});

test("mediaMimeFamily separates review photo and video types", () => {
  assert.equal(mediaMimeFamily("image/heic"), "photo");
  assert.equal(mediaMimeFamily("video/quicktime"), "video");
  assert.equal(mediaMimeFamily("application/octet-stream"), null);
});