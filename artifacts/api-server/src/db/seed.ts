/**
 * Seed script — populates ProjectHub with real Team-AI-Embedded (Team-Horizon) data
 * Run: pnpm --filter @workspace/api-server run seed
 */
import {
  db,
  membersTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";

async function main() {
  console.log("🌱  Clearing existing data…");
  await db.delete(tasksTable);
  await db.delete(projectsTable);
  await db.delete(membersTable);

  // ─── Members ────────────────────────────────────────────────────────────────
  console.log("👥  Inserting team members…");
  const [jerry, orch, seo, content] = await db
    .insert(membersTable)
    .values([
      { name: "Jerry Aroyce",    email: "jerry@team-horizon.ai",     role: "Lead Engineer & Architect" },
      { name: "Orchestrator AI", email: "orchestrator@team-horizon.ai", role: "AI Orchestrator Agent" },
      { name: "SEO Agent",       email: "seo@team-horizon.ai",       role: "SEO Specialist Agent" },
      { name: "Content Agent",   email: "content@team-horizon.ai",   role: "Content Specialist Agent" },
      { name: "Analytics Agent", email: "analytics@team-horizon.ai", role: "Analytics Agent" },
    ])
    .returning();

  // ─── Projects ───────────────────────────────────────────────────────────────
  console.log("📁  Inserting projects…");
  const [orchProject, agentProject, infraProject, uiProject] = await db
    .insert(projectsTable)
    .values([
      {
        name: "AI Orchestration Layer",
        description:
          "Wire the 8 agents into a real coordinated system. Currently each agent is an independent chatbot — this project closes the gaps: webhook→Orchestrator handoff, agent-to-agent dispatch, and shared memory.",
        status: "active",
        dueDate: "2026-08-15",
      },
      {
        name: "Agent Intelligence & Prompts",
        description:
          "Harden each agent's system prompt, seed the Orchestrator with domain context, and give agents access to shared state so they can act on real campaign data rather than generic responses.",
        status: "active",
        dueDate: "2026-08-29",
      },
      {
        name: "Infrastructure & Job Queue",
        description:
          "Add a BullMQ job queue (or lightweight pub/sub) so the Orchestrator can programmatically trigger other agents and track task results. Prerequisite for true multi-agent coordination.",
        status: "planning",
        dueDate: "2026-09-05",
      },
      {
        name: "Dashboard & Mobile Polish",
        description:
          "Both the web dashboard and Expo mobile app are fully wired. This project covers UX improvements, notification support, and surfacing orchestration activity in the UI.",
        status: "planning",
        dueDate: "2026-09-19",
      },
    ])
    .returning();

  // ─── Tasks ──────────────────────────────────────────────────────────────────
  console.log("✅  Inserting tasks…");
  await db.insert(tasksTable).values([

    // ── AI Orchestration Layer ────────────────────────────────────────────────
    {
      projectId: orchProject.id,
      title: "Wire webhook → Orchestrator agent",
      description:
        "When ProjectHub pushes a status report to POST /webhook/projecthub, forward it as a user message to the Orchestrator agent's conversation so Claude analyses it and can dispatch follow-up tasks.",
      status: "in_progress",
      priority: "urgent",
      assigneeId: jerry.id,
      dueDate: "2026-07-22",
    },
    {
      projectId: orchProject.id,
      title: "Agent-to-agent dispatch endpoint",
      description:
        "Add POST /api/agents/:id/tasks so the Orchestrator can programmatically trigger another agent (e.g. instruct SEO agent to run a keyword audit) and receive the result back.",
      status: "todo",
      priority: "high",
      assigneeId: jerry.id,
      dueDate: "2026-07-30",
    },
    {
      projectId: orchProject.id,
      title: "Shared context store table",
      description:
        "Add an agent_context key/value table to the DB schema. Agents write shared state (e.g. active campaign brief, current risks) and the Orchestrator reads it before making dispatch decisions.",
      status: "todo",
      priority: "high",
      assigneeId: jerry.id,
      dueDate: "2026-08-05",
    },
    {
      projectId: orchProject.id,
      title: "Orchestrator: analyse report and dispatch agents",
      description:
        "After the Orchestrator receives a ProjectHub report via the webhook, implement the logic that parses highlights/risks and triggers the relevant specialist agents (e.g. CRO if conversion is flagged as a risk).",
      status: "todo",
      priority: "high",
      assigneeId: orch.id,
      dueDate: "2026-08-10",
    },
    {
      projectId: orchProject.id,
      title: "Activity log: record cross-agent dispatches",
      description:
        "Extend the activity table to log when the Orchestrator dispatches a task to another agent, and when results come back. Surfaced in the web dashboard activity feed.",
      status: "todo",
      priority: "medium",
      assigneeId: jerry.id,
      dueDate: "2026-08-15",
    },

    // ── Agent Intelligence & Prompts ──────────────────────────────────────────
    {
      projectId: agentProject.id,
      title: "Seed Orchestrator conversation with domain context",
      description:
        "On server start, ensure the Orchestrator agent has an active conversation seeded with the business domain brief (brand, products, KPIs) so it can make intelligent dispatch decisions from message 1.",
      status: "todo",
      priority: "high",
      assigneeId: orch.id,
      dueDate: "2026-07-28",
    },
    {
      projectId: agentProject.id,
      title: "SEO agent: keyword audit prompt & tools",
      description:
        "Update SEO agent system prompt to include instructions for running structured keyword audits. Define a schema for the output so the Orchestrator can parse and act on results.",
      status: "todo",
      priority: "medium",
      assigneeId: seo.id,
      dueDate: "2026-08-08",
    },
    {
      projectId: agentProject.id,
      title: "Content agent: brief ingestion from shared store",
      description:
        "Update Content agent to read the active campaign brief from the shared context store before generating content, so output is always aligned with current strategy.",
      status: "todo",
      priority: "medium",
      assigneeId: content.id,
      dueDate: "2026-08-15",
    },
    {
      projectId: agentProject.id,
      title: "Analytics agent: structured metrics report format",
      description:
        "Define a JSON output schema for the Analytics agent so its reports can be parsed by the Orchestrator and trigger data-driven decisions (e.g. if conversion dips below threshold, alert CRO agent).",
      status: "todo",
      priority: "medium",
      assigneeId: orch.id,
      dueDate: "2026-08-22",
    },

    // ── Infrastructure & Job Queue ────────────────────────────────────────────
    {
      projectId: infraProject.id,
      title: "Evaluate BullMQ vs lightweight pub/sub",
      description:
        "Decide between BullMQ (Redis-backed job queue with retries/scheduling) and a simple DB-backed pub/sub (no Redis dependency). Document the tradeoff and pick one before implementation.",
      status: "todo",
      priority: "high",
      assigneeId: jerry.id,
      dueDate: "2026-08-05",
    },
    {
      projectId: infraProject.id,
      title: "Implement job queue for agent tasks",
      description:
        "Once the approach is decided, implement the queue. Orchestrator enqueues jobs; worker processes pick them up, call the target agent, and write results back to the activity log.",
      status: "todo",
      priority: "high",
      assigneeId: jerry.id,
      dueDate: "2026-08-22",
    },
    {
      projectId: infraProject.id,
      title: "Agent result webhook / callback pattern",
      description:
        "Design how agent results flow back to the Orchestrator — either a callback URL in the job payload or polling the activity table. Implement and document the pattern.",
      status: "todo",
      priority: "medium",
      assigneeId: jerry.id,
      dueDate: "2026-09-05",
    },

    // ── Dashboard & Mobile Polish ─────────────────────────────────────────────
    {
      projectId: uiProject.id,
      title: "Show cross-agent dispatch events in activity feed",
      description:
        "Once orchestration is wired, the web dashboard and mobile app activity feeds should show dispatch events (Orchestrator → SEO agent) with status (pending/done/failed).",
      status: "todo",
      priority: "medium",
      assigneeId: jerry.id,
      dueDate: "2026-09-05",
    },
    {
      projectId: uiProject.id,
      title: "Orchestrator overview panel on dashboard",
      description:
        "Add a top-level panel on the web dashboard showing the Orchestrator's current plan: what agents have been dispatched, what's in the queue, what results have come back.",
      status: "todo",
      priority: "medium",
      assigneeId: jerry.id,
      dueDate: "2026-09-12",
    },
    {
      projectId: uiProject.id,
      title: "Push notifications for high-risk Orchestrator alerts",
      description:
        "When the Orchestrator flags a high-severity risk (e.g. Analytics shows revenue drop), send a push notification to the mobile app so the team is alerted immediately.",
      status: "todo",
      priority: "low",
      assigneeId: jerry.id,
      dueDate: "2026-09-19",
    },
  ]);

  console.log("✅  Seed complete — Team-AI-Embedded project data loaded.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
