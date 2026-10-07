import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { verifyFeedbackReceipt } from "../lib/ai-feedback-receipt.js";
import router, { _aiClient, _knowledgeClient, _catalogueClient, SYSTEM_PROMPT, type AiChatParams } from "../routes/uc-water-chat.js";
import { AlisonKnowledgeError } from "../lib/alison-knowledge.js";
import { createAlisonCatalogueLoader } from "../lib/alison-catalogue.js";
import { wcFetchArray, fetchAllPublishedProducts } from "../routes/uc.js";

const prefix = "alison-knowledge-fixture";
const originalCreate = _aiClient.create;
const originalLoad = _knowledgeClient.load;
const originalCatalogue = _catalogueClient.load;
let server: http.Server;
let baseUrl: string;
let sequence = 0;
const savedSecret = process.env.SESSION_SECRET;

before(async () => {
  _catalogueClient.load = async () => ({ state: "unavailable", reason: "not_configured" });
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
  _catalogueClient.load = async () => ({ state: "unavailable", reason: "not_configured" });
});

after(async () => {
  _aiClient.create = originalCreate;
  _knowledgeClient.load = originalLoad;
  _catalogueClient.load = originalCatalogue;
  if (savedSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = savedSecret;
  await pool.query("DELETE FROM uc_alison_conversations WHERE id=$1", [`${prefix}-conversation`]);
  await pool.query("DELETE FROM uc_guides WHERE id LIKE $1", [`${prefix}-%`]);
  await pool.query("DELETE FROM uc_blog_articles WHERE id LIKE $1", [`${prefix}-%`]);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function send(messages: AiChatParams["messages"] = [{ role: "user", content: "Explain Aquazeta maintenance" }], existingTurnId?: string) {
  return fetch(`${baseUrl}/uc/ai/water-chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${issueToken({ id: 987654, email: "knowledge-test@example.test" })}`,
    },
    body: JSON.stringify({
      conversationId: `${prefix}-conversation`, turnId: existingTurnId ?? `${prefix}-turn-${++sequence}`,
      messages,
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
  const { feedbackToken, ...answer } = await response.json();
  assert.ok(verifyFeedbackReceipt(feedbackToken, 987654, "Explain Aquazeta maintenance", answer.reply));
  assert.deepEqual(answer, {
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

test("chat passes live store facts to AI, and an outage keeps guidance without old prices", async () => {
  _catalogueClient.load = async () => ({
    state: "available", checkedAt: new Date().toISOString(), currency: "KES",
    products: [{ id: 941, name: "Aquazeta", price: "5200", priceKind: "listed", availability: "outofstock" }],
  });
  _aiClient.create = async params => {
    assert.match(params.system, /"id":941/);
    assert.match(params.system, /"price":"5200"/);
    assert.match(params.system, /"availability":"outofstock"/);
    assert.match(params.system, /APPROVED_GUIDE_FACT/);
    return { content: [{ type: "text", text: "Aquazeta is currently out of stock." }] };
  };
  assert.equal((await send()).status, 200);
  _catalogueClient.load = async () => ({ state: "unavailable", reason: "lookup_failed" });
  _aiClient.create = async params => {
    assert.match(params.system, /"state":"unavailable"/);
    assert.doesNotMatch(params.system, /"price":"5200"/);
    assert.match(params.system, /APPROVED_GUIDE_FACT/);
    return { content: [{ type: "text", text: "Current prices and stock cannot be checked." }] };
  };
  assert.equal((await send()).status, 200);
});

test("live adapter reuses complete paging, PHP-notice parsing and rejects HTTP or oversized responses", async () => {
  const originalFetch = globalThis.fetch;
  let mode: "success" | "http_error" | "oversized" | "later_page_error" = "success";
  const pages: number[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method ?? "GET", "GET", "enrichment cannot mutate WooCommerce");
    assert.ok(init?.signal);
    const url = new URL(String(input));
    if (mode === "http_error") return new Response("[]", { status: 503 });
    if (mode === "oversized") return new Response("x".repeat(256 * 1024 + 1));
    if (url.pathname.endsWith("/settings/general")) {
      return new Response(JSON.stringify([{ id: "woocommerce_currency", value: "KES" }]));
    }
    assert.equal(url.pathname.endsWith("/products"), true);
    assert.equal(url.searchParams.get("status"), "publish");
    const page = Number(url.searchParams.get("page"));
    pages.push(page);
    if (page === 2 && mode === "later_page_error") return new Response("[]", { status: 502 });
    const rows = page === 1
      ? Array.from({ length: 100 }, (_, i) => ({
        id: i + 1, name: `Filter ${i}`, status: "publish", price: "123", stock_status: "instock",
      }))
      : [{ id: 1001, name: "Aquazeta", status: "publish", price: "4321", stock_status: "outofstock" }];
    return new Response("<br /><b>Notice</b>: store notice\n" + JSON.stringify(rows));
  }) as typeof fetch;
  const freshLoader = () => createAlisonCatalogueLoader({
    configured: () => true, allPublished: fetchAllPublishedProducts,
    read: (path, parameters, signal) => wcFetchArray(path, parameters, signal, 256 * 1024),
  });
  try {
    const result = await freshLoader()();
    assert.equal(result.state, "available");
    if (result.state === "available") {
      assert.equal(result.products.length, 101);
      assert.equal(result.products.at(-1)?.id, 1001);
    }
    assert.deepEqual(pages, [1, 2]);
    for (const failure of ["http_error", "oversized", "later_page_error"] as const) {
      mode = failure;
      assert.deepEqual(await freshLoader()(), { state: "unavailable", reason: "lookup_failed" });
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("customer response and stored transcript reject AI claims; HTTP replay rechecks current commerce", async () => {
  const messages: AiChatParams["messages"] = [{ role: "user", content: "What is the Aquazeta price and availability?" }];
  _catalogueClient.load = async () => ({
    state: "available", checkedAt: new Date().toISOString(), currency: "KES",
    products: [{ id: 941, name: "Aquazeta", price: "5200", priceKind: "listed", availability: null }],
  });
  let calls = 0;
  _aiClient.create = async () => {
    calls++;
    return { content: [{ type: "text", text: 'It costs KES 12,345 and is available to order. [Aquazeta](product:101).<!--SUG:["Buy for USD 9?"]-->' }] };
  };
  const response = await send(messages);
  assert.equal(response.status, 200);
  const first = await response.json() as { reply: string; suggestions: string[] };
  assert.match(first.reply, /product:941/);
  assert.match(first.reply, /KES 5,200/);
  assert.match(first.reply, /stock availability cannot be verified/);
  assert.doesNotMatch(first.reply + JSON.stringify(first.suggestions), /12,345|product:101|USD|available to order/);
  const turnId = `${prefix}-turn-${sequence}`;
  const stored = await pool.query("SELECT assistant_message FROM uc_alison_turns WHERE conversation_id=$1 AND turn_id=$2",
    [`${prefix}-conversation`, turnId]);
  assert.equal(stored.rows[0].assistant_message, first.reply);
  // Replay same HTTP identity after a store outage: no old commerce or second paid call.
  _catalogueClient.load = async () => ({ state: "unavailable", reason: "lookup_failed" });
  const replay = await send(messages, turnId);
  assert.equal(replay.status, 200);
  const second = await replay.json() as { reply: string };
  assert.match(second.reply, /cannot verify current prices/);
  assert.doesNotMatch(second.reply, /product:|5,200/);
  assert.equal(calls, 1);
});

test("a concurrent historical writer cannot bypass the response guard", async () => {
  _catalogueClient.load = async () => ({
    state: "available", checkedAt: new Date().toISOString(), currency: "KES",
    products: [{ id: 941, name: "Aquazeta", price: "5200", priceKind: "listed", availability: "onbackorder" }],
  });
  _aiClient.create = async () => {
    await pool.query("INSERT INTO uc_alison_conversations (id) VALUES ($1) ON CONFLICT DO NOTHING", [`${prefix}-conversation`]);
    await pool.query(`INSERT INTO uc_alison_turns (conversation_id,turn_id,user_message,assistant_message)
      VALUES ($1,$2,'What is the Aquazeta price and stock?','KES 12,345, in stock. [Aquazeta](product:101)')`,
    [`${prefix}-conversation`, `${prefix}-turn-${sequence}`]);
    return { content: [{ type: "text", text: "A different model answer" }] };
  };
  const response = await send([{ role: "user", content: "What is the Aquazeta price and stock?" }]);
  assert.equal(response.status, 200);
  const delivered = await response.json() as { reply: string; suggestions: string[] };
  assert.match(delivered.reply, /product:941/);
  assert.match(delivered.reply, /KES 5,200/);
  assert.match(delivered.reply, /on backorder/);
  assert.doesNotMatch(delivered.reply, /12,345|product:101|in stock/);
  assert.deepEqual(delivered.suggestions, []);
});

test("HTTP delivery, persistence and replays preserve installation, cleaning, returns and recommendations", async () => {
  _catalogueClient.load = async () => ({
    state: "available", checkedAt: new Date().toISOString(), currency: "KES",
    products: [{ id: 941, name: "Aquazeta", price: "5200", priceKind: "listed", availability: "instock" }],
  });
  const examples = [
    { question: "In what order should I install Aquazeta cartridges?", answer: "First turn off the water, then follow the Aquazeta guide's cartridge installation sequence." },
    { question: "How do I clean Aquazeta?", answer: "Rinse [Aquazeta](product:941) as the guide recommends before fitting the clean housing." },
    { question: "My order arrived with a leaking Aquazeta filter. How do I request a return?", answer: "I'm sorry your filter is leaking. Open Orders, select the affected order, then choose Request a Return so the team can review it." },
    { question: "Which filter suits my mains water?", answer: "The approved guide describes [Aquazeta](product:941) as an option for this use. Follow its installation guidance." },
  ];
  for (const example of examples) {
    let calls = 0;
    _aiClient.create = async () => { calls++; return { content: [{ type: "text", text: example.answer }] }; };
    const messages: AiChatParams["messages"] = [{ role: "user", content: example.question }];
    const response = await send(messages);
    assert.equal(response.status, 200, example.question);
    assert.equal((await response.json() as { reply: string }).reply, example.answer);
    const turnId = `${prefix}-turn-${sequence}`;
    const stored = await pool.query("SELECT assistant_message FROM uc_alison_turns WHERE conversation_id=$1 AND turn_id=$2",
      [`${prefix}-conversation`, turnId]);
    assert.equal(stored.rows[0].assistant_message, example.answer);
    const replay = await send(messages, turnId);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as { reply: string }).reply, example.answer);
    assert.equal(calls, 1);
  }
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