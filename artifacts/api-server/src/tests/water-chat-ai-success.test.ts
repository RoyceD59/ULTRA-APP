/**
 * Exercise the real HTTP chat route and transcript persistence with deterministic
 * Anthropic responses. Run through src/tests/run.ts for test-database isolation.
 */
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { db, ucAlisonConversationsTable } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import waterChatRouter, {
  _aiClient, _knowledgeClient, SYSTEM_PROMPT, type AiChatParams,
} from "../routes/uc-water-chat.js";

describe("water-chat — successful Anthropic responses", () => {
  let server: http.Server;
  let baseUrl: string;
  const originalCreate = _aiClient.create;
  const originalLoad = _knowledgeClient.load;
  const conversations = new Set<string>();
  const knowledge = "APPROVED_REFERENCE: Ask which water source the customer uses.";
  const messages: AiChatParams["messages"] = [
    { role: "user", content: "I use borehole water." },
    { role: "assistant", content: "What would you like to know?" },
    { role: "user", content: "How should I test it?" },
  ];

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", waterChatRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterEach(async () => {
    _aiClient.create = originalCreate;
    _knowledgeClient.load = originalLoad;
    for (const id of conversations) {
      await db.delete(ucAlisonConversationsTable)
        .where(eq(ucAlisonConversationsTable.id, id));
    }
    conversations.clear();
  });

  after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  async function send(content: Awaited<ReturnType<typeof originalCreate>>["content"]) {
    const calls: AiChatParams[] = [];
    _knowledgeClient.load = async (submittedMessages) => {
      assert.deepEqual(submittedMessages, messages);
      return knowledge;
    };
    _aiClient.create = async (params) => {
      calls.push(params);
      return { content };
    };
    const conversationId = `success-${randomUUID()}`;
    conversations.add(conversationId);
    const response = await fetch(`${baseUrl}/uc/ai/water-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${issueToken({ id: 221000001, email: "chat-success@example.test" })}`,
      },
      body: JSON.stringify({ messages, conversationId, turnId: randomUUID() }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(calls.length, 1, "The request must reach Anthropic, not a saved-turn shortcut");
    return { body, params: calls[0] };
  }

  it("returns the parsed reply and suggestions and preserves conversation history", async () => {
    const reply = "A professional water test can help assess your borehole water.";
    const suggestions = ["How do I book a test?", "What does the test check?"];
    const { body, params } = await send([
      { type: "text", text: `${reply}\n<!--SUG:${JSON.stringify(suggestions)}-->\n` },
    ]);
    assert.deepEqual(body, { reply, suggestions });
    assert.deepEqual(params.messages, messages);
    assert.equal(params.model, "claude-haiku-4-5");
    assert.equal(params.max_tokens, 1024);
    assert.equal(params.system, `${SYSTEM_PROMPT}\n\n${knowledge}`);
  });

  it("returns the reply with an empty suggestions array when there is no SUG footer", async () => {
    const reply = "Which water source do you use?";
    const { body } = await send([{ type: "text", text: reply }]);
    assert.deepEqual(body, { reply, suggestions: [] });
  });

  for (const [name, content] of [
    ["an empty text block", [{ type: "text", text: "" }]],
    ["an empty content array", []],
  ] as const) {
    it(`returns the friendly fallback with no suggestions for ${name}`, async () => {
      const { body } = await send([...content]);
      assert.deepEqual(body, {
        reply: "I'm sorry, I couldn't generate a response. Please try again.",
        suggestions: [],
      });
    });
  }
});