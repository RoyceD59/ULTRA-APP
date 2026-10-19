import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import type { File } from "@google-cloud/storage";
import { createStorageRouter } from "../routes/storage.js";

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>';

function appWithUpload(contentType: string, bytes = svg) {
  const app = express();
  app.use("/api", createStorageRouter({
    async getPrivateUploadURL() { throw new Error("Unexpected upload"); },
    normalizeObjectEntityPath(url) { return url; },
    async getObjectEntityFile() { return {} as File; },
    async downloadObject() {
      return new Response(bytes, { headers: {
        "Content-Type": contentType,
        // Prove object-supplied headers cannot override the route protections.
        "Content-Disposition": "inline",
        "Content-Security-Policy": "script-src 'unsafe-inline'",
      } });
    },
  }));
  return app;
}

describe("public uploaded media serving rejects active MIME types before attachment", () => {
  const unsafeTypes = [
    "image/svg+xml",
    "image/svg+xml; charset=utf-8",
    "IMAGE/SVG+XML",
    "text/html",
    "application/xhtml+xml",
    "application/xml",
    "image/x-unknown",
    "video/x-unknown",
    "application/pdf",
    "application/octet-stream",
  ];
  for (const contentType of unsafeTypes) {
    it(`forces ${contentType} to a sandboxed octet-stream download without authentication`, async () => {
      const result = await request(appWithUpload(contentType))
        .get(`/api/storage/objects/uploads/${randomUUID()}`)
        .expect(200);
      assert.equal(result.headers["content-type"], "application/octet-stream");
      assert.equal(result.headers["content-disposition"], "attachment");
      assert.equal(result.headers["x-content-type-options"], "nosniff");
      assert.equal(result.headers["content-security-policy"],
        "sandbox; default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      assert.equal(Buffer.from(result.body).toString(), svg);
    });
  }
  it("thumbnail fallback cannot expose an SVG inline", async () => {
    const result = await request(appWithUpload("image/svg+xml"))
      .get(`/api/storage/objects/uploads/${randomUUID()}?w=320`)
      .expect(200);
    assert.equal(result.headers["content-type"], "application/octet-stream");
    assert.equal(result.headers["content-disposition"], "attachment");
  });
  for (const contentType of [
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
    "video/mp4", "video/quicktime", "video/webm", "video/3gpp",
  ]) {
    it(`preserves inline ${contentType} media`, async () => {
      const result = await request(appWithUpload(contentType, "media"))
        .get(`/api/storage/objects/uploads/${randomUUID()}`)
        .expect(200);
      assert.equal(result.headers["content-type"], contentType);
      assert.equal(result.headers["content-disposition"], "inline");
      assert.equal(result.headers["x-content-type-options"], "nosniff");
      assert.match(result.headers["content-security-policy"], /^sandbox;/);
    });
  }
});
