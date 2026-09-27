/**
 * Proxy route: ProjectHub → Team-Horizon agent query
 * POST /api/ai/agent-query
 *
 * Forwards a question to a specific Team-Horizon agent via the
 * /api/external/agent-query endpoint on Team-Horizon, secured with
 * the shared PROJECTHUB_WEBHOOK_SECRET bearer token.
 */
import { Router, type IRouter } from "express";
const router: IRouter = Router();

const TEAM_HORIZON_URL = "https://team-horizon--jerryaroyce.replit.app";

router.post("/ai/agent-query", async (req, res): Promise<void> => {
  const { agentId, agentName, question } = req.body as {
    agentId?: number;
    agentName?: string;
    question: string;
  };

  if (!question?.trim()) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  if (!agentId && !agentName) {
    res.status(400).json({ error: "agentId or agentName is required" });
    return;
  }

  const secret = process.env.PROJECTHUB_WEBHOOK_SECRET;

  try {
    const response = await fetch(`${TEAM_HORIZON_URL}/api/external/agent-query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ agentId, agentName, question }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Team-Horizon returned ${response.status}: ${body}`);
    }

    const data = await response.json() as { answer?: string; agentName?: string };
    res.json({ answer: data.answer, agentName: data.agentName ?? agentName, question });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: message });
  }
});

// List available agents from Team-Horizon
router.get("/ai/agents", async (_req, res): Promise<void> => {
  const secret = process.env.PROJECTHUB_WEBHOOK_SECRET;

  try {
    const response = await fetch(`${TEAM_HORIZON_URL}/api/agents`, {
      headers: {
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Team-Horizon returned ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    // Return the known agent list as fallback so the UI always has something
    res.json([
      { id: 1, name: "Orchestrator",   role: "orchestrator",    status: "active" },
      { id: 2, name: "Product Data",   role: "product_data",    status: "active" },
      { id: 3, name: "SEO",            role: "seo",             status: "active" },
      { id: 4, name: "Content",        role: "content",         status: "active" },
      { id: 5, name: "CRO",            role: "cro",             status: "active" },
      { id: 6, name: "Support",        role: "support",         status: "active" },
      { id: 7, name: "Inventory",      role: "inventory",       status: "active" },
      { id: 8, name: "Analytics",      role: "analytics",       status: "active" },
    ]);
  }
});

export default router;
