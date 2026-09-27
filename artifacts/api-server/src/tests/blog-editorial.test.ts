import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { eq, inArray } from "drizzle-orm";
import {
  agentOauthClientsTable,
  agentOauthAuditTable,
  agentOauthTokensTable,
  db,
  teamUsersTable,
  ucBlogArticleHistoryTable,
  ucBlogArticlesTable,
  ucBlogRunsTable,
  ucBlogTopicsTable,
} from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import {
  deriveBlogRunTopics,
  generateBlogRun,
  parseArticleUpload,
  queueBlogRun,
  sanitizeArticleText,
  validateArticleInput,
  weeklyBlogRunKey,
} from "../lib/blog-editorial.js";

let server: http.Server;
let baseUrl: string;
const articleIds: string[] = [];
const runIds: string[] = [];
let agentClientId: string | null = null;
let teamActorId: string | null = null;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const publicSource = { title: "WHO drinking-water fact sheet", publisher: "WHO", url: "https://www.who.int/news-room/fact-sheets/detail/drinking-water" };

function singleFileDocx(memberName: string, content: string): Buffer {
  const name = Buffer.from(memberName);
  const plain = Buffer.from(content);
  const compressed = deflateRawSync(plain);
  const local = Buffer.alloc(30 + name.length + compressed.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(plain.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  compressed.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(plain.length, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

before(() => {
  process.env["SESSION_SECRET"] ??= "blog-editorial-test-secret";
  return new Promise<void>((resolve, reject) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Server did not bind"));
      baseUrl = `http://127.0.0.1:${address.port}/api`;
      resolve();
    });
  });
});

after(async () => {
  if (articleIds.length) {
    await db.delete(ucBlogArticleHistoryTable).where(inArray(ucBlogArticleHistoryTable.articleId, articleIds));
    await db.delete(ucBlogArticlesTable).where(inArray(ucBlogArticlesTable.id, articleIds));
  }
  if (runIds.length) await db.delete(ucBlogRunsTable).where(inArray(ucBlogRunsTable.id, runIds));
  if (agentClientId) {
    await db.delete(agentOauthTokensTable).where(eq(agentOauthTokensTable.clientId, agentClientId));
    await db.delete(agentOauthClientsTable).where(eq(agentOauthClientsTable.id, agentClientId));
  }
  if (teamActorId) await db.delete(teamUsersTable).where(eq(teamUsersTable.id, teamActorId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("blog text validation strips unsafe HTML and rejects unsafe source URLs", () => {
  assert.equal(sanitizeArticleText("Safe <script>alert(1)</script> text"), "Safe  text");
  assert.equal(sanitizeArticleText("[unsafe](javascript:alert(1))"), "[unsafe]");
  const valid = validateArticleInput({
    title: "Water safety", body: "Use trustworthy sources.", sources: [publicSource],
  });
  assert.equal(valid.ok, true);
  const invalid = validateArticleInput({
    title: "Water safety", body: "Use trustworthy sources.",
    sources: [{ title: "Local", url: "https://127.0.0.1/internal" }],
  });
  assert.equal(invalid.ok, false);
});

test("article imports accept text and markdown but reject unsupported and malformed uploads", () => {
  const text = Buffer.from("# Water basics\nRead the source.").toString("base64");
  assert.deepEqual(parseArticleUpload("draft.md", text), { ok: true, text: "# Water basics\nRead the source." });
  assert.equal(parseArticleUpload("draft.pdf", text).ok, false);
  assert.equal(parseArticleUpload("draft.docx", Buffer.from("not a zip").toString("base64")).ok, false);
  assert.equal(parseArticleUpload("draft.txt", "###not-base64###").ok, false);
  const docx = singleFileDocx("word/document.xml", "<w:p><w:r><w:t>Imported DOCX paragraph</w:t></w:r></w:p>");
  assert.deepEqual(parseArticleUpload("draft.docx", docx.toString("base64")), { ok: true, text: "Imported DOCX paragraph" });
});

test("weekly run id is stable for the same UTC week", () => {
  assert.equal(weeklyBlogRunKey(new Date("2025-05-07T12:00:00Z")), "weekly:2025-05-05");
  assert.equal(weeklyBlogRunKey(new Date("2025-05-11T23:00:00Z")), "weekly:2025-05-05");
});

test("stale Alison messages do not influence topic selection", () => {
  const now = new Date("2025-06-01T12:00:00Z");
  const staleOnly = deriveBlogRunTopics([
    { userMessage: "Everyone is asking about tap water safety", createdAt: new Date("2025-04-01T12:00:00Z") },
  ], 0, undefined, now);
  assert.deepEqual(staleOnly.themes, []);
  assert.deepEqual(staleOnly.proposalTopics, ["How to choose and maintain a household drinking-water filter"]);
});

test("repeated Alison themes fall back to varied general water-education topics", () => {
  const now = new Date("2025-06-01T12:00:00Z");
  const repetitiveTurns = Array.from({ length: 20 }, (_, index) => ({
    userMessage: `Please explain tap water safety question ${index}`,
    createdAt: now,
  }));
  const first = deriveBlogRunTopics(
    repetitiveTurns, repetitiveTurns.length, undefined, now, [
      "tap water safety (18 aggregated mentions)",
      "water filter maintenance (last week)",
      "hard water and scale (last week)",
    ],
  );
  assert.deepEqual(first.themes, []);
  assert.equal(first.proposalTopics[0], "How to choose and maintain a household drinking-water filter");

  const second = deriveBlogRunTopics([], 0, undefined, now, first.proposalTopics);
  const third = deriveBlogRunTopics([], 0, undefined, now, [...first.proposalTopics, ...second.proposalTopics]);
  assert.equal(second.proposalTopics[0], "Safe household drinking-water storage and container hygiene");
  assert.equal(third.proposalTopics[0], "When and how to test household drinking water");
  assert.equal(new Set([first.proposalTopics[0], second.proposalTopics[0], third.proposalTopics[0]]).size, 3);
});

test("weekly run queueing is idempotent and dispatches only once", async () => {
  const runKey = weeklyBlogRunKey(new Date("2025-05-07T12:00:00Z"));
  const dispatched: string[] = [];
  const dispatch = (id: string) => dispatched.push(id);
  const first = await queueBlogRun("weekly", runKey, null, undefined, dispatch);
  runIds.push(first.run.id);
  const duplicate = await queueBlogRun("weekly", runKey, null, undefined, dispatch);
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(first.run.id, duplicate.run.id);
  assert.deepEqual(dispatched, [first.run.id]);
});

test("research and generation failures persist actionable failed run states", async () => {
  const researchRun = await queueBlogRun("brief", `test:research:${randomBytes(5).toString("hex")}`, null, "Research failure test", () => undefined);
  runIds.push(researchRun.run.id);
  await generateBlogRun(researchRun.run.id, "Research failure test", {
    research: async () => { throw new Error("Mock research provider unavailable"); },
  });
  const [failedResearch] = await db.select().from(ucBlogRunsTable).where(eq(ucBlogRunsTable.id, researchRun.run.id));
  assert.equal(failedResearch?.status, "failed");
  assert.match(failedResearch?.error ?? "", /Mock research provider unavailable/);

  const generationRun = await queueBlogRun("brief", `test:generation:${randomBytes(5).toString("hex")}`, null, "Generation failure test", () => undefined);
  runIds.push(generationRun.run.id);
  await generateBlogRun(generationRun.run.id, "Generation failure test", {
    research: async () => [{
      title: "Drinking-water fact sheet",
      publisher: "World Health Organization",
      url: "https://www.who.int/news-room/fact-sheets/detail/drinking-water",
      excerpt: "A verified research excerpt long enough for a deterministic mocked generation failure test.",
    }],
    generate: async () => { throw new Error("Mock language model unavailable"); },
  });
  const [failedGeneration] = await db.select().from(ucBlogRunsTable).where(eq(ucBlogRunsTable.id, generationRun.run.id));
  assert.equal(failedGeneration?.status, "failed");
  assert.match(failedGeneration?.error ?? "", /Mock language model unavailable/);
});

test("public blog exposes published snapshots only and is insulated from draft edits", async () => {
  const draftId = `blog-draft-${randomBytes(5).toString("hex")}`;
  const liveId = `blog-live-${randomBytes(5).toString("hex")}`;
  const publishedAt = new Date();
  const snapshot = {
    slug: `published-${randomBytes(4).toString("hex")}`, title: "Safe water storage",
    summary: "A published snapshot.", body: "Snapshot body.", category: "Water education",
    tags: ["storage"], sources: [publicSource], publishedAt: publishedAt.toISOString(), version: "2",
  };
  await db.insert(ucBlogArticlesTable).values([
    { id: draftId, slug: `draft-${randomBytes(4).toString("hex")}`, title: "Private draft", summary: "", body: "Private body", category: "Water education", createdBy: "test", updatedBy: "test" },
    { id: liveId, slug: snapshot.slug, title: "Mutable working copy", summary: "Working copy", body: "Unpublished edit", category: "Water education", sources: [publicSource], status: "published", publishedAt, publishedSnapshot: snapshot, createdBy: "test", updatedBy: "test" },
  ]);
  articleIds.push(draftId, liveId);
  const listResponse = await fetch(`${baseUrl}/uc/blog`);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json() as { articles: Array<{ id: string; slug: string; title: string; body?: string }> };
  assert.equal(list.articles.some((article) => article.slug === snapshot.slug), true);
  assert.equal(list.articles.some((article) => article.slug.includes(draftId)), false);
  assert.equal(list.articles.find((article) => article.slug === snapshot.slug)?.title, snapshot.title);
  assert.equal(list.articles.find((article) => article.slug === snapshot.slug)?.id, liveId);
  assert.equal(list.articles.find((article) => article.slug === snapshot.slug)?.body, undefined);

  const detailResponse = await fetch(`${baseUrl}/uc/blog/${snapshot.slug}`);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json() as { article: { id: string; title: string; body: string } };
  assert.equal(detail.article.id, liveId);
  assert.equal(detail.article.body, snapshot.body);
  assert.equal((await fetch(`${baseUrl}/uc/blog/${draftId}`)).status, 404);
});

test("active ProjectHub admin status is database-verified and published edits stay on the old snapshot", async () => {
  const actorId = `blog-team-${randomBytes(5).toString("hex")}`;
  teamActorId = actorId;
  const slug = `admin-publication-${randomBytes(4).toString("hex")}`;
  await db.insert(teamUsersTable).values({
    id: actorId, email: "blog-editor@test.internal", name: "Blog Editor", passwordHash: "test-only", role: "admin", isActive: true,
  });
  const token = issueToken({ id: actorId, email: "blog-editor@test.internal", type: "team-session", role: "member" });
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const runsResponse = await fetch(`${baseUrl}/uc/editor/blog/runs`, { headers: auth });
  assert.equal(runsResponse.status, 200);
  assert.ok(Array.isArray((await runsResponse.json() as { runs: unknown[] }).runs));
  const createdResponse = await fetch(`${baseUrl}/uc/editor/blog`, {
    method: "POST", headers: auth, body: JSON.stringify({ slug, title: "Water storage basics", content: "Keep containers clean.", sources: [publicSource] }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { article: { id: string; content: string; status: string } };
  articleIds.push(created.article.id);
  assert.equal(created.article.content, "Keep containers clean.");
  const publishedResponse = await fetch(`${baseUrl}/uc/editor/blog/${created.article.id}/publish`, {
    method: "POST", headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(publishedResponse.status, 200);
  const editedSlug = `edited-${slug}`;
  const changedResponse = await fetch(`${baseUrl}/uc/editor/blog/${created.article.id}`, {
    method: "PATCH", headers: auth,
    body: JSON.stringify({ slug: editedSlug, title: "Water storage basics", content: "New review copy.", sources: [publicSource] }),
  });
  assert.equal(changedResponse.status, 200);
  const preRepublishList = await (await fetch(`${baseUrl}/uc/blog`)).json() as { articles: Array<{ slug: string }> };
  assert.ok(preRepublishList.articles.some((article) => article.slug === slug));
  assert.equal(preRepublishList.articles.some((article) => article.slug === editedSlug), false);
  const publicResponse = await fetch(`${baseUrl}/uc/blog/${slug}`);
  const publicBody = await publicResponse.json() as { article: { body: string } };
  assert.equal(publicBody.article.body, "Keep containers clean.");
  assert.equal((await fetch(`${baseUrl}/uc/blog/${editedSlug}`)).status, 404);
  const republishedResponse = await fetch(`${baseUrl}/uc/editor/blog/${created.article.id}/publish`, {
    method: "POST", headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(republishedResponse.status, 200);
  const postRepublishList = await (await fetch(`${baseUrl}/uc/blog`)).json() as { articles: Array<{ slug: string }> };
  assert.equal(postRepublishList.articles.some((article) => article.slug === slug), false);
  assert.ok(postRepublishList.articles.some((article) => article.slug === editedSlug));
  assert.equal((await fetch(`${baseUrl}/uc/blog/${slug}`)).status, 404);
  const republishedDetail = await fetch(`${baseUrl}/uc/blog/${editedSlug}`);
  assert.equal(republishedDetail.status, 200);
  assert.equal((await republishedDetail.json() as { article: { body: string } }).article.body, "New review copy.");

  const directSlug = `direct-admin-${randomBytes(4).toString("hex")}`;
  const directCreateResponse = await fetch(`${baseUrl}/uc/editor/blog`, {
    method: "POST", headers: auth,
    body: JSON.stringify({
      slug: directSlug, title: "Direct admin publication", content: "Published in the same request.",
      sources: [publicSource], directPublish: true,
    }),
  });
  assert.equal(directCreateResponse.status, 201);
  const directCreated = await directCreateResponse.json() as { article: { id: string; status: string; content: string } };
  articleIds.push(directCreated.article.id);
  assert.equal(directCreated.article.status, "published");
  assert.equal(directCreated.article.content, "Published in the same request.");
  const directPublic = await fetch(`${baseUrl}/uc/blog/${directSlug}`);
  assert.equal(directPublic.status, 200);
  assert.equal((await directPublic.json() as { article: { body: string } }).article.body, "Published in the same request.");

  await db.update(teamUsersTable).set({ role: "member" }).where(eq(teamUsersTable.id, actorId));
  const nonAdminCreateResponse = await fetch(`${baseUrl}/uc/editor/blog`, {
    method: "POST", headers: auth,
    body: JSON.stringify({
      title: "Non-admin direct publication", content: "Must not be created as a published article.",
      sources: [publicSource], directPublish: true,
    }),
  });
  assert.equal(nonAdminCreateResponse.status, 403);
  const demotedResponse = await fetch(`${baseUrl}/uc/editor/blog/${created.article.id}/publish`, {
    method: "POST", headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(demotedResponse.status, 401);
});

test("external machine submissions require blog.submit and remain unpublished drafts", async () => {
  const clientId = `blog-agent-${randomBytes(5).toString("hex")}`;
  agentClientId = clientId;
  const token = randomBytes(32).toString("base64url");
  await db.insert(agentOauthClientsTable).values({
    id: clientId, name: "Editorial agent", secretHash: hash("unused"), scopes: ["blog.submit"], createdBy: "test",
  });
  await db.insert(agentOauthTokensTable).values({
    clientId, tokenHash: hash(token), scopes: ["blog.submit"], expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  const response = await fetch(`${baseUrl}/integrations/v1/blog/drafts`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ articles: [{ title: "Filter care", body: "Clean filters as instructed.", sources: [publicSource] }] }),
  });
  assert.equal(response.status, 201);
  const result = await response.json() as { articles: Array<{ id: string; status: string; origin: string }>; publicationRequiresAdminReview: boolean };
  articleIds.push(...result.articles.map((article) => article.id));
  assert.equal(result.articles[0]?.status, "draft");
  assert.equal(result.articles[0]?.origin, "agent");
  assert.equal(result.publicationRequiresAdminReview, true);
  const invalidBatchTitle = `atomic-blog-${randomBytes(4).toString("hex")}`;
  const invalidBatch = await fetch(`${baseUrl}/integrations/v1/blog/drafts`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ articles: [
      { title: invalidBatchTitle, body: "This valid first draft must roll back.", sources: [publicSource] },
      { title: "Unsafe second draft", body: "This source must reject the whole batch.", sources: [{ title: "Private", url: "https://127.0.0.1/private" }] },
    ] }),
  });
  assert.equal(invalidBatch.status, 400);
  assert.equal((await db.select().from(ucBlogArticlesTable).where(eq(ucBlogArticlesTable.title, invalidBatchTitle))).length, 0);
  const invalidTopicName = `atomic-topic-${randomBytes(4).toString("hex")}`;
  const invalidTopics = await fetch(`${baseUrl}/integrations/v1/blog/topics`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ topics: [
      { topic: invalidTopicName, rationale: "Valid first topic.", sources: [publicSource] },
      { topic: "Unsafe second topic", rationale: "Private source should reject batch.", sources: [{ title: "Private", url: "https://127.0.0.1/private" }] },
    ] }),
  });
  assert.equal(invalidTopics.status, 400);
  assert.equal((await db.select().from(ucBlogTopicsTable).where(eq(ucBlogTopicsTable.topic, invalidTopicName))).length, 0);
  const audit = await db.select().from(agentOauthAuditTable).where(eq(agentOauthAuditTable.clientId, clientId));
  assert.ok(audit.some((entry) => entry.action === "POST /integrations/v1/blog/drafts" && entry.outcome === "success"));
  const noScopeToken = randomBytes(32).toString("base64url");
  await db.insert(agentOauthTokensTable).values({
    clientId, tokenHash: hash(noScopeToken), scopes: ["alison.read"], expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  const denied = await fetch(`${baseUrl}/integrations/v1/blog/topics`, {
    method: "POST", headers: { authorization: `Bearer ${noScopeToken}`, "content-type": "application/json" },
    body: JSON.stringify({ topics: [{ topic: "Water storage", rationale: "Users ask about it", sources: [publicSource] }] }),
  });
  assert.equal(denied.status, 403);
});