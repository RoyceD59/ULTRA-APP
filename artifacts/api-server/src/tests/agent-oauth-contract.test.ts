import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_SCOPES } from "../routes/agent-oauth.js";

test("private agent scope contract is explicit and bounded", () => {
  assert.deepEqual([...AGENT_SCOPES], [
    "companion.monitor.read",
    "companion.users.read",
    "interactions.read",
    "alison.read",
    "blog.submit",
  ]);
  assert.equal(new Set(AGENT_SCOPES).size, AGENT_SCOPES.length);
  assert.equal(AGENT_SCOPES.some((scope) => scope.includes("sql") || scope.includes("http")), false);
});