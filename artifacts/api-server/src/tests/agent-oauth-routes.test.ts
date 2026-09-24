import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, agentOauthClientsTable, agentOauthTokensTable, agentOauthAuditTable, ucAlisonConversationsTable, ucAlisonTurnsTable } from "@workspace/db";
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
  await db.delete(ucAlisonConversationsTable);
  await db.delete(agentOauthTokensTable);
  await db.delete(agentOauthClientsTable);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("alison chats are anonymous, ordered, cursor-paginated, and scope-audited", async () => {
  const id = `test_alison_${Date.now()}`;
  const token = randomBytes(24).toString("base64url");
  await db.insert(agentOauthClientsTable).values({
    id, name: "alison reader", secretHash: hash("unused"), scopes: ["alison.read"], createdBy: "test",
  });
  await db.insert(agentOauthTokensTable).values({
    clientId: id, tokenHash: hash(token), scopes: ["alison.read"], expiresAt: new Date(Date.now() + 60_000),
  });
  // This endpoint lists all recent conversations. Keep these fixtures ahead of
  // concurrently written chat-test rows so the first two pages are stable.
  const createdAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const ids = ["anonymous-chat-bbbbb", "anonymous-chat-aaaaa"];
  await db.insert(ucAlisonConversationsTable).values(ids.map((conversationId) => ({
    id: conversationId, createdAt, updatedAt: createdAt,
  })));
  await db.insert(ucAlisonTurnsTable).values([
    { conversationId: ids[0]!, turnId: "turn-00000000000001", userMessage: "First question", assistantMessage: "First answer", createdAt },
    { conversationId: ids[0]!, turnId: "turn-00000000000002", userMessage: "Retry question", assistantMessage: "Different answer", createdAt: new Date(createdAt.getTime() + 1) },
  ]);
  await db.insert(ucAlisonConversationsTable).values({
    id: "anonymous-expired-hidden",
    createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
  });

  const first = await fetch(`${baseUrl}/integrations/v1/alison/chats?limit=1`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(first.status, 200);
  const pageOne = await first.json() as { chats: Array<Record<string, unknown>>; nextCursor: string };
  assert.equal(pageOne.chats.length, 1);
  assert.equal(pageOne.chats[0]?.["conversationId"], ids[0]);
  assert.ok(pageOne.nextCursor);
  const serialized = JSON.stringify(pageOne);
  assert.equal(serialized.includes("anonymous-expired-hidden"), false);
  for (const forbidden of ["userId", "email", "name", "device", "filterContext"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  const messages = pageOne.chats[0]?.["messages"] as Array<{ role: string; content: string }>;
  assert.deepEqual(messages.map(({ role, content }) => [role, content]), [
    ["user", "First question"], ["assistant", "First answer"],
    ["user", "Retry question"], ["assistant", "Different answer"],
  ]);

  const second = await fetch(`${baseUrl}/integrations/v1/alison/chats?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(second.status, 200);
  const pageTwo = await second.json() as { chats: Array<{ conversationId: string }>; nextCursor: null };
  assert.equal(pageTwo.chats[0]?.conversationId, ids[1]);
  // Other tests may have added older conversations to the shared test DB.
  const audits = await db.select().from(agentOauthAuditTable).where(eq(agentOauthAuditTable.clientId, id));
  assert.ok(audits.some((row) => row.action.includes("/alison/chats") && row.outcome === "success"));
});

test("alison chats reject machine tokens without alison.read and audit the denial", async () => {
  const id = `test_alison_denied_${Date.now()}`;
  const token = randomBytes(24).toString("base64url");
  await db.insert(agentOauthClientsTable).values({
    id, name: "non-alison reader", secretHash: hash("unused"), scopes: ["companion.monitor.read"], createdBy: "test",
  });
  await db.insert(agentOauthTokensTable).values({
    clientId: id, tokenHash: hash(token), scopes: ["companion.monitor.read"], expiresAt: new Date(Date.now() + 60_000),
  });
  const response = await fetch(`${baseUrl}/integrations/v1/alison/chats`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "insufficient_scope", required_scope: "alison.read" });
  const audits = await db.select().from(agentOauthAuditTable).where(eq(agentOauthAuditTable.clientId, id));
  assert.ok(audits.some((row) => row.action.includes("/alison/chats") && row.outcome === "denied"));
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