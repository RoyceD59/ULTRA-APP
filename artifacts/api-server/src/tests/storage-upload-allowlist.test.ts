import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { createStorageRouter } from "../routes/storage.js";

describe("POST /api/uc/uploads/request-url MIME allowlist", () => {
  const objectPaths: string[] = [];
  const getPrivateUploadURL = mock.fn(async (namespace?: string) => {
    assert.equal(namespace, "uploads");
    const objectPath = `/objects/uploads/${randomUUID()}`;
    objectPaths.push(objectPath);
    return `https://storage.example.test${objectPath}?signature=test-only`;
  });
  const normalizeObjectEntityPath = mock.fn((url: string) => new URL(url).pathname);
  const app = express();
  app.use(express.json());
  app.use("/api", createStorageRouter({
    getPrivateUploadURL,
    normalizeObjectEntityPath,
    async getObjectEntityFile() { throw new Error("Unexpected storage read"); },
    async downloadObject() { throw new Error("Unexpected storage download"); },
  }));
  const endpoint = "/api/uc/uploads/request-url";
  let authorization: string;

  before(() => {
    authorization = `Bearer ${issueToken({ id: 1920000001, email: "upload-allowlist@example.test" })}`;
  });

  after(async () => {
    await pool.query("DELETE FROM instant_water_media_uploads WHERE object_path = ANY($1::text[])", [objectPaths]);
  });

  const allowedTypes = [
    ["image/jpeg", "jpg", "photo"],
    ["image/png", "png", "photo"],
    ["image/webp", "webp", "photo"],
    ["image/gif", "gif", "photo"],
    ["video/mp4", "mp4", "video"],
    ["video/quicktime", "mov", "video"],
    ["application/pdf", "pdf", "document"],
    ["image/heic", "heic", "photo"],
  ] as const;

  for (const [contentType, extension, kind] of allowedTypes) {
    it(`accepts ${contentType} and returns an uploadURL`, async () => {
      const callsBefore = getPrivateUploadURL.mock.callCount();
      const response = await request(app).post(endpoint)
        .set("Authorization", authorization)
        .send({ name: `safe.${extension}`, size: 1024, contentType })
        .expect(200);

      assert.equal(getPrivateUploadURL.mock.callCount(), callsBefore + 1);
      assert.equal(response.body.uploadURL, await getPrivateUploadURL.mock.calls[callsBefore].result);
      assert.match(response.body.uploadURL, /^https:\/\/storage\.example\.test\/objects\/uploads\//);
      assert.equal(response.body.objectPath, new URL(response.body.uploadURL).pathname);
      assert.equal(response.body.kind, kind);
    });
  }

  const blockedTypes = [
    ["application/octet-stream", "exe"],
    ["image/svg+xml", "svg"],
    ["text/html", "html"],
  ] as const;

  for (const [contentType, extension] of blockedTypes) {
    it(`rejects ${contentType} before minting a storage URL`, async () => {
      const callsBefore = getPrivateUploadURL.mock.callCount();
      const normalizeCallsBefore = normalizeObjectEntityPath.mock.callCount();
      const response = await request(app).post(endpoint)
        .set("Authorization", authorization)
        .send({ name: `unsafe.${extension}`, size: 1024, contentType })
        .expect(400);

      assert.equal(typeof response.body.error, "string");
      assert.ok(response.body.error.includes(`File type not allowed: ${contentType}`));
      assert.ok(response.body.error.includes("Accepted types"));
      assert.equal(response.body.uploadURL, undefined);
      assert.equal(getPrivateUploadURL.mock.callCount(), callsBefore);
      assert.equal(normalizeObjectEntityPath.mock.callCount(), normalizeCallsBefore);
    });
  }

  it("rejects an unauthenticated request before calling storage", async () => {
    const callsBefore = getPrivateUploadURL.mock.callCount();
    const normalizeCallsBefore = normalizeObjectEntityPath.mock.callCount();
    const response = await request(app).post(endpoint)
      .send({ name: "safe.jpg", size: 1024, contentType: "image/jpeg" })
      .expect(401);

    assert.equal(response.body.error, "Authentication required");
    assert.equal(response.body.uploadURL, undefined);
    assert.equal(getPrivateUploadURL.mock.callCount(), callsBefore);
    assert.equal(normalizeObjectEntityPath.mock.callCount(), normalizeCallsBefore);
  });
});