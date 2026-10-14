import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import os from "node:os";
import express from "express";
import supertest from "supertest";
import { productImageDirectory, resolveProductImageDirectory } from "../lib/product-image-directory.js";
import productImagesRouter from "../routes/product-images.js";

test("catalogue originals and derivatives work when launched outside the API directory", async () => {
  const before = process.cwd();
  process.chdir(os.tmpdir());
  try {
    assert.equal(resolveProductImageDirectory(new URL("../lib/product-image-directory.ts", import.meta.url).href), productImageDirectory);
    // Simulate the bundled dist entry as well as the source module layout.
    assert.equal(resolveProductImageDirectory(new URL("../../dist/index.mjs", import.meta.url).href), productImageDirectory);
    assert.ok(existsSync(`${productImageDirectory}/hydra-flux-premium-filter-bottle.jpg`));
    assert.throws(() => resolveProductImageDirectory("file:///missing-api-package/dist/index.mjs"), /directory is missing/);
    const app = express();
    app.use("/images", productImagesRouter, express.static(productImageDirectory, { fallthrough: false }));
    app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error.status ?? 500).json({ error: "Image unavailable" });
    });
    for (const [path, contentType] of [
      ["/images/hydra-flux-premium-filter-bottle.jpg", /image\/jpeg/],
      ["/images/viva-drop-compact-filter-bottle.jpg?w=128&fmt=webp", /image\/webp/],
    ] as const) {
      const response = await supertest(app).get(path).set("User-Agent", "Expo CFNetwork iOS");
      assert.equal(response.status, 200);
      assert.match(response.headers["content-type"], contentType);
      assert.ok(response.body.length > 100);
    }
    assert.equal((await supertest(app).get("/images/unknown-image.jpg")).status, 404);
  } finally {
    process.chdir(before);
  }
});
