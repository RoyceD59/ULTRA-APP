import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, agentOauthClientsTable, agentOauthTokensTable, agentOauthAuditTable, ucAlisonConversationsTable, ucAlisonTurnsTable, teamUsersTable } from "@workspace/db";
import app from "../app.js";
import { hasUnknownScope, parseExpiry, parseScopes } from "../routes/agent-oauth.js";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
let baseUrl: string;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const teamIds: string[] = [];

async function teamAuthorization(role: "admin" | "member" = "admin") {
  const id = `oauth-team-${randomBytes(12).toString("hex")}`;
  const email = `${id}@example.test`;
  await db.insert(teamUsersTable).values({ id, email, name: "OAuth test admin", passwordHash: hash("unused"), role, isActive: true });
  teamIds.push(id);
  return {
    id,
    headers: {
      authorization: `Bearer ${issueToken({ id, email, type: "team-session", role, exp: Math.floor(Date.now() / 1000) + 3600 })}`,
      "content-type": "application/json",
    },
  };
}

async function exchange(id: string, secret: string, scope = "alison.read") {
  return fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  });
}

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
  for (const id of teamIds) await db.delete(teamUsersTable).where(eq(teamUsersTable.id, id));
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

test("Alison viewer credentials work through create, rotation, suspension and deletion without losing audit", async () => {
  const admin = await teamAuthorization();
  const created = await fetch(`${baseUrl}/oauth/clients`, {
    method: "POST", headers: admin.headers,
    body: JSON.stringify({ name: "Alison conversation viewer", scopes: ["alison.read"] }),
  });
  assert.equal(created.status, 201);
  const { client, clientSecret } = await created.json() as { client: { id: string }; clientSecret: string };
  assert.match(client.id, /^agent_/);
  assert.ok(clientSecret.length >= 32);
  const [stored] = await db.select().from(agentOauthClientsTable).where(eq(agentOauthClientsTable.id, client.id));
  assert.equal(stored?.secretHash, hash(clientSecret));
  const listed = await fetch(`${baseUrl}/oauth/clients`, { headers: admin.headers });
  const list = await listed.text();
  assert.equal(list.includes(clientSecret), false);
  assert.equal(list.includes("secretHash"), false);

  assert.equal((await exchange(client.id, "wrong-secret")).status, 401);
  const connected = await exchange(client.id, clientSecret);
  assert.equal(connected.status, 200);
  const firstToken = (await connected.json() as { access_token: string }).access_token;
  assert.equal((await fetch(`${baseUrl}/integrations/v1/alison/chats`, { headers: { authorization: `Bearer ${firstToken}` } })).status, 200);
  assert.equal((await fetch(`${baseUrl}/oauth/clients/${client.id}`, { method: "DELETE", headers: admin.headers })).status, 409);

  const rotated = await fetch(`${baseUrl}/oauth/clients/${client.id}/rotate`, { method: "POST", headers: admin.headers, body: "{}" });
  assert.equal(rotated.status, 200);
  const replacement = (await rotated.json() as { clientSecret: string }).clientSecret;
  assert.notEqual(replacement, clientSecret);
  assert.equal((await exchange(client.id, clientSecret)).status, 401);
  assert.equal((await fetch(`${baseUrl}/integrations/v1/alison/chats`, { headers: { authorization: `Bearer ${firstToken}` } })).status, 401);
  const reconnected = await exchange(client.id, replacement);
  assert.equal(reconnected.status, 200);
  const token = (await reconnected.json() as { access_token: string }).access_token;

  assert.equal((await fetch(`${baseUrl}/oauth/clients/${client.id}/suspend`, { method: "POST", headers: admin.headers, body: "{}" })).status, 200);
  assert.equal((await exchange(client.id, replacement)).status, 401);
  const deleted = await fetch(`${baseUrl}/oauth/clients/${client.id}`, { method: "DELETE", headers: admin.headers });
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), "");
  assert.equal((await db.select().from(agentOauthClientsTable).where(eq(agentOauthClientsTable.id, client.id))).length, 0);
  assert.equal((await db.select().from(agentOauthTokensTable).where(eq(agentOauthTokensTable.clientId, client.id))).length, 0);
  const audits = await db.select().from(agentOauthAuditTable).where(eq(agentOauthAuditTable.clientId, client.id));
  assert.ok(audits.some((row) => row.action === "client.create" && row.outcome === "success"));
  assert.ok(audits.some((row) => row.action === "client.delete" && row.outcome === "success" && row.actorId === admin.id));
  assert.equal((await exchange(client.id, replacement)).status, 401);
  assert.equal((await fetch(`${baseUrl}/integrations/v1/alison/chats`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/oauth/clients/${client.id}`, { method: "DELETE", headers: admin.headers })).status, 404);
});

test("Alison token exchange distinguishes missing scope from invalid, expired and suspended clients", async () => {
  for (const scenario of ["scope", "expired", "suspended"] as const) {
    const id = `test_exchange_${scenario}_${randomBytes(8).toString("hex")}`;
    const secret = randomBytes(24).toString("base64url");
    await db.insert(agentOauthClientsTable).values({
      id, name: "Exchange guard fixture", secretHash: hash(secret), createdBy: "test",
      scopes: scenario === "scope" ? ["companion.monitor.read"] : ["alison.read"],
      status: scenario === "suspended" ? "suspended" : "active",
      expiresAt: scenario === "expired" ? new Date(Date.now() - 60_000) : null,
    });
    const response = await exchange(id, secret);
    assert.equal(response.status, scenario === "scope" ? 400 : 401);
    assert.deepEqual(await response.json(), { error: scenario === "scope" ? "invalid_scope" : "invalid_client" });
  }
});

test("client deletion independently rejects active clients and inactive clients with live tokens", async () => {
  const admin = await teamAuthorization();
  for (const status of ["active", "suspended", "revoked"] as const) {
    const id = `test_delete_${status}_${randomBytes(8).toString("hex")}`;
    await db.insert(agentOauthClientsTable).values({ id, name: "Delete guard fixture", secretHash: hash("unused"), scopes: ["alison.read"], status, createdBy: "test" });
    await db.insert(agentOauthTokensTable).values({ clientId: id, tokenHash: hash(randomBytes(24).toString("hex")), scopes: ["alison.read"], expiresAt: new Date(Date.now() + 60_000) });
    const response = await fetch(`${baseUrl}/oauth/clients/${id}`, { method: "DELETE", headers: admin.headers });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: status === "active" ? "client_must_be_inactive" : "client_in_use" });
    assert.equal((await db.select().from(agentOauthClientsTable).where(eq(agentOauthClientsTable.id, id))).length, 1);
    assert.equal((await db.select().from(agentOauthTokensTable).where(eq(agentOauthTokensTable.clientId, id))).length, 1);
  }
});

test("expired and revoked tokens do not prevent deletion of an inactive client", async () => {
  const admin = await teamAuthorization();
  const id = `test_delete_old_${randomBytes(8).toString("hex")}`;
  await db.insert(agentOauthClientsTable).values({ id, name: "Inactive fixture", secretHash: hash("unused"), scopes: ["alison.read"], status: "revoked", createdBy: "test" });
  await db.insert(agentOauthTokensTable).values([
    { clientId: id, tokenHash: hash(randomBytes(24).toString("hex")), scopes: ["alison.read"], expiresAt: new Date(Date.now() - 60_000) },
    { clientId: id, tokenHash: hash(randomBytes(24).toString("hex")), scopes: ["alison.read"], expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() },
  ]);
  assert.equal((await fetch(`${baseUrl}/oauth/clients/${id}`, { method: "DELETE", headers: admin.headers })).status, 204);
});

test("client deletion requires a live active administrator, not a machine token or stale admin claim", async () => {
  const admin = await teamAuthorization();
  const member = await teamAuthorization("member");
  const id = `test_delete_admin_${randomBytes(8).toString("hex")}`;
  const machineToken = randomBytes(24).toString("base64url");
  await db.insert(agentOauthClientsTable).values({ id, name: "Admin guard fixture", secretHash: hash("unused"), scopes: ["alison.read"], createdBy: "test" });
  await db.insert(agentOauthTokensTable).values({ clientId: id, tokenHash: hash(machineToken), scopes: ["alison.read"], expiresAt: new Date(Date.now() + 60_000) });
  assert.equal((await fetch(`${baseUrl}/oauth/clients/${id}`, { method: "DELETE" })).status, 401);
  assert.equal((await fetch(`${baseUrl}/oauth/clients/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${machineToken}` } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/oauth/clients/${id}`, { method: "DELETE", headers: member.headers })).status, 403);
  await db.update(teamUsersTable).set({ role: "member" }).where(eq(teamUsersTable.id, admin.id));
  assert.equal((await fetch(`${baseUrl}/oauth/clients/${id}`, { method: "DELETE", headers: admin.headers })).status, 403);
  await db.update(teamUsersTable).set({ role: "admin", isActive: false }).where(eq(teamUsersTable.id, admin.id));
  assert.equal((await fetch(`${baseUrl}/oauth/clients/${id}`, { method: "DELETE", headers: admin.headers })).status, 403);
  assert.equal((await db.select().from(agentOauthClientsTable).where(eq(agentOauthClientsTable.id, id))).length, 1);
});