import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, agentOauthClientsTable, agentOauthTokensTable, agentOauthAuditTable } from "@workspace/db";
import app from "../app.js";
import { hasUnknownScope, parseExpiry, parseScopes } from "../routes/agent-oauth.js";

let server: http.Server;
let baseUrl: string;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

before(() => new Promise<void>((resolve, reject) => {
  server = http.createServer(app);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Server did not bind"));
    baseUrl = `http://127.0.0.1:${address.port}/api`;
    resolve();
  });
}));

after(async () => {
  await db.delete(agentOauthTokensTable);
  await db.delete(agentOauthClientsTable);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("agent resource requests require a bearer token", async () => {
  const response = await fetch(`${baseUrl}/integrations/v1/monitor`);
  assert.equal(response.status, 401);
});

test("agent resource requests enforce scopes", async () => {
  const secret = randomBytes(12).toString("hex");
  const id = `test_scope_${Date.now()}`;
  await db.insert(agentOauthClientsTable).values({ id, name: "scope test", secretHash: hash(secret), scopes: ["companion.users.read"], createdBy: "test" });
  const token = randomBytes(24).toString("base64url");
  await db.insert(agentOauthTokensTable).values({ clientId: id, tokenHash: hash(token), scopes: ["companion.users.read"], expiresAt: new Date(Date.now() + 60_000) });
  const response = await fetch(`${baseUrl}/integrations/v1/monitor`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 403);
  const denied = await db.select().from(agentOauthAuditTable)
    .where(eq(agentOauthAuditTable.clientId, id));
  assert.ok(denied.some((row) => row.outcome === "denied"));
  assert.equal(denied.some((row) => row.action.includes("/monitor") && row.outcome === "success"), false);
});

test("suspended clients cannot use existing tokens", async () => {
  const id = `test_suspended_${Date.now()}`;
  const token = randomBytes(24).toString("base64url");
  await db.insert(agentOauthClientsTable).values({ id, name: "suspended test", secretHash: hash("unused"), scopes: ["companion.monitor.read"], status: "suspended", createdBy: "test" });
  await db.insert(agentOauthTokensTable).values({ clientId: id, tokenHash: hash(token), scopes: ["companion.monitor.read"], expiresAt: new Date(Date.now() + 60_000) });
  const response = await fetch(`${baseUrl}/integrations/v1/monitor`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 401);
});

test("client scope and expiry validation are fail closed", () => {
  assert.deepEqual(parseScopes(["companion.users.read", "not-a-scope"]), ["companion.users.read"]);
  assert.equal(hasUnknownScope(["companion.users.read", "not-a-scope"]), true);
  assert.equal(hasUnknownScope(["companion.users.read"]), false);
  assert.equal(parseExpiry("not-a-date"), "invalid");
  assert.equal(parseExpiry(new Date(Date.now() - 1_000).toISOString()), "invalid");
  assert.ok(parseExpiry(new Date(Date.now() + 60_000).toISOString()) instanceof Date);
});

test("manage scopes are not registerable or issuable in read-only v1", async () => {
  assert.equal(hasUnknownScope(["companion.manage"]), true);
  const id = `test_manage_${Date.now()}`;
  const secret = randomBytes(12).toString("hex");
  await db.insert(agentOauthClientsTable).values({
    id, name: "manage test", secretHash: hash(secret), scopes: ["companion.manage"], createdBy: "test",
  });
  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });
  assert.equal(response.status, 400);
  await db.delete(agentOauthClientsTable).where(eq(agentOauthClientsTable.id, id));
});