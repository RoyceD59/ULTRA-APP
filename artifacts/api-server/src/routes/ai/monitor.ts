import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireTeamAuth } from "../auth.js";
import {
  AiQueryBody,
  AiQueryResponse,
  GetAiReportResponse,
  GenerateAiReportResponse,
  PushToOrchestratorResponse,
} from "@workspace/api-zod";
import { buildProjectContext, buildProjectSnapshot } from "./context";

const router: IRouter = Router();

// In-memory cache for the latest report (survives restarts via re-generation)
let latestReport: {
  summary: string;
  highlights: string[];
  risks: string[];
  generatedAt: Date;
} | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Inbound webhook: Ultra Clear AI Orchestrator asks a question
// POST /api/ai/query
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ai/query", async (req, res): Promise<void> => {
  const parsed = AiQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const systemPrompt = await buildProjectContext();

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: parsed.data.question }],
    });

    const block = message.content[0];
    const answer = block.type === "text" ? block.text : "(no text response)";

    res.json(
      AiQueryResponse.parse({
        answer,
        generatedAt: new Date(),
        source: parsed.data.source ?? "unknown",
      }),
    );
  } catch (err) {
    console.error("[ai/query] Claude error:", err);
    res.status(500).json({ error: "Failed to generate AI response" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/report — return the latest cached report (or generate one)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/ai/report", requireTeamAuth, async (_req, res): Promise<void> => {
  if (!latestReport) {
    // Auto-generate on first access
    try {
      latestReport = await generateReport();
    } catch (err) {
      console.error("[ai/report GET] generation error:", err);
      res.status(503).json({ error: "Report not yet available" });
      return;
    }
  }
  res.json(GetAiReportResponse.parse(latestReport));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/report — force-generate a fresh report
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ai/report", requireTeamAuth, async (_req, res): Promise<void> => {
  try {
    latestReport = await generateReport();
    res.json(GenerateAiReportResponse.parse(latestReport));
  } catch (err) {
    console.error("[ai/report POST] generation error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/push — manually push summary to Ultra Clear AI orchestrator
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ai/push", requireTeamAuth, async (_req, res): Promise<void> => {
  const webhookUrl = process.env.AI_ORCHESTRATOR_WEBHOOK_URL;

  try {
    const report = latestReport ?? (await generateReport());
    if (!latestReport) latestReport = report;

    const payload = {
      source: "projecthub",
      type: "project_status_report",
      report,
    };

    if (!webhookUrl) {
      // No webhook configured — return success with the payload so the user can see what would be sent
      res.json(
        PushToOrchestratorResponse.parse({
          success: true,
          message:
            "AI_ORCHESTRATOR_WEBHOOK_URL not set — report generated but not sent. Set this env var to enable automatic push to Ultra Clear AI.",
          sentAt: new Date(),
          webhookUrl: "(not configured)",
        }),
      );
      return;
    }

    const secret = process.env.PROJECTHUB_WEBHOOK_SECRET;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // X-Requested-With is required by some orchestration webhooks (e.g.
        // Team-Horizon) that use it as a lightweight CSRF guard on their end.
        "X-Requested-With": "XMLHttpRequest",
        ...(secret ? { "Authorization": `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}: ${await response.text()}`);
    }

    res.json(
      PushToOrchestratorResponse.parse({
        success: true,
        message: `Successfully pushed to Ultra Clear AI (${response.status})`,
        sentAt: new Date(),
        webhookUrl,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.json(
      PushToOrchestratorResponse.parse({
        success: false,
        message: `Push failed: ${message}`,
        sentAt: new Date(),
        webhookUrl: webhookUrl ?? "(not configured)",
      }),
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal: generate a structured AI report from live project data
// ─────────────────────────────────────────────────────────────────────────────
export async function generateReport(): Promise<typeof latestReport & object> {
  const systemPrompt = await buildProjectContext();

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Generate a concise project status report for the team. Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "summary": "2-3 sentence executive summary of overall project health",
  "highlights": ["up to 4 positive highlights or wins"],
  "risks": ["up to 4 risks, blockers, or items needing attention"]
}`,
      },
    ],
  });

  const block = message.content[0];
  const raw = block.type === "text" ? block.text : "{}";

  let parsed: { summary: string; highlights: string[]; risks: string[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fallback: extract JSON from possible prose wrapping
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : { summary: raw, highlights: [], risks: [] };
  }

  return {
    summary: parsed.summary ?? "",
    highlights: parsed.highlights ?? [],
    risks: parsed.risks ?? [],
    generatedAt: new Date(),
  };
}

export { latestReport };
export function setLatestReport(r: typeof latestReport) {
  latestReport = r;
}

export default router;
