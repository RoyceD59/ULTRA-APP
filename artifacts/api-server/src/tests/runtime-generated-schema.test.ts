import { it } from "node:test";
import assert from "node:assert/strict";

it("imports the shared generated runtime validator without a temporal-dead-zone failure", async () => {
  // An actual import catches failures that declaration/type-only checks can miss.
  const { CollectRuntimeDiagnosticBody } = await import("@workspace/api-zod");
  const payload = {
    schema: 1, app: "companion", environment: "development", platform: "web",
    browser: "chrome", release: "development", routeClass: "home", category: "render",
    frames: [{ asset: "bundle", line: 10, column: 20 }],
  };
  assert.equal(CollectRuntimeDiagnosticBody.safeParse(payload).success, true);
  assert.equal(CollectRuntimeDiagnosticBody.safeParse({ ...payload, frames: [{ asset: "bundle", line: 10_000_001, column: 0 }] }).success, false);
});