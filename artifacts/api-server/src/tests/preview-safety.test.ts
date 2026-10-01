import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPreviewIsolation } from "../lib/preview-safety.js";
import { buildCorsOrigins } from "../lib/cors-origins.js";

const safe = { PREVIEW_SAFE_MODE: "1", DATABASE_URL: "postgres://preview:preview@db:5432/ultra_preview" };
describe("preview isolation", () => {
  it("accepts only the disposable database without live-capable credentials", () => {
    assert.doesNotThrow(() => assertPreviewIsolation(safe));
    assert.throws(() => assertPreviewIsolation({ ...safe, DATABASE_URL: "postgres://preview:preview@db/live" }), /disposable/);
    assert.throws(() => assertPreviewIsolation({ ...safe, DATABASE_URL: "postgres://preview:preview@api.ucfilters.com/ultra_preview" }), /disposable/);
    assert.throws(() => assertPreviewIsolation({ ...safe, MPESA_PASSKEY: "x" }), /MPESA_PASSKEY/);
    assert.throws(() => assertPreviewIsolation({ ...safe, AI_ORCHESTRATOR_WEBHOOK_URL: "https://team-horizon--jerryaroyce.replit.app" }), /AI_ORCHESTRATOR/);
  });
  it("admits only exact local preview origins", () => {
    const origins = buildCorsOrigins({ ...safe, NODE_ENV: "production", PREVIEW_ALLOWED_ORIGINS: "http://localhost:3000,http://localhost:5055" });
    assert.deepEqual(origins, ["http://localhost:3000", "http://localhost:5055"]);
    assert.throws(() => buildCorsOrigins({ ...safe, PREVIEW_ALLOWED_ORIGINS: "https://app.ucfilters.com" }), /live origin/);
    assert.throws(() => buildCorsOrigins({ ...safe, PREVIEW_ALLOWED_ORIGINS: "*" }), /invalid preview origin/);
  });
});
