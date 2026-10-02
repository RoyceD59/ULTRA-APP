import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPreviewIsolation } from "../lib/preview-safety.js";
import { assertIsolatedApiTestDatabase } from "./assert-isolated-test-database.js";

describe("isolated preview startup guard", () => {
  it("does not constrain normal API startup", () => {
    assert.doesNotThrow(() => assertPreviewIsolation({ NODE_ENV: "test" }));
  });
  it("requires a disposable local database and no live credentials", () => {
    const base = {
      PREVIEW_SAFE_MODE: "1",
      DATABASE_URL: "postgres://preview:preview@db:5432/ultra_preview",
    };
    assert.doesNotThrow(() => assertPreviewIsolation(base));
    assert.throws(() => assertPreviewIsolation({ ...base, DATABASE_URL: "postgres://user:pass@live-db/live" }));
    assert.throws(() => assertPreviewIsolation({ ...base, RESEND_API_KEY: "live" }));
    assert.throws(() => assertPreviewIsolation({ ...base, WC_BASE_URL: "https://ucfilters.com" }));
  });
  it("refuses integration-test databases outside the per-run API harness", () => {
    assert.doesNotThrow(() => assertIsolatedApiTestDatabase({
      DATABASE_URL: "postgres://test:test@localhost/test_api_123456789_1234",
      NODE_ENV: "test",
    }));
    assert.throws(() => assertIsolatedApiTestDatabase({
      DATABASE_URL: "postgres://test:test@localhost/refill_governance_test",
      NODE_ENV: "test",
    }), /isolated test harness/);
    assert.throws(() => assertIsolatedApiTestDatabase({
      DATABASE_URL: "postgres://test:test@localhost/test_api_123456789_1234",
      NODE_ENV: "production",
    }), /NODE_ENV=test/);
  });
});