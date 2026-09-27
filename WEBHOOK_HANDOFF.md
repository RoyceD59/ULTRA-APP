# Team-Horizon Webhook → Orchestrator Handoff

Add this to `artifacts/api-server/src/routes/webhook.ts` in your **Team-AI-Embedded** repl.
It receives the ProjectHub report and injects it directly into the Orchestrator agent's conversation.

```typescript
import { Router } from "express";
import { db } from "@workspace/db"; // your Team-Horizon db import
import { agents, conversations, messages } from "@workspace/db"; // adjust to your schema exports
import { eq } from "drizzle-orm";

const router = Router();

router.post("/webhook/projecthub", async (req, res) => {
  const { source, type, report } = req.body as {
    source: string;
    type: string;
    report: {
      summary: string;
      highlights: string[];
      risks: string[];
      generatedAt: string;
    };
  };

  console.log(`[Webhook] Received '${type}' from ${source}`);

  try {
    // 1. Find the Orchestrator agent
    const orchestrator = await db
      .select()
      .from(agents)
      .where(eq(agents.name, "Orchestrator")) // adjust field name if different
      .limit(1)
      .then((r) => r[0]);

    if (!orchestrator) {
      console.warn("[Webhook] Orchestrator agent not found in DB — skipping handoff");
      return res.json({ ok: true, note: "no orchestrator agent found" });
    }

    // 2. Find or create a standing "ProjectHub Reports" conversation for the Orchestrator
    let convo = await db
      .select()
      .from(conversations)
      .where(eq(conversations.agentId, orchestrator.id))
      .orderBy(conversations.createdAt)
      .limit(1)
      .then((r) => r[0]);

    if (!convo) {
      [convo] = await db
        .insert(conversations)
        .values({ agentId: orchestrator.id, title: "ProjectHub Status Reports" })
        .returning();
    }

    // 3. Build the message content from the report
    const highlightsList = report.highlights.map((h) => `  • ${h}`).join("\n");
    const risksList      = report.risks.map((r) => `  ⚠ ${r}`).join("\n");

    const content = `[ProjectHub Status Report — ${new Date(report.generatedAt).toUTCString()}]

SUMMARY:
${report.summary}

HIGHLIGHTS:
${highlightsList || "  None"}

RISKS & BLOCKERS:
${risksList || "  None"}

Based on this report, analyse the situation and determine whether any agents should be dispatched or alerted.`;

    // 4. Insert as a user message so Claude (the Orchestrator) sees and responds
    await db.insert(messages).values({
      conversationId: convo.id,
      role: "user",
      content,
    });

    console.log(`[Webhook] Report injected into Orchestrator conversation #${convo.id}`);
    res.json({ ok: true, conversationId: convo.id });

  } catch (err) {
    console.error("[Webhook] Orchestrator handoff failed:", err);
    res.status(500).json({ ok: false, error: "Handoff failed" });
  }
});

export default router;
```

### Schema field names to verify
Check your Team-Horizon `lib/db` schema and adjust these if needed:
| This code uses | Check your actual field |
|---|---|
| `agents.name` | whatever column holds the agent name |
| `conversations.agentId` | the FK column linking conversation → agent |
| `conversations.title` | title column on conversations table |
| `messages.conversationId` | FK to conversations |
| `messages.role` | "user" / "assistant" |
| `messages.content` | message text column |
