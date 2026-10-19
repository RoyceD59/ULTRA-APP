import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { pool } from "@workspace/db";
import type { BlogSource } from "@workspace/db";

const MAX_ARTICLE_CHARS = 50_000;
const RESEARCH_SOURCES = [
  { title: "Drinking-water fact sheet", publisher: "World Health Organization", url: "https://www.who.int/news-room/fact-sheets/detail/drinking-water" },
  { title: "Home water treatment systems", publisher: "U.S. Centers for Disease Control and Prevention", url: "https://www.cdc.gov/drinking-water/about/about-home-water-treatment-systems.html" },
  { title: "Home drinking water filtration fact sheets", publisher: "U.S. Environmental Protection Agency", url: "https://www.epa.gov/ground-water-and-drinking-water/home-drinking-water-filtration-fact-sheets" },
] as const;

export type BlogArticleInput = {
  slug?: string;
  title: string;
  summary?: string;
  body: string;
  category?: string;
  tags?: string[];
  sources?: BlogSource[];
  rationale?: string;
};

export function sanitizeArticleText(input: string): string {
  return input
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\]\(\s*(?:javascript|data|vbscript):[^)]*(?:\)[^)]*)*\)/gi, "]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_ARTICLE_CHARS);
}

function safeSource(source: unknown): BlogSource | null {
  if (!source || typeof source !== "object") return null;
  const candidate = source as Record<string, unknown>;
  if (typeof candidate.url !== "string" || typeof candidate.title !== "string") return null;
  try {
    const url = new URL(candidate.url);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/i.test(url.hostname)) return null;
    if (/\.(?:local|internal|test|invalid)$/i.test(url.hostname)) return null;
    const title = sanitizeArticleText(candidate.title).slice(0, 200);
    if (!title) return null;
    return {
      title,
      url: url.toString(),
      ...(typeof candidate.publisher === "string" ? { publisher: sanitizeArticleText(candidate.publisher).slice(0, 120) } : {}),
    };
  } catch {
    return null;
  }
}

export function validateArticleInput(value: unknown): { ok: true; article: BlogArticleInput } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Article must be an object" };
  const input = value as Record<string, unknown>;
  if (typeof input.title !== "string" || !input.title.trim()) return { ok: false, error: "Article title is required" };
  if (typeof input.body !== "string" || !input.body.trim()) return { ok: false, error: "Article body is required" };
  const title = sanitizeArticleText(input.title).slice(0, 200);
  const body = sanitizeArticleText(input.body);
  if (!title || !body) return { ok: false, error: "Article title and body must contain readable text" };
  const sourcesIn = input.sources === undefined ? [] : input.sources;
  if (!Array.isArray(sourcesIn) || sourcesIn.length > 8) return { ok: false, error: "Sources must be an array containing at most 8 entries" };
  const sources = sourcesIn.map(safeSource);
  if (sources.some((source) => source === null)) return { ok: false, error: "Every source requires a title and a public HTTPS URL" };
  const tags = input.tags === undefined ? [] : input.tags;
  if (!Array.isArray(tags) || tags.length > 12 || tags.some((tag) => typeof tag !== "string")) {
    return { ok: false, error: "Tags must be an array containing at most 12 strings" };
  }
  const slug = typeof input.slug === "string" && input.slug.trim()
    ? input.slug.trim().toLowerCase()
    : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/.test(slug) || slug.includes("--")) return { ok: false, error: "Slug must contain 1–120 lowercase letters, numbers, and hyphens" };
  return {
    ok: true,
    article: {
      slug,
      title,
      summary: typeof input.summary === "string" ? sanitizeArticleText(input.summary).slice(0, 500) : "",
      body,
      category: typeof input.category === "string" ? sanitizeArticleText(input.category).slice(0, 80) || "Water education" : "Water education",
      tags: tags.map((tag) => sanitizeArticleText(tag).slice(0, 40)).filter(Boolean),
      sources: sources as BlogSource[],
      rationale: typeof input.rationale === "string" ? sanitizeArticleText(input.rationale).slice(0, 1000) : undefined,
    },
  };
}

function readZipMember(bytes: Buffer, target: string): Buffer {
  let end = -1;
  for (let i = Math.max(0, bytes.length - 65_557); i <= bytes.length - 22; i += 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) end = i;
  }
  if (end < 0) throw new Error("The DOCX upload is not a valid ZIP-based Office document");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("The DOCX upload has a malformed ZIP directory");
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === target) {
      if (compressedSize > 4 * 1024 * 1024) throw new Error("The DOCX document body exceeds the 4 MB import limit");
      if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("The DOCX upload has a malformed document entry");
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(start, start + compressedSize);
      if (method === 0) return compressed;
      if (method === 8) return inflateRawSync(compressed, { maxOutputLength: 3 * 1024 * 1024 });
      throw new Error("The DOCX document uses an unsupported compression method");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("The DOCX document is missing word/document.xml");
}

function extractDocx(bytes: Buffer): string {
  const xml = readZipMember(bytes, "word/document.xml").toString("utf8");
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs.map((paragraph) => {
    const text = paragraph.replace(/<w:tab\s*\/>/g, "\t").replace(/<w:br\s*\/>/g, "\n")
      .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
    return text;
  }).join("\n\n");
}

export function parseArticleUpload(filename: unknown, base64: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof filename !== "string" || typeof base64 !== "string") {
    return { ok: false, error: "Upload requires filename and base64 content" };
  }
  const extension = filename.toLowerCase().split(".").at(-1);
  if (!["txt", "md", "docx"].includes(extension ?? "")) return { ok: false, error: "Only .txt, .md, and .docx imports are supported" };
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) || !base64) {
    return { ok: false, error: "Upload content is not valid base64" };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "Upload content is not valid base64" };
  }
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) return { ok: false, error: "Upload must be between 1 byte and 4 MB" };
  try {
    const content = extension === "docx" ? extractDocx(bytes) : bytes.toString("utf8");
    const clean = sanitizeArticleText(content);
    if (!clean) return { ok: false, error: "The uploaded file does not contain readable article text" };
    return { ok: true, text: clean };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The uploaded document could not be read" };
  }
}

function articleSlug(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
  return `${slug || "water-article"}-${randomUUID().slice(0, 8)}`;
}

export async function saveDraft(inputValue: unknown, actorId: string, origin: "human" | "upload" | "brief" | "weekly" | "agent" = "human") {
  const parsed = validateArticleInput(inputValue);
  if (!parsed.ok) throw new Error(parsed.error);
  const article = parsed.article;
  const id = randomUUID();
  const slug = origin === "human" || origin === "upload" ? article.slug : articleSlug(article.title);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO uc_blog_articles
       (id,slug,title,summary,body,category,tags,sources,origin,status,rationale,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,'draft',$10,$11,$11)`,
      [id, slug, article.title, article.summary, article.body, article.category, JSON.stringify(article.tags),
        JSON.stringify(article.sources), origin, article.rationale ?? null, actorId],
    );
    await client.query(
      `INSERT INTO uc_blog_article_history(id,article_id,actor_id,action,rationale,snapshot)
       VALUES($1,$2,$3,'created',$4,$5::jsonb)`,
      [randomUUID(), id, actorId, article.rationale ?? null, JSON.stringify(article)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return readEditorialArticle(id);
}

export async function saveMachineTopics(proposalsValue: unknown[]): Promise<unknown[]> {
  const proposals = proposalsValue.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Every topic proposal must be an object");
    const proposal = value as Record<string, unknown>;
    const topic = typeof proposal.topic === "string" ? sanitizeArticleText(proposal.topic).slice(0, 160) : "";
    const rationale = typeof proposal.rationale === "string" ? sanitizeArticleText(proposal.rationale).slice(0, 1000) : "";
    if (!topic || !rationale) throw new Error("Every topic proposal requires a topic and rationale");
    if (!Array.isArray(proposal.sources) || proposal.sources.length < 1 || proposal.sources.length > 8) {
      throw new Error("Every topic proposal requires 1 to 8 public HTTPS sources");
    }
    const sources = proposal.sources.map(safeSource);
    if (sources.some((source) => source === null)) throw new Error("Topic sources must use public HTTPS URLs and have titles");
    return { topic, rationale, sources: sources as BlogSource[] };
  });
  if (!proposals.length || proposals.length > 10) throw new Error("Submit between 1 and 10 topic proposals");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const saved = [];
    for (const proposal of proposals) {
      const [row] = (await client.query(
        `INSERT INTO uc_blog_topics(id,topic,rationale,provenance,source_url)
         VALUES($1,$2,$3,'agent',$4)
         RETURNING id,topic,rationale,provenance AS "provenance",source_url AS "sourceUrl",created_at AS "createdAt"`,
        [randomUUID(), proposal.topic, proposal.rationale, proposal.sources[0]?.url ?? null],
      )).rows;
      saved.push(row);
    }
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function saveMachineDrafts(articlesValue: unknown[]): Promise<unknown[]> {
  const articles = articlesValue.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Every submitted article must be an object");
    const candidate = value as Record<string, unknown>;
    if (!Array.isArray(candidate.sources) || candidate.sources.length < 1) {
      throw new Error("Every submitted agent article must include at least one source");
    }
    const parsed = validateArticleInput(candidate);
    if (!parsed.ok) throw new Error(parsed.error);
    const topic = typeof candidate.topic === "string" ? sanitizeArticleText(candidate.topic).slice(0, 160) : "";
    const rationale = typeof candidate.rationale === "string" ? sanitizeArticleText(candidate.rationale).slice(0, 1000) : "";
    return { article: parsed.article, topic, rationale };
  });
  if (!articles.length || articles.length > 3) throw new Error("Submit between 1 and 3 article drafts");

  const ids: string[] = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { article, topic, rationale } of articles) {
      const id = randomUUID();
      const slug = articleSlug(article.title);
      await client.query(
        `INSERT INTO uc_blog_articles
         (id,slug,title,summary,body,category,tags,sources,origin,status,rationale,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'agent','draft',$9,'external-agent','external-agent')`,
        [id, slug, article.title, article.summary, article.body, article.category,
          JSON.stringify(article.tags), JSON.stringify(article.sources), rationale || article.rationale || null],
      );
      await client.query(
        `INSERT INTO uc_blog_article_history(id,article_id,actor_id,action,rationale,snapshot)
         VALUES($1,$2,'external-agent','created',$3,$4::jsonb)`,
        [randomUUID(), id, rationale || article.rationale || null, JSON.stringify(article)],
      );
      if (topic) {
        await client.query(
          `INSERT INTO uc_blog_topics(id,topic,rationale,provenance,source_url)
           VALUES($1,$2,$3,'agent',$4)`,
          [randomUUID(), topic, rationale || article.rationale || "External agent proposed the article topic", article.sources?.[0]?.url ?? null],
        );
      }
      ids.push(id);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return Promise.all(ids.map((id) => readEditorialArticle(id)));
}

export async function readEditorialArticle(id: string) {
  const result = await pool.query(
    `SELECT id,slug,title,summary,body,category,tags,sources,origin,status,rationale,
      rejection_feedback AS "rejectionFeedback",created_by AS "createdBy",updated_by AS "updatedBy",
      published_by AS "publishedBy",version,published_at AS "publishedAt",published_snapshot AS "publishedSnapshot",
      created_at AS "createdAt",updated_at AS "updatedAt"
     FROM uc_blog_articles WHERE id=$1 LIMIT 1`, [id],
  );
  const row = result.rows[0];
  return row ? { ...row, content: row.body } : null;
}

export async function appendArticleHistory(articleId: string, actorId: string, action: string, rationale: string | null, snapshot: unknown) {
  await pool.query(
    `INSERT INTO uc_blog_article_history(id,article_id,actor_id,action,rationale,snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [randomUUID(), articleId, actorId, action, rationale, JSON.stringify(snapshot)],
  );
}

type ResearchedSource = (typeof RESEARCH_SOURCES)[number] & { excerpt: string };
export type BlogRunDependencies = {
  research?: () => Promise<ResearchedSource[]>;
  generate?: (prompt: string) => Promise<string>;
};
export type BlogRunDispatcher = (runId: string, brief?: string) => void;

const GENERAL_WATER_EDUCATION_TOPICS = [
  "How to choose and maintain a household drinking-water filter",
  "Safe household drinking-water storage and container hygiene",
  "When and how to test household drinking water",
  "Understanding water hardness, scale, and practical maintenance",
  "Reducing water waste while maintaining household hygiene",
];

function normalizeTopic(value: string): string {
  return value.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function deriveBlogRunTopics(
  turns: Array<{ userMessage: string; createdAt: Date | string }>,
  recentCount: number,
  brief?: string,
  now = new Date(),
  recentTopics: string[] = [],
): { themes: string[]; proposalTopics: string[] } {
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>();
  const topics = ["tap water safety", "water filter maintenance", "drinking-water storage", "hard water and scale"];
  for (const row of turns) {
    if (new Date(row.createdAt).getTime() <= cutoff) continue;
    const text = row.userMessage.toLowerCase();
    for (const topic of topics) {
      const terms = topic.split(" ");
      if (terms.some((term) => term.length > 3 && text.includes(term))) counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  const aggregateThemes = recentCount >= 20
    ? [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([topic, count]) => `${topic} (${count} aggregated mentions)`)
    : [];
  const covered = new Set(recentTopics.map(normalizeTopic));
  const themes = aggregateThemes.filter((topic) => !covered.has(normalizeTopic(topic)));
  const generalTopic = (): string => {
    let selected = GENERAL_WATER_EDUCATION_TOPICS[0]!;
    let leastRecentIndex = -1;
    for (const candidate of GENERAL_WATER_EDUCATION_TOPICS) {
      const lastUsedAt = recentTopics.findIndex((topic) => normalizeTopic(topic) === normalizeTopic(candidate));
      if (lastUsedAt === -1) return candidate;
      if (lastUsedAt > leastRecentIndex) {
        selected = candidate;
        leastRecentIndex = lastUsedAt;
      }
    }
    return selected;
  };
  const proposalTopics = (brief ? [brief] : themes.length ? themes : ["How to choose and maintain a household drinking-water filter"])
    .slice(0, 3);
  if (!brief && !themes.length) proposalTopics[0] = generalTopic();
  return { themes, proposalTopics };
}

export async function selectBlogRunTopics(brief?: string): Promise<{ themes: string[]; proposalTopics: string[] }> {
  const turns = await pool.query(
    `SELECT user_message AS "userMessage",created_at AS "createdAt" FROM uc_alison_turns
     WHERE created_at > now() - interval '30 days'
     ORDER BY created_at DESC LIMIT 500`,
  );
  const recentCount = Number((await pool.query(
    `SELECT count(*)::int AS count FROM uc_alison_turns WHERE created_at > now() - interval '30 days'`,
  )).rows[0]?.count ?? 0);
  const recentTopics = await pool.query(
    `SELECT topic FROM uc_blog_topics
     WHERE status='drafted' AND created_at > now() - interval '8 weeks'
     ORDER BY created_at DESC,id DESC LIMIT 50`,
  );
  return deriveBlogRunTopics(turns.rows, recentCount, brief, new Date(), recentTopics.rows.map((row) => String(row.topic)));
}

async function fetchResearchSources(): Promise<ResearchedSource[]> {
  const research = await Promise.allSettled(RESEARCH_SOURCES.map(async (source) => {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "UltraClearEditorialResearch/1.0" } });
    if (!response.ok) throw new Error(`${source.publisher} returned HTTP ${response.status} for ${source.url}`);
    const html = (await response.text()).slice(0, 1_500_000);
    const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;/g, " ")
      .replace(/\s+/g, " ").slice(0, 7_000);
    if (text.length < 300) throw new Error(`${source.publisher} returned too little usable research text`);
    return { ...source, excerpt: text };
  }));
  const collected = research.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const errors = research.flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []);
  if (!collected.length) throw new Error(`Research unavailable from all trusted sources. Retry after checking network access. ${errors.join("; ")}`);
  return collected;
}

async function generateWithAnthropic(prompt: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    system: "You are a cautious editorial assistant. Produce drafts only, never claim to approve or publish content.",
    messages: [{ role: "user", content: prompt }],
  });
  const text = message.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") throw new Error("Article generation returned no text response");
  return text.text;
}

export async function generateBlogRun(runId: string, brief?: string, dependencies: BlogRunDependencies = {}): Promise<void> {
  try {
    const claimed = await pool.query(
      "UPDATE uc_blog_runs SET status='running',started_at=now(),error=NULL WHERE id=$1 AND status='queued' RETURNING id",
      [runId],
    );
    if (!claimed.rows.length) return;
    const { themes, proposalTopics } = await selectBlogRunTopics(brief);
    const collected = await (dependencies.research ?? fetchResearchSources)();
    const prompt = `Create a small editorial batch of at most 3 article drafts for Ultra-Clear Companion, for households in Kenya. Use the supplied real research excerpts only for factual claims. Never invent facts, products, numbers, studies, citations, or source URLs. If evidence is uncertain, state the limitation clearly. Return ONLY valid JSON: {"articles":[{"title":"...","summary":"...","body":"Markdown; cite sources as [descriptive source name](exact supplied HTTPS URL), never as bare URLs or raw HTML. Links must be readable linkpoints within the prose.","category":"...","tags":["..."],"sources":[{"title":"exact supplied title","publisher":"exact supplied publisher","url":"exact supplied URL"}],"rationale":"..."}]}. Each article needs at least one relevant supplied source and 3-6 useful paragraphs. Topics: ${JSON.stringify(proposalTopics)}. ${brief ? `ProjectHub brief: ${brief}` : `Recent Alison topic aggregates (counts only; no transcripts or identifiers): ${JSON.stringify(themes)}`}\n\nRESEARCH:\n${collected.map((source) => `SOURCE ${source.title} | ${source.publisher} | ${source.url}\n${source.excerpt}`).join("\n\n")}`;
    // Deliberately pass aggregate topic labels/counts, never the underlying chat text.
    const generatedText = await (dependencies.generate ?? generateWithAnthropic)(prompt);
    const jsonStart = generatedText.indexOf("{");
    const jsonEnd = generatedText.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error("Article generator returned malformed JSON; retry the run");
    const result = JSON.parse(generatedText.slice(jsonStart, jsonEnd + 1)) as { articles?: unknown };
    if (!Array.isArray(result.articles) || result.articles.length === 0 || result.articles.length > 3) {
      throw new Error("Article generator returned no drafts or exceeded the three-article run limit");
    }
    const validDrafts = result.articles.map((candidate) => {
      const record = candidate as Record<string, unknown>;
      const sourceList = Array.isArray(record.sources) ? record.sources : [];
      const checkedSources = sourceList.map(safeSource).filter((source): source is BlogSource => source !== null);
      if (!checkedSources.length || checkedSources.some((source) =>
        !collected.some((r) => r.url === source.url && r.title === source.title && r.publisher === source.publisher))) {
        throw new Error("Generated article cited a source title, publisher, or URL not verified in this research run");
      }
      const parsed = validateArticleInput({ ...record, sources: checkedSources });
      if (!parsed.ok) throw new Error(`Generated article failed validation: ${parsed.error}`);
      const allowedUrls = new Set(checkedSources.map((source) => source.url));
      const linkedUrls = [...parsed.article.body.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((match) => match[1]);
      if (!linkedUrls.length) throw new Error("Generated article did not include an inline link to verified research");
      if (linkedUrls.some((url) => !allowedUrls.has(url!))) {
        throw new Error("Generated article linked to a URL that was not retrieved and verified in this research run");
      }
      return parsed.article;
    });
    for (const article of validDrafts) {
      await saveDraft(article, "blog-editorial-agent", brief ? "brief" : "weekly");
    }
    const runTopics = proposalTopics.map((topic, index) => ({ topic, provenance: themes.length && !brief ? "alison_aggregate" : brief ? "projecthub_brief" : "external_research", sourceUrl: collected[index % collected.length]!.url }));
    for (const topic of runTopics) {
      await pool.query(
        `INSERT INTO uc_blog_topics(id,topic,rationale,provenance,run_id,source_url,status)
         VALUES($1,$2,$3,$4,$5,$6,'drafted')`,
        [randomUUID(), topic.topic, "Selected for a sourced article draft; requires human review.", topic.provenance, runId, topic.sourceUrl],
      );
    }
    await pool.query(
      `UPDATE uc_blog_runs SET status='completed',result_summary=$2,topics=$3::jsonb,completed_at=now(),error=NULL WHERE id=$1`,
      [runId, `${validDrafts.length} sourced draft(s) created. Every draft requires editorial review.`, JSON.stringify(runTopics)],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `UPDATE uc_blog_runs SET status='failed',error=$2,result_summary='No articles were published; resolve the error and retry.',completed_at=now() WHERE id=$1`,
      [runId, message.slice(0, 2_000)],
    );
  }
}

export async function resumeQueuedBlogRuns(): Promise<number> {
  await pool.query(
    `UPDATE uc_blog_runs SET status='queued',started_at=NULL,
       error=COALESCE(error || E'\\n', '') || 'Worker stopped before completion; retrying after service restart.'
     WHERE status='running' AND (started_at IS NULL OR started_at < now() - interval '15 minutes')`,
  );
  const pending = await pool.query(
    `SELECT id,brief FROM uc_blog_runs WHERE status='queued' ORDER BY created_at ASC`,
  );
  for (const run of pending.rows) {
    void generateBlogRun(run.id, run.brief ?? undefined).catch((error) => {
      console.error("Failed to resume Companion blog run", run.id, error);
    });
  }
  return pending.rows.length;
}

export async function queueBlogRun(
  runType: "weekly" | "brief",
  runKey: string,
  actorId: string | null,
  brief?: string,
  dispatch: BlogRunDispatcher = (id, runBrief) => {
    void generateBlogRun(id, runBrief).catch((error) => {
      console.error("Failed to start Companion blog run", id, error);
    });
  },
) {
  const id = randomUUID();
  try {
    const result = await pool.query(
      `INSERT INTO uc_blog_runs(id,run_key,run_type,requested_by,brief,status) VALUES($1,$2,$3,$4,$5,'queued')
       ON CONFLICT(run_key) DO NOTHING
       RETURNING id,run_key AS "runKey",run_type AS "runType",status,requested_by AS "requestedBy",brief,
         result_summary AS "resultSummary",error,topics,created_at AS "createdAt",started_at AS "startedAt",
         completed_at AS "completedAt"`,
      [id, runKey, runType, actorId, brief ?? null],
    );
    const run = result.rows[0] ?? (await pool.query(
      `SELECT id,run_key AS "runKey",run_type AS "runType",status,requested_by AS "requestedBy",brief,
       result_summary AS "resultSummary",error,topics,created_at AS "createdAt",started_at AS "startedAt",
       completed_at AS "completedAt"
       FROM uc_blog_runs WHERE run_key=$1`, [runKey],
    )).rows[0];
    if (result.rows[0]) dispatch(id, brief);
    return { run, created: Boolean(result.rows[0]) };
  } catch (error) {
    throw new Error(`Editorial run could not be queued: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function weeklyBlogRunKey(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return `weekly:${date.toISOString().slice(0, 10)}`;
}