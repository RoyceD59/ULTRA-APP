import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { db, teamUsersTable, ucUsersTable, ucAiFeedbackTable, ucAlisonConversationsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import { issueFeedbackReceipt, verifyFeedbackReceipt } from "../lib/ai-feedback-receipt.js";
import { _aiClient, _knowledgeClient } from "../routes/uc-water-chat.js";

let server: Server;
let base: string;
let userId: number;
let otherId: number;
let providerCalls = 0;
const teamId = randomUUID();
const inactiveId = randomUUID();
const conversationId = randomUUID();
const originalCreate = anthropic.messages.create;
const originalChat = _aiClient.create;
const originalKnowledge = _knowledgeClient.load;
const bearer = (id: string | number, team = false) => `Bearer ${issueToken({
  id, email: "security-fixture@example.test", ...(team ? { type: "team-session" } : {}),
  credentialVersion: 0,
})}`;

before(async () => {
  process.env["SESSION_SECRET"] ??= "ai-endpoint-security-test-secret";
  await db.insert(teamUsersTable).values([
    { id: teamId, email: `${teamId}@example.test`, name: "Test", passwordHash: "unused" },
    { id: inactiveId, email: `${inactiveId}@example.test`, name: "Inactive", passwordHash: "unused", isActive: false },
  ]);
  const users = await db.insert(ucUsersTable).values([
    { email: `${randomUUID()}@example.test`, firstName: "Test", passwordHash: "unused" },
    { email: `${randomUUID()}@example.test`, firstName: "Other", passwordHash: "unused" },
  ]).returning({ id: ucUsersTable.id });
  [userId, otherId] = users.map((user) => user.id);
  anthropic.messages.create = (async () => {
    providerCalls++;
    return { content: [{ type: "text", text: "Private project summary" }] };
  }) as typeof anthropic.messages.create;
  _aiClient.create = async () => ({ content: [{ type: "text", text: "Use clean water." }] });
  _knowledgeClient.load = async () => "Approved water guidance";
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  base = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  anthropic.messages.create = originalCreate;
  _aiClient.create = originalChat;
  _knowledgeClient.load = originalKnowledge;
  await db.delete(ucAiFeedbackTable).where(inArray(ucAiFeedbackTable.userId, [userId, otherId]));
  await db.delete(ucAlisonConversationsTable).where(eq(ucAlisonConversationsTable.id, conversationId));
  await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, [userId, otherId]));
  await db.delete(teamUsersTable).where(inArray(teamUsersTable.id, [teamId, inactiveId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(path: string, body: unknown, authorization?: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(body),
  });
}

test("project context rejects anonymous, invalid, customer, inactive and missing team principals before provider work", async () => {
  for (const authorization of [undefined, "Bearer invalid", bearer(userId)]) {
    assert.equal((await post("/ai/query", { question: "List private tasks" }, authorization)).status, 401);
  }
  for (const id of [inactiveId, randomUUID()]) {
    assert.equal((await post("/ai/query", { question: "List private tasks" }, bearer(id, true))).status, 403);
  }
  assert.equal(providerCalls, 0);
});

test("active team query validates input and limits provider spending per principal", async () => {
  const authorization = bearer(teamId, true);
  assert.equal((await post("/ai/query", { question: "x".repeat(4001) }, authorization)).status, 400);
  assert.equal(providerCalls, 0);
  for (let i = 0; i < 9; i++) {
    const response = await post("/ai/query", { question: "Summarize projects" }, authorization);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).answer, "Private project summary");
  }
  const limited = await post("/ai/query", { question: "Summarize projects" }, authorization);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
  assert.equal(providerCalls, 9);
  await db.update(teamUsersTable).set({ isActive: false }).where(eq(teamUsersTable.id, teamId));
  assert.equal((await post("/ai/query", { question: "Summarize projects" }, authorization)).status, 403);
});

test("feedback requires customer auth and a genuine, unchanged, owner-bound, unexpired answer receipt", async () => {
  const payload = { rating: "down", question: "fabricated", answer: "fabricated" };
  for (const authorization of [undefined, "Bearer invalid", bearer(teamId, true)]) {
    assert.equal((await post("/uc/ai/chat-feedback", payload, authorization)).status, 401);
  }
  assert.equal((await post("/uc/ai/chat-feedback", payload, bearer(userId))).status, 400);
  const token = issueFeedbackReceipt(userId, conversationId, "receipt-test-turn", payload.question, payload.answer);
  assert.equal(verifyFeedbackReceipt(`${token}x`, userId, payload.question, payload.answer), null);
  assert.equal(verifyFeedbackReceipt(token, otherId, payload.question, payload.answer), null);
  assert.equal(verifyFeedbackReceipt(token, userId, "tampered", payload.answer), null);
  assert.equal(verifyFeedbackReceipt(token, userId, payload.question, "tampered"), null);
  const now = Date.now;
  try {
    Date.now = () => now() + 31 * 24 * 60 * 60 * 1000;
    assert.equal(verifyFeedbackReceipt(token, userId, payload.question, payload.answer), null);
  } finally {
    Date.now = now;
  }
  assert.equal((await post("/uc/ai/chat-feedback", { ...payload, feedbackToken: token }, bearer(otherId))).status, 400);
  assert.equal((await post("/uc/ai/chat-feedback", { ...payload, feedbackToken: `${token}x` }, bearer(userId))).status, 400);
  assert.equal((await db.select().from(ucAiFeedbackTable).where(eq(ucAiFeedbackTable.userId, userId))).length, 0);
});

test("chat receipt survives replay; concurrent feedback inserts once and cannot be replayed to grow storage", async () => {
  const question = "How should I store water?";
  const turnId = randomUUID();
  const chat = { conversationId, turnId, messages: [{ role: "user", content: question }] };
  const authorization = bearer(userId);
  const response = await post("/uc/ai/water-chat", chat, authorization);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.feedbackToken);
  const replay = await post("/uc/ai/water-chat", chat, authorization);
  assert.equal(replay.status, 200);
  const replayResult = await replay.json();
  assert.equal(verifyFeedbackReceipt(result.feedbackToken, userId, question, result.reply),
    verifyFeedbackReceipt(replayResult.feedbackToken, userId, question, replayResult.reply));
  assert.equal((await post("/uc/ai/water-chat", {
    ...chat, messages: [{ role: "user", content: "Different question" }],
  }, authorization)).status, 409);
  const payload = { rating: "down", question, answer: result.reply, feedbackToken: result.feedbackToken };
  assert.equal((await post("/uc/ai/chat-feedback", { ...payload, answer: "fabricated" }, authorization)).status, 400);
  assert.equal((await post("/uc/ai/chat-feedback", { ...payload, rating: "invalid" }, authorization)).status, 400);
  const results = await Promise.all(Array.from({ length: 3 }, () => post("/uc/ai/chat-feedback", payload, authorization)));
  assert.ok(results.every((response) => response.status === 200));
  const rows = await db.select().from(ucAiFeedbackTable).where(eq(ucAiFeedbackTable.userId, userId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].question, question);
  assert.equal(rows[0].answer, result.reply);
  assert.equal(rows[0].rating, "down");
  assert.equal((await post("/uc/ai/chat-feedback", {
    ...payload, rating: "up", feedbackToken: replayResult.feedbackToken,
  }, authorization)).status, 200);
  assert.equal((await db.select().from(ucAiFeedbackTable).where(eq(ucAiFeedbackTable.userId, userId)))[0].rating, "down");
  let status = 200;
  for (let i = 0; i < 20 && status !== 429; i++) {
    status = (await post("/uc/ai/chat-feedback", payload, authorization)).status;
  }
  assert.equal(status, 429);
  assert.equal((await db.select().from(ucAiFeedbackTable).where(eq(ucAiFeedbackTable.userId, userId))).length, 1);
});
