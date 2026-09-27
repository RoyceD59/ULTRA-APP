/**
 * Builds a rich system-prompt context string from live DB data.
 * Injected into every Claude call so the AI always has current project state.
 */
import { eq, sql } from "drizzle-orm";
import { db, projectsTable, tasksTable, membersTable } from "@workspace/db";

export async function buildProjectContext(): Promise<string> {
  const [projects, tasks, members] = await Promise.all([
    db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        status: projectsTable.status,
        dueDate: projectsTable.dueDate,
        taskCount: sql<number>`count(${tasksTable.id})`.as("task_count"),
        doneCount:
          sql<number>`count(${tasksTable.id}) filter (where ${tasksTable.status} = 'done')`.as(
            "done_count",
          ),
      })
      .from(projectsTable)
      .leftJoin(tasksTable, eq(tasksTable.projectId, projectsTable.id))
      .groupBy(projectsTable.id)
      .orderBy(projectsTable.name),
    db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        status: tasksTable.status,
        priority: tasksTable.priority,
        dueDate: tasksTable.dueDate,
        projectId: tasksTable.projectId,
        assigneeId: tasksTable.assigneeId,
      })
      .from(tasksTable)
      .orderBy(tasksTable.dueDate),
    db.select().from(membersTable).orderBy(membersTable.name),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  const projectLines = projects.map((p) => {
    const done = Number(p.doneCount);
    const total = Number(p.taskCount);
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    const overdue = tasks.filter(
      (t) =>
        t.projectId === p.id &&
        t.dueDate &&
        t.dueDate < today &&
        t.status !== "done",
    ).length;
    return `  - ${p.name} [${p.status}] — ${done}/${total} tasks done (${pct}%)${p.dueDate ? `, due ${p.dueDate}` : ""}${overdue > 0 ? `, ⚠ ${overdue} overdue` : ""}`;
  });

  const urgentTasks = tasks.filter(
    (t) => t.priority === "urgent" && t.status !== "done",
  );
  const overdueTasks = tasks.filter(
    (t) => t.dueDate && t.dueDate < today && t.status !== "done",
  );

  const memberMap = Object.fromEntries(members.map((m) => [m.id, m.name]));

  const overdueLines = overdueTasks.slice(0, 10).map((t) => {
    const assignee = t.assigneeId ? memberMap[t.assigneeId] : "Unassigned";
    return `  - "${t.title}" [${t.status}] assigned to ${assignee}, was due ${t.dueDate}`;
  });

  const urgentLines = urgentTasks.slice(0, 5).map((t) => {
    const assignee = t.assigneeId ? memberMap[t.assigneeId] : "Unassigned";
    return `  - "${t.title}" [${t.status}] assigned to ${assignee}`;
  });

  const memberLines = members.map((m) => {
    const assigned = tasks.filter(
      (t) => t.assigneeId === m.id && t.status !== "done",
    ).length;
    return `  - ${m.name} (${m.role}) — ${assigned} active tasks`;
  });

  return `You are an AI project monitor embedded in ProjectHub, a project management tool for a B2B SaaS startup team. You have access to live project data as of ${today}.

## Projects (${projects.length} total)
${projectLines.join("\n")}

## Overdue Tasks (${overdueTasks.length} total)
${overdueLines.length > 0 ? overdueLines.join("\n") : "  None — all good!"}

## Urgent Priority Tasks (${urgentTasks.length} open)
${urgentLines.length > 0 ? urgentLines.join("\n") : "  None"}

## Team Members
${memberLines.join("\n")}

When answering questions: be direct, specific, and use the data above. Mention actual project names, task titles, assignees, and dates. Flag risks proactively. Keep answers concise unless asked for detail.`;
}

export interface ProjectSnapshot {
  projects: Array<{
    id: number;
    name: string;
    status: string;
    dueDate: string | null;
    taskCount: number;
    doneCount: number;
    progressPercent: number;
    overdueCount: number;
  }>;
  totalTasks: number;
  overdueTasks: number;
  activeProjects: number;
  generatedAt: string;
}

export async function buildProjectSnapshot(): Promise<ProjectSnapshot> {
  const [projects, tasks] = await Promise.all([
    db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        status: projectsTable.status,
        dueDate: projectsTable.dueDate,
        taskCount: sql<number>`count(${tasksTable.id})`.as("task_count"),
        doneCount:
          sql<number>`count(${tasksTable.id}) filter (where ${tasksTable.status} = 'done')`.as(
            "done_count",
          ),
      })
      .from(projectsTable)
      .leftJoin(tasksTable, eq(tasksTable.projectId, projectsTable.id))
      .groupBy(projectsTable.id),
    db.select().from(tasksTable),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  const enriched = projects.map((p) => {
    const total = Number(p.taskCount);
    const done = Number(p.doneCount);
    const overdue = tasks.filter(
      (t) =>
        t.projectId === p.id &&
        t.dueDate &&
        t.dueDate < today &&
        t.status !== "done",
    ).length;
    return {
      ...p,
      taskCount: total,
      doneCount: done,
      progressPercent: total === 0 ? 0 : Math.round((done / total) * 100),
      overdueCount: overdue,
    };
  });

  const overdueTasks = tasks.filter(
    (t) => t.dueDate && t.dueDate < today && t.status !== "done",
  ).length;

  return {
    projects: enriched,
    totalTasks: tasks.length,
    overdueTasks,
    activeProjects: projects.filter((p) => p.status === "active").length,
    generatedAt: new Date().toISOString(),
  };
}
