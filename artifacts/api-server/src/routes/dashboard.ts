import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, projectsTable, tasksTable, membersTable } from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetDashboardActivityQueryParams,
  GetDashboardActivityResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable);
  const tasks = await db.select().from(tasksTable);

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const weekFromNow = new Date(today);
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const weekFromNowStr = weekFromNow.toISOString().slice(0, 10);

  const statusBreakdown: Record<string, number> = {};
  let overdueTasks = 0;
  let tasksDueThisWeek = 0;

  for (const task of tasks) {
    statusBreakdown[task.status] = (statusBreakdown[task.status] ?? 0) + 1;
    if (task.dueDate && task.status !== "done") {
      if (task.dueDate < todayStr) overdueTasks += 1;
      if (task.dueDate >= todayStr && task.dueDate <= weekFromNowStr) {
        tasksDueThisWeek += 1;
      }
    }
  }

  const summary = {
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === "active").length,
    totalTasks: tasks.length,
    overdueTasks,
    tasksDueThisWeek,
    statusBreakdown,
  };

  res.json(GetDashboardSummaryResponse.parse(summary));
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const query = GetDashboardActivityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const rows = await db
    .select({
      taskId: tasksTable.id,
      taskTitle: tasksTable.title,
      projectId: tasksTable.projectId,
      projectName: projectsTable.name,
      status: tasksTable.status,
      assigneeName: membersTable.name,
      updatedAt: tasksTable.updatedAt,
    })
    .from(tasksTable)
    .innerJoin(projectsTable, eq(projectsTable.id, tasksTable.projectId))
    .leftJoin(membersTable, eq(membersTable.id, tasksTable.assigneeId))
    .orderBy(sql`${tasksTable.updatedAt} desc`)
    .limit(query.data.limit);

  res.json(GetDashboardActivityResponse.parse(rows));
});

export default router;
