import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, conversations as conversationsTable, messages as messagesTable, teamUsersTable } from "@workspace/db";
import {
  ListAnthropicConversationsResponse,
  CreateAnthropicConversationBody,
  CreateAnthropicConversationResponse,
  GetAnthropicConversationParams,
  GetAnthropicConversationResponse,
  DeleteAnthropicConversationParams,
  ListAnthropicMessagesParams,
  ListAnthropicMessagesResponse,
  SendAnthropicMessageParams,
  SendAnthropicMessageBody,
} from "@workspace/api-zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { buildProjectContext } from "../ai/context";
import { requireTeamAuth } from "../auth.js";

const router: IRouter = Router();
function requireActiveTeamAuth(req: Request, res: Response, next: NextFunction): void {
  requireTeamAuth(req, res, () => {
    const userId = (req as Request & { teamUser?: { id: string } }).teamUser?.id;
    void db.select({ isActive: teamUsersTable.isActive })
      .from(teamUsersTable)
      .where(eq(teamUsersTable.id, userId ?? ""))
      .limit(1)
      .then(([user]) => {
        if (!user?.isActive) {
          res.status(401).json({ error: "Authentication required. Sign in at /login." });
          return;
        }
        next();
      })
      .catch(() => res.status(401).json({ error: "Authentication required. Sign in at /login." }));
  });
}
// Keep this guard path-scoped: the parent API router mounts this router without
// a prefix, so an unscoped router.use would also intercept unrelated routes.
router.use("/anthropic/conversations", requireActiveTeamAuth);

router.get("/anthropic/conversations", async (_req, res): Promise<void> => {
  const conversations = await db
    .select()
    .from(conversationsTable)
    .orderBy(conversationsTable.createdAt);
  res.json(ListAnthropicConversationsResponse.parse(conversations));
});

router.post("/anthropic/conversations", async (req, res): Promise<void> => {
  const normalizedBody =
    req.body && typeof req.body === "object" && typeof req.body.title === "string"
      ? { ...req.body, title: req.body.title.trim() }
      : req.body;
  const parsed = CreateAnthropicConversationBody.safeParse(normalizedBody);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.title.length === 0 || parsed.data.title.length > 80) {
    res.status(400).json({ error: "Title must be between 1 and 80 characters" });
    return;
  }
  const [conv] = await db
    .insert(conversationsTable)
    .values({ title: parsed.data.title })
    .returning();
  res.status(201).json(CreateAnthropicConversationResponse.parse(conv));
});

router.get(
  "/anthropic/conversations/:id",
  async (req, res): Promise<void> => {
    const params = GetAnthropicConversationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, params.data.id));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(messagesTable.createdAt);
    res.json(GetAnthropicConversationResponse.parse({ ...conv, messages }));
  },
);

router.delete(
  "/anthropic/conversations/:id",
  async (req, res): Promise<void> => {
    const params = DeleteAnthropicConversationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [conv] = await db
      .delete(conversationsTable)
      .where(eq(conversationsTable.id, params.data.id))
      .returning();
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.sendStatus(204);
  },
);

router.get(
  "/anthropic/conversations/:id/messages",
  async (req, res): Promise<void> => {
    const params = ListAnthropicMessagesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, params.data.id))
      .orderBy(messagesTable.createdAt);
    res.json(ListAnthropicMessagesResponse.parse(messages));
  },
);

router.post(
  "/anthropic/conversations/:id/messages",
  async (req, res): Promise<void> => {
    const params = SendAnthropicMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = SendAnthropicMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, params.data.id));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Save the user message
    await db.insert(messagesTable).values({
      conversationId: conv.id,
      role: "user",
      content: parsed.data.content,
    });

    // Fetch all messages for context
    const history = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(messagesTable.createdAt);

    // Build project context to inject as system prompt
    const projectContext = await buildProjectContext();

    const chatMessages: Array<{ role: "user" | "assistant"; content: string }> =
      history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: projectContext,
      messages: chatMessages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    // Save assistant message
    await db.insert(messagesTable).values({
      conversationId: conv.id,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  },
);

export default router;
