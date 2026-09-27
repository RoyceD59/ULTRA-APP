import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import sharp from "sharp";
import productImagesRouter, { remoteImageProxyPath } from "../routes/product-images";

/**
 * Focused tests for the remote catalogue-image resize proxy:
 *  - SSRF guards (host allow-list on the key AND on every redirect hop)
 *  - resource limits (declared/streamed byte caps, non-image rejection)
 *  - the never-break-an-image contract (failures fall back to a 302 to the
 *    original URL rather than an error response)
 *
 * The upstream is a stubbed global fetch — no real network calls.
 */

const b64 = (s: string): string => Buffer.from(s).toString("base64url");

// Unique per-run URLs so the on-disk derivative cache from previous runs or
// the dev server can never satisfy these requests.
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const urlFor = (name: string): string =>
  `https://ucfilters.com/wp-content/uploads/test-${runId}-${name}.jpg`;

let server: Server;
let base: string;
const realFetch = globalThis.fetch;

/** Per-URL stubbed upstream responses. */
const upstream = new Map<string, () => Response>();

before(async () => {
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    const make = upstream.get(url);
    if (!make) throw new Error(`unexpected upstream fetch: ${url}`);
    return make();
  }) as typeof fetch;

  const app = express();
  app.use("/api/uc/product-images", productImagesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** GET without following redirects (undici would otherwise chase our 302s). */
async function get(pathname: string): Promise<{ status: number; location: string | null; type: string | null }> {
  const res = await realFetch(`${base}/api/uc/product-images${pathname}`, { redirect: "manual" });
  const out = {
    status: res.status,
    location: res.headers.get("location"),
    type: res.headers.get("content-type"),
  };
  await res.arrayBuffer().catch(() => {});
  return out;
}

describe("remoteImageProxyPath — URL eligibility", () => {
  it("maps store/CDN https URLs to a proxy path", () => {
    const p = remoteImageProxyPath("https://i0.wp.com/ucfilters.com/a.jpg?fit=800%2C800");
    assert.ok(p?.startsWith("/api/uc/product-images/remote/"));
  });

  it("refuses foreign hosts", () => {
    assert.equal(remoteImageProxyPath("https://evil.example.com/a.jpg"), null);
  });

  it("refuses plain http", () => {
    assert.equal(remoteImageProxyPath("http://ucfilters.com/a.jpg"), null);
  });

  it("refuses non-URLs and non-strings", () => {
    assert.equal(remoteImageProxyPath("not a url"), null);
    assert.equal(remoteImageProxyPath(42 as unknown as string), null);
    assert.equal(remoteImageProxyPath(null), null);
  });
});

describe("remote image proxy route — SSRF guards", () => {
  it("404s a key encoding a foreign host", async () => {
    const r = await get(`/remote/${b64("https://169.254.169.254/latest/meta-data")}?w=512`);
    assert.equal(r.status, 404);
  });

  it("404s a key that is not valid base64url/URL", async () => {
    const r = await get(`/remote/%2e%2e%2fetc%2fpasswd?w=512`);
    assert.equal(r.status, 404);
  });

  it("refuses to follow a redirect to a non-allow-listed host (falls back to original)", async () => {
    const src = urlFor("redirect-foreign");
    upstream.set(src, () =>
      new Response(null, { status: 302, headers: { location: "https://internal.service.local/secret" } }),
    );
    const r = await get(`/remote/${b64(src)}?w=512&fmt=webp`);
    assert.equal(r.status, 302, "must fall back, not proxy the redirect target");
    assert.equal(r.location, src, "fallback must point at the original image");
  });

  it("follows a redirect that stays on an allow-listed host", async () => {
    const src = urlFor("redirect-ok");
    const hop = `https://i0.wp.com/ucfilters.com/uploads/test-${runId}-hop.jpg`;
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .png().toBuffer();
    upstream.set(src, () => new Response(null, { status: 302, headers: { location: hop } }));
    upstream.set(hop, () => new Response(png, { status: 200, headers: { "content-type": "image/png" } }));
    const r = await get(`/remote/${b64(src)}?w=128&fmt=webp`);
    assert.equal(r.status, 200);
    assert.equal(r.type, "image/webp");
  });
});

describe("remote image proxy route — resource limits & fallback", () => {
  it("redirects to the original when no width is requested", async () => {
    const src = urlFor("no-width");
    const r = await get(`/remote/${b64(src)}`);
    assert.equal(r.status, 302);
    assert.equal(r.location, src);
  });

  it("falls back when the upstream declares an oversized content-length", async () => {
    const src = urlFor("oversized-declared");
    upstream.set(src, () =>
      new Response("x", {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": String(50 * 1024 * 1024) },
      }),
    );
    const r = await get(`/remote/${b64(src)}?w=512&fmt=webp`);
    assert.equal(r.status, 302);
    assert.equal(r.location, src);
  });

  it("falls back when the upstream body is not an image", async () => {
    const src = urlFor("not-an-image");
    upstream.set(src, () =>
      new Response("<html>WAF says no</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const r = await get(`/remote/${b64(src)}?w=512&fmt=webp`);
    assert.equal(r.status, 302);
    assert.equal(r.location, src);
  });

  it("falls back when the upstream errors", async () => {
    const src = urlFor("upstream-500");
    upstream.set(src, () => new Response(null, { status: 500 }));
    const r = await get(`/remote/${b64(src)}?w=512&fmt=webp`);
    assert.equal(r.status, 302);
    assert.equal(r.location, src);
  });

  it("serves a resized webp derivative for a healthy upstream image", async () => {
    const src = urlFor("healthy");
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 100, b: 50 } } })
      .png().toBuffer();
    upstream.set(src, () => new Response(png, { status: 200, headers: { "content-type": "image/png" } }));
    const r = await get(`/remote/${b64(src)}?w=128&fmt=webp`);
    assert.equal(r.status, 200);
    assert.equal(r.type, "image/webp");
  });
});
