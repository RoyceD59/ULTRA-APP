import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import type { File } from "@google-cloud/storage";

import { detectReviewMediaMime, mediaMimeFamily, verifyReviewMediaContent } from "../lib/review-media-signature.js";

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
  assert.equal(mediaMimeFamily("image/svg+xml"), null);
  assert.equal(mediaMimeFamily("image/x-unknown"), null);
  assert.equal(mediaMimeFamily("video/x-unknown"), null);
});

function storedFile(bytes: Buffer): Pick<File, "createReadStream"> {
  return {
    createReadStream(options) {
      assert.deepEqual(options, { start: 0, end: 63 });
      return Readable.from([bytes.subarray(0, 64)]);
    },
  };
}

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>');

test("attachment verification rejects SVG even with allowlisted stored metadata", async () => {
  for (const contentType of ["image/svg+xml", "image/jpeg", "image/png", "", "application/octet-stream"]) {
    assert.equal(await verifyReviewMediaContent(storedFile(svg), contentType, "photo"), null, contentType);
  }
});

test("attachment verification checks labelled media bytes and preserves legitimate formats", async () => {
  const cases = [
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "photo"],
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "photo"],
    ["image/gif", Buffer.from("GIF89a"), "photo"],
    ["image/webp", Buffer.from("RIFFxxxxWEBP"), "photo"],
    ["image/heic", isoBmff("heic"), "photo"],
    ["video/mp4", isoBmff("isom"), "video"],
    ["video/quicktime", isoBmff("qt  "), "video"],
    ["video/3gpp", isoBmff("3gp6"), "video"],
    ["video/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), "video"],
  ] as const;
  for (const [contentType, bytes, family] of cases) {
    assert.equal(await verifyReviewMediaContent(storedFile(bytes), contentType, family), contentType);
    assert.equal(await verifyReviewMediaContent(storedFile(bytes), "application/octet-stream", family), contentType);
  }
  assert.equal(await verifyReviewMediaContent(storedFile(isoBmff("isom")), "image/jpeg", "photo"), null);
  assert.equal(await verifyReviewMediaContent(storedFile(Buffer.from("<html><script>alert(1)</script>")), "video/mp4", "video"), null);
});

test("attachment verification propagates storage read failures for the caller to reject", async () => {
  const file: Pick<File, "createReadStream"> = {
    createReadStream() {
      return new Readable({ read() { this.destroy(new Error("storage read failed")); } });
    },
  };
  await assert.rejects(verifyReviewMediaContent(file, "image/jpeg", "photo"), /storage read failed/);
});