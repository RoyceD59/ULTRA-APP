import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import router, { _aiClient, _knowledgeClient, SYSTEM_PROMPT, type AiChatParams } from "../routes/uc-water-chat.js";
import { AlisonKnowledgeError } from "../lib/alison-knowledge.js";

const prefix = "alison-knowledge-fixture";
const originalCreate = _aiClient.create;
const originalLoad = _knowledgeClient.load;
let server: http.Server;
let baseUrl: string;
let sequence = 0;
const savedSecret = process.env.SESSION_SECRET;

before(async () => {
  process.env.SESSION_SECRET = "alison-knowledge-test-secret";
  for (const status of ["published", "draft"]) {
    await pool.query(
      `INSERT INTO uc_guides (id,slug,title,summary,category,status,published_snapshot)
       VALUES ($1,$1,'PRIVATE_DRAFT_TITLE','PRIVATE_DRAFT_SUMMARY','Maintenance',$2,$3::jsonb)`,
      [`${prefix}-guide-${status}`, status, JSON.stringify({
        title: `Aquazeta ${status} guide`, summary: "Aquazeta filter guidance",
        sections: [{ heading: "Maintenance", body: status === "published" ? "APPROVED_GUIDE_FACT" : "UNPUBLISHED_GUIDE_FACT", warning: "Never drink suspect water" }],
      })],
    );
  }
  for (const status of ["published", "draft", "rejected"]) {
    await pool.query(
      `INSERT INTO uc_blog_articles
       (id,slug,title,body,origin,status,created_by,updated_by,published_snapshot,published_at)
       VALUES ($1,$1,'PRIVATE_ARTICLE_EDIT','PRIVATE_ARTICLE_EDIT','agent',$2,'test','test',$3::jsonb,now())`,
      [`${prefix}-article-${status}`, status, JSON.stringify({
        title: `Aquazeta ${status} article`,
        body: status === "published" ? "APPROVED_AGENT_MARKDOWN_FACT" : `UNAPPROVED_AGENT_${status.toUpperCase()}_FACT`,
      })],
    );
  }
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

afterEach(() => {
  _aiClient.create = originalCreate;
  _knowledgeClient.load = originalLoad;
});

after(async () => {
  _aiClient.create = originalCreate;
  _knowledgeClient.load = originalLoad;
  if (savedSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = savedSecret;
  await pool.query("DELETE FROM uc_alison_conversations WHERE id=$1", [`${prefix}-conversation`]);
  await pool.query("DELETE FROM uc_guides WHERE id LIKE $1", [`${prefix}-%`]);
  await pool.query("DELETE FROM uc_blog_articles WHERE id LIKE $1", [`${prefix}-%`]);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function send() {
  return fetch(`${baseUrl}/uc/ai/water-chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${issueToken({ id: 987654, email: "knowledge-test@example.test" })}`,
    },
    body: JSON.stringify({
      conversationId: `${prefix}-conversation`, turnId: `${prefix}-turn-${++sequence}`,
      messages: [{ role: "user", content: "Explain Aquazeta maintenance" }],
    }),
  });
}

test("concise instructions allow requested detail while retaining safety, links and suggestions", () => {
  assert.match(SYSTEM_PROMPT, /Default to 2–4 short sentences/);
  assert.match(SYSTEM_PROMPT, /customer explicitly requests it/);
  assert.match(SYSTEM_PROMPT, /Do not sacrifice safety warnings/);
  assert.match(SYSTEM_PROMPT, /laboratory measurement/);
  assert.match(SYSTEM_PROMPT, /product:ID/);
  assert.match(SYSTEM_PROMPT, /<!--SUG:/);
  assert.doesNotMatch(SYSTEM_PROMPT, /2–4 short paragraphs/);
});

test("Alison receives approved guide and agent Markdown snapshots, not drafts or private edits", async () => {
  let captured: AiChatParams | undefined;
  _aiClient.create = async (params) => {
    captured = params;
    return { content: [{ type: "text", text: 'The Aquazeta guide recommends regular maintenance.<!--SUG:["How often?","Which cartridge?"]-->' }] };
  };
  const response = await send();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reply: "The Aquazeta guide recommends regular maintenance.", suggestions: ["How often?", "Which cartridge?"],
  });
  assert.ok(captured);
  assert.match(captured.system, /APPROVED_GUIDE_FACT/);
  assert.match(captured.system, /APPROVED_AGENT_MARKDOWN_FACT/);
  assert.match(captured.system, /Never drink suspect water/);
  assert.doesNotMatch(captured.system, /UNPUBLISHED_GUIDE_FACT|UNAPPROVED_AGENT_|PRIVATE_DRAFT_|PRIVATE_ARTICLE_EDIT/);
  assert.equal(captured.messages.at(-1)?.content, "Explain Aquazeta maintenance");
});

test("unpublishing a document removes it from the next lookup", async () => {
  await pool.query("UPDATE uc_blog_articles SET status='draft' WHERE id=$1", [`${prefix}-article-published`]);
  _aiClient.create = async (params) => {
    assert.doesNotMatch(params.system, /APPROVED_AGENT_MARKDOWN_FACT/);
    assert.match(params.system, /APPROVED_GUIDE_FACT/);
    return { content: [{ type: "text", text: "Guide-only advice." }] };
  };
  assert.equal((await send()).status, 200);
});

test("reference failure returns a clear 503 without calling AI or storing an invented answer", async () => {
  let called = false;
  _knowledgeClient.load = async () => { throw new AlisonKnowledgeError(); };
  _aiClient.create = async () => { called = true; return { content: [] }; };
  const response = await send();
  assert.equal(response.status, 503);
  assert.match((await response.json() as { error: string }).error, /reference documents are temporarily unavailable/);
  assert.equal(called, false);
  const stored = await pool.query("SELECT count(*)::int AS count FROM uc_alison_turns WHERE conversation_id=$1 AND turn_id=$2", [
    `${prefix}-conversation`, `${prefix}-turn-${sequence}`,
  ]);
  assert.equal(stored.rows[0].count, 0);
});