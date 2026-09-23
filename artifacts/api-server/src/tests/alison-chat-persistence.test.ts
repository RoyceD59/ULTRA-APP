import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db, ucAlisonConversationsTable, ucAlisonTurnsTable } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { _aiClient } from "../routes/uc-water-chat.js";
import { pruneAlisonChats } from "../lib/scheduler.js";
import app from "../app.js";

let server: http.Server;
let baseUrl: string;
const originalCreate = _aiClient.create;
const conversationId = "anonymous-conversation-806";

before(() => new Promise<void>((resolve, reject) => {
  process.env["SESSION_SECRET"] = "alison-persistence-test-secret";
  _aiClient.create = async () => ({ content: [{ type: "text", text: "Stored answer" }] });
  server = http.createServer(app);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Server did not bind"));
    baseUrl = `http://127.0.0.1:${address.port}/api`;
    resolve();
  });
}));

after(async () => {
  _aiClient.create = originalCreate;
  await db.delete(ucAlisonConversationsTable).where(eq(ucAlisonConversationsTable.id, conversationId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function send(turnId: string, isRetry = false) {
  return fetch(`${baseUrl}/uc/ai/water-chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${issueToken({ id: 806, email: "must-not-be-stored@example.test" })}`,
    },
    body: JSON.stringify({
      conversationId, turnId, isRetry,
      filterContext: { productName: "must not be stored" },
      messages: [{ role: "user", content: "How clean is this water?" }],
    }),
  });
}

test("successful Alison turns are anonymous and transport-idempotent while answer retries remain distinct", async () => {
  const turnId = "transport-turn-000001";
  assert.equal((await send(turnId)).status, 200);
  assert.equal((await send(turnId)).status, 200);
  assert.equal((await send("intentional-retry-001", true)).status, 200);

  const turns = await db.select().from(ucAlisonTurnsTable)
    .where(eq(ucAlisonTurnsTable.conversationId, conversationId));
  assert.equal(turns.length, 2);
  assert.equal(turns.filter((turn) => turn.turnId === turnId).length, 1);
  const serialized = JSON.stringify(turns);
  assert.equal(serialized.includes("must-not-be-stored@example.test"), false);
  assert.equal(serialized.includes("productName"), false);
  assert.ok(turns.every((turn) => turn.userMessage === "How clean is this water?"));
  assert.ok(turns.every((turn) => turn.assistantMessage === "Stored answer"));
});

test("30-day pruning deletes expired conversations and cascades only their transcript turns", async () => {
  const oldId = "anonymous-expired-chat-806";
  const freshId = "anonymous-fresh-chat-806";
  const now = new Date("2026-09-23T12:00:00.000Z");
  await db.insert(ucAlisonConversationsTable).values([
    { id: oldId, createdAt: new Date("2026-08-23T11:59:59.000Z") },
    { id: freshId, createdAt: new Date("2026-09-22T12:00:00.000Z") },
  ]);
  await db.insert(ucAlisonTurnsTable).values([
    { conversationId: oldId, turnId: "expired-turn-00001", userMessage: "old", assistantMessage: "old" },
    { conversationId: freshId, turnId: "fresh-turn-0000001", userMessage: "fresh", assistantMessage: "fresh" },
  ]);
  assert.ok(await pruneAlisonChats(now) >= 1);
  assert.equal((await db.select().from(ucAlisonTurnsTable).where(eq(ucAlisonTurnsTable.conversationId, oldId))).length, 0);
  assert.equal((await db.select().from(ucAlisonTurnsTable).where(eq(ucAlisonTurnsTable.conversationId, freshId))).length, 1);
  await db.delete(ucAlisonConversationsTable).where(eq(ucAlisonConversationsTable.id, freshId));
});