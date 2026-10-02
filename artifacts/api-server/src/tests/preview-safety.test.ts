import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { assertPreviewIsolation } from "../lib/preview-safety.js";
import { assertIsolatedApiTestDatabase } from "./assert-isolated-test-database.js";

describe("isolated preview startup guard", () => {
  it("starts only the HTTP listener, never background workers or settlement timers", () => {
    const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const branch = source.match(/if \(process\.env\["PREVIEW_SAFE_MODE"\] === "1"\) \{([\s\S]*?)\n    \}/)?.[1];
    assert.ok(branch, "preview-safe startup branch must remain explicit");
    const compiled = transformSync(`(function () { ${branch} })()`, { loader: "ts" }).code;
    const signals: string[] = [];
    let listeners = 0;
    const forbid = () => { throw new Error("Preview started background work"); };
    runInNewContext(compiled, {
      port: 8080,
      app: { listen: (_port: number, ready: () => void) => { listeners++; ready(); return {}; } },
      logger: { info: () => {}, error: () => {} },
      process: { on: (signal: string) => signals.push(signal), exit: forbid },
      shutdown: () => {},
      startScheduler: forbid,
      startReviewAnalysisWorker: forbid,
      processPendingReferralSettlements: forbid,
      setInterval: forbid,
      setTimeout: forbid,
    });
    assert.equal(listeners, 1);
    assert.deepEqual(signals, ["SIGTERM", "SIGINT"]);
  });
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