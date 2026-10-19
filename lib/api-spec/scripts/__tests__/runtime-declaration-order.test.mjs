import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("runtime diagnostic constraints are initialized before their eager schema", () => {
  const source = readFileSync(new URL("../../../api-zod/src/generated/api.ts", import.meta.url), "utf8");
  const schema = source.indexOf("export const CollectRuntimeDiagnosticBody =");
  assert.ok(schema > 0);
  const body = source.slice(schema).split(/\nexport const /, 1)[0];
  const names = [...new Set([...body.matchAll(/\b(collectRuntimeDiagnosticBody\w+)\b/g)].map(m => m[1]))];
  assert.equal(names.length, 7);
  for (const name of names) {
    const declaration = source.indexOf(`export const ${name} =`);
    assert.ok(declaration >= 0 && declaration < schema, `${name} must be initialized before the schema`);
  }
});