import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("every fulfillment constraint is initialized before the generated schema uses it", () => {
  const source = readFileSync(new URL("../../../api-zod/src/generated/api.ts", import.meta.url), "utf8");
  const schemaIndex = source.indexOf("export const UpdateUcOrderFulfillmentBody =");
  assert.ok(schemaIndex > 0);
  const schemaEnd = source.indexOf("export const UpdateUcOrderFulfillmentResponse", schemaIndex);
  const references = [...source.slice(schemaIndex, schemaEnd).matchAll(/\b(updateUcOrderFulfillmentBody\w+)\b/g)];
  assert.equal(references.length, 6);
  for (const [, name] of references) {
    const declarationIndex = source.indexOf(`export const ${name} =`);
    assert.ok(declarationIndex >= 0 && declarationIndex < schemaIndex, `${name} is declared too late`);
  }
});