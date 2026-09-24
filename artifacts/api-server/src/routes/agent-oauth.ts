import { Router, type Request, type Response } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { db, agentOauthAuditTable, agentOauthClientsTable, agentOauthTokensTable, conversations, ucAiFeedbackTable, ucAlisonConversationsTable, ucAlisonTurnsTable, ucUsersTable } from "@workspace/db";
import { requireTeamAdmin } from "./auth.js";
import { saveMachineDrafts, saveMachineTopics } from "../lib/blog-editorial.js";

export const AGENT_SCOPES = [
  "companion.monitor.read",
  "companion.users.read",
  "interactions.read",
  "alison.read",
  "blog.submit",
] as const;
type AgentScope = typeof AGENT_SCOPES[number];
const TOKEN_TTL_SECONDS = 15 * 60;
const clientRate = new Map<string, { window: number; count: number }>();

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
type AuditExecutor = { insert: typeof db.insert };
async function audit(executor: AuditExecutor, clientId: string | null, actorId: string | null, action: string, target: string | null, scopes: string[], outcome: string): Promise<void> {
  await executor.insert(agentOauthAuditTable).values({ clientId, actorId, action, target, scopes, outcome });
}
export function parseScopes(value: unknown): AgentScope[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is AgentScope => typeof s === "string" && (AGENT_SCOPES as readonly string[]).includes(s));
}
export function hasUnknownScope(value: unknown): boolean {
  return !Array.isArray(value) || value.some((scope: unknown) => typeof scope !== "string" || !(AGENT_SCOPES as readonly string[]).includes(scope));
}
export function parseExpiry(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const expiry = new Date(value);
  return Number.isNaN(expiry.getTime()) || expiry <= new Date() ? "invalid" : expiry;
}
function hasScope(req: Request, scope: AgentScope): boolean {
  const scopes = (req as Request & { agentScopes?: string[] }).agentScopes ?? [];
  return scopes.includes(scope);
}
async function authorizeScope(req: Request, res: Response, scope: AgentScope): Promise<boolean> {
  if (!hasScope(req, scope)) {
    await audit(db, (req as Request & { agentClientId?: string }).agentClientId ?? null, null, `${req.method} ${req.path}`, null, [], "denied").catch(() => undefined);
    res.status(403).json({ error: "insufficient_scope", required_scope: scope });
    return false;
  }
  try {
    await audit(db, (req as Request & { agentClientId?: string }).agentClientId ?? null, null, `${req.method} ${req.path}`, null, (req as Request & { agentScopes?: string[] }).agentScopes ?? [], "success");
    return true;
  } catch {
    res.status(503).json({ error: "audit_unavailable" });
    return false;
  }
}
function parseBasic(req: Request): { id: string; secret: string } | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const index = decoded.indexOf(":");
    if (index < 1) return null;
    return { id: decoded.slice(0, index), secret: decoded.slice(index + 1) };
  } catch { return null; }
}

const router = Router();

router.post("/oauth/token", async (req, res): Promise<void> => {
  if (req.body?.grant_type !== "client_credentials") {
    res.status(400).json({ error: "unsupported_grant_type" }); return;
  }
  // Confidential credentials are accepted only via HTTP Basic. This avoids
  // secrets being captured in request bodies, proxies, or structured logs.
  const credentials = parseBasic(req);
  if (!credentials) { res.status(401).json({ error: "invalid_client" }); return; }
  const [client] = await db.select().from(agentOauthClientsTable).where(eq(agentOauthClientsTable.id, credentials.id)).limit(1);
  const supplied = Buffer.from(hash(credentials.secret));
  const stored = Buffer.from(client?.secretHash ?? "");
  if (!client || supplied.length !== stored.length || !timingSafeEqual(supplied, stored)
    || client.status !== "active" || (client.expiresAt && client.expiresAt <= new Date())) {
    void audit(db, credentials.id, null, "token.issue", null, [], "denied").catch(() => undefined);
    res.status(401).json({ error: "invalid_client" }); return;
  }
  const requested = req.body.scope ? String(req.body.scope).split(/\s+/) : client.scopes;
  const scopes = requested.filter((s: string): s is AgentScope => client.scopes.includes(s) && (AGENT_SCOPES as readonly string[]).includes(s));
  if (scopes.length !== requested.length) { res.status(400).json({ error: "invalid_scope" }); return; }
  const current = clientRate.get(client.id);
  const now = Date.now();
  if (current && current.window > now - 60_000 && current.count >= 30) {
    res.status(429).json({ error: "slow_down" }); return;
  }
  clientRate.set(client.id, current && current.window > now - 60_000
    ? { window: current.window, count: current.count + 1 } : { window: now, count: 1 });
  const plaintext = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.insert(agentOauthTokensTable).values({
      clientId: client.id, tokenHash: hash(plaintext), scopes, expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000),
    });
    await tx.update(agentOauthClientsTable).set({ lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(agentOauthClientsTable.id, client.id));
    await audit(tx, client.id, null, "token.issue", null, scopes, "success");
  });
  res.json({ access_token: plaintext, token_type: "Bearer", expires_in: TOKEN_TTL_SECONDS, scope: scopes.join(" ") });
});

async function requireAgent(req: Request, res: Response, next: () => void): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "invalid_token" }); return; }
  const [token] = await db.select({
    tokenId: agentOauthTokensTable.id, clientId: agentOauthTokensTable.clientId,
    scopes: agentOauthTokensTable.scopes, expiresAt: agentOauthTokensTable.expiresAt,
    revokedAt: agentOauthTokensTable.revokedAt, status: agentOauthClientsTable.status,
  }).from(agentOauthTokensTable).innerJoin(agentOauthClientsTable, eq(agentOauthClientsTable.id, agentOauthTokensTable.clientId))
    .where(eq(agentOauthTokensTable.tokenHash, hash(auth.slice(7)))).limit(1);
  if (!token || token.revokedAt || token.status !== "active" || token.expiresAt <= new Date()) {
    res.status(401).json({ error: "invalid_token" }); return;
  }
  (req as Request & { agentClientId?: string; agentScopes?: string[] }).agentClientId = token.clientId;
  (req as Request & { agentScopes?: string[] }).agentScopes = token.scopes;
  next();
}

router.get("/oauth/clients", requireTeamAdmin, async (_req, res): Promise<void> => {
  const clients = await db.select({
    id: agentOauthClientsTable.id, name: agentOauthClientsTable.name, scopes: agentOauthClientsTable.scopes,
    status: agentOauthClientsTable.status, expiresAt: agentOauthClientsTable.expiresAt,
    lastUsedAt: agentOauthClientsTable.lastUsedAt, createdAt: agentOauthClientsTable.createdAt,
  }).from(agentOauthClientsTable).orderBy(desc(agentOauthClientsTable.createdAt));
  res.json({ clients });
});

router.post("/oauth/clients", requireTeamAdmin, async (req, res): Promise<void> => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
  const requestedScopes = req.body?.scopes;
  const scopes = parseScopes(requestedScopes);
  const expiry = parseExpiry(req.body?.expiresAt);
  if (!name || !scopes.length || hasUnknownScope(requestedScopes)) { res.status(400).json({ error: "name and at least one valid scope are required; unknown scopes are rejected" }); return; }
  if (expiry === "invalid") { res.status(400).json({ error: "expiresAt must be a valid future date" }); return; }
  const id = `agent_${randomBytes(12).toString("hex")}`;
  const secret = randomBytes(32).toString("base64url");
  const actor = (req as Request & { teamUser?: { id: string } }).teamUser?.id ?? null;
  await db.transaction(async (tx) => {
    await tx.insert(agentOauthClientsTable).values({
      id, name, secretHash: hash(secret), scopes, createdBy: actor ?? "unknown",
      expiresAt: expiry,
    });
    await audit(tx, id, actor, "client.create", id, scopes, "success");
  });
  res.status(201).json({ client: { id, name, scopes }, clientSecret: secret, warning: "Store this secret now. It will never be shown again." });
});

router.post("/oauth/clients/:id/rotate", requireTeamAdmin, async (req, res): Promise<void> => {
  const secret = randomBytes(32).toString("base64url");
  const client = await db.transaction(async (tx) => {
    const [updated] = await tx.update(agentOauthClientsTable).set({ secretHash: hash(secret), updatedAt: new Date(), status: "active" })
      .where(eq(agentOauthClientsTable.id, String(req.params.id))).returning({ id: agentOauthClientsTable.id, name: agentOauthClientsTable.name, scopes: agentOauthClientsTable.scopes });
    if (updated) {
      await tx.update(agentOauthTokensTable).set({ revokedAt: new Date() })
        .where(and(eq(agentOauthTokensTable.clientId, updated.id), isNull(agentOauthTokensTable.revokedAt)));
      await audit(tx, updated.id, (req as Request & { teamUser?: { id: string } }).teamUser?.id ?? null, "client.rotate", updated.id, updated.scopes, "success");
    }
    return updated;
  });
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json({ client, clientSecret: secret, warning: "Store this secret now. It will never be shown again." });
});

router.post("/oauth/clients/:id/suspend", requireTeamAdmin, async (req, res): Promise<void> => {
  const status = req.body?.status === "revoked" ? "revoked" : "suspended";
  const client = await db.transaction(async (tx) => {
    const [updated] = await tx.update(agentOauthClientsTable).set({ status, updatedAt: new Date() })
      .where(eq(agentOauthClientsTable.id, String(req.params.id))).returning({ id: agentOauthClientsTable.id, status: agentOauthClientsTable.status });
    if (updated) {
      await tx.update(agentOauthTokensTable).set({ revokedAt: new Date() }).where(and(eq(agentOauthTokensTable.clientId, updated.id), isNull(agentOauthTokensTable.revokedAt)));
      await audit(tx, updated.id, (req as Request & { teamUser?: { id: string } }).teamUser?.id ?? null, `client.${status}`, updated.id, [], "success");
    }
    return updated;
  });
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json({ client });
});

router.get("/oauth/audit", requireTeamAdmin, async (req, res): Promise<void> => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  res.json({ audit: await db.select().from(agentOauthAuditTable).orderBy(desc(agentOauthAuditTable.createdAt)).limit(limit) });
});

router.get("/integrations/v1/monitor", requireAgent, async (req, res): Promise<void> => {
  if (!(await authorizeScope(req, res, "companion.monitor.read"))) return;
  res.json({ status: "ok", service: "companion", generatedAt: new Date().toISOString() });
});

router.get("/integrations/v1/companion/users", requireAgent, async (req, res): Promise<void> => {
  if (!(await authorizeScope(req, res, "companion.users.read"))) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const rows = await db.select({ id: ucUsersTable.id, firstName: ucUsersTable.firstName, lastName: ucUsersTable.lastName, createdAt: ucUsersTable.createdAt })
    .from(ucUsersTable).where(isNull(ucUsersTable.deletedAt)).orderBy(desc(ucUsersTable.createdAt)).limit(limit);
  res.json({ users: rows });
});

router.get("/integrations/v1/interactions", requireAgent, async (req, res): Promise<void> => {
  if (!(await authorizeScope(req, res, "interactions.read"))) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  // Conversation records predate customer ownership/consent links. Until that
  // mapping exists, agents receive operational metadata only, never content.
  const rows = await db.select({ id: conversations.id, createdAt: conversations.createdAt })
    .from(conversations).orderBy(desc(conversations.createdAt)).limit(limit);
  res.json({ interactions: rows });
});

router.get("/integrations/v1/alison/feedback", requireAgent, async (req, res): Promise<void> => {
  if (!(await authorizeScope(req, res, "alison.read"))) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const rows = await db.select({ id: ucAiFeedbackTable.id, rating: ucAiFeedbackTable.rating, createdAt: ucAiFeedbackTable.createdAt })
    .from(ucAiFeedbackTable).orderBy(desc(ucAiFeedbackTable.createdAt)).limit(limit);
  res.json({ feedback: rows });
});

type AlisonCursor = { createdAt: string; id: string };
function encodeAlisonCursor(cursor: AlisonCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
function decodeAlisonCursor(value: unknown): AlisonCursor | null | "invalid" {
  if (value === undefined) return null;
  if (typeof value !== "string") return "invalid";
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AlisonCursor>;
    const date = new Date(parsed.createdAt ?? "");
    if (!parsed.id || Number.isNaN(date.getTime())) return "invalid";
    return { id: parsed.id, createdAt: date.toISOString() };
  } catch {
    return "invalid";
  }
}

router.get("/integrations/v1/alison/chats", requireAgent, async (req, res): Promise<void> => {
  if (!(await authorizeScope(req, res, "alison.read"))) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const cursor = decodeAlisonCursor(req.query.cursor);
  if (cursor === "invalid") {
    res.status(400).json({ error: "invalid_cursor" });
    return;
  }
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cursorDate = cursor ? new Date(cursor.createdAt) : null;
  const cursorId = cursor?.id;
  const rows = await db.select({
    id: ucAlisonConversationsTable.id,
    createdAt: ucAlisonConversationsTable.createdAt,
    updatedAt: ucAlisonConversationsTable.updatedAt,
  }).from(ucAlisonConversationsTable)
    .where(and(
      gt(ucAlisonConversationsTable.createdAt, cutoff),
      cursorDate && cursorId ? or(
        lt(ucAlisonConversationsTable.createdAt, cursorDate),
        and(eq(ucAlisonConversationsTable.createdAt, cursorDate), lt(ucAlisonConversationsTable.id, cursorId)),
      ) : undefined,
    ))
    .orderBy(desc(ucAlisonConversationsTable.createdAt), desc(ucAlisonConversationsTable.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const turns = page.length ? await db.select({
    conversationId: ucAlisonTurnsTable.conversationId,
    turnId: ucAlisonTurnsTable.turnId,
    userMessage: ucAlisonTurnsTable.userMessage,
    assistantMessage: ucAlisonTurnsTable.assistantMessage,
    createdAt: ucAlisonTurnsTable.createdAt,
  }).from(ucAlisonTurnsTable)
    .where(inArray(ucAlisonTurnsTable.conversationId, page.map((chat) => chat.id)))
    .orderBy(asc(ucAlisonTurnsTable.createdAt), asc(ucAlisonTurnsTable.turnId)) : [];
  const chats = page.map((chat) => ({
    conversationId: chat.id,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messages: turns.filter((turn) => turn.conversationId === chat.id).flatMap((turn) => [
      { role: "user" as const, content: turn.userMessage, createdAt: turn.createdAt },
      { role: "assistant" as const, content: turn.assistantMessage, createdAt: turn.createdAt },
    ]),
  }));
  const last = page.at(-1);
  res.json({
    chats,
    nextCursor: rows.length > limit && last
      ? encodeAlisonCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
      : null,
  });
});

router.post("/integrations/v1/blog/topics", requireAgent, async (req, res): Promise<void> => {
  if (!(await authorizeScope(req, res, "blog.submit"))) return;
  const topics = req.body?.topics;
  if (!Array.isArray(topics) || topics.length < 1 || topics.length > 10) {
    res.status(400).json({ error: "topics must contain between 1 and 10 proposals" });
    return;
  }
  try {
    const saved = await saveMachineTopics(topics);
    res.status(201).json({ topics: saved });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Topic proposals were invalid" });
  }
});

router.post("/integrations/v1/blog/drafts", requireAgent, async (req, res): Promise<void> => {
  if (!(await authorizeScope(req, res, "blog.submit"))) return;
  const articles = req.body?.articles;
  if (!Array.isArray(articles) || articles.length < 1 || articles.length > 3) {
    res.status(400).json({ error: "articles must contain between 1 and 3 sourced drafts" });
    return;
  }
  try {
    const saved = await saveMachineDrafts(articles);
    res.status(201).json({ articles: saved, publicationRequiresAdminReview: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Agent article draft was invalid" });
  }
});

export default router;