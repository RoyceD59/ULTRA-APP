import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, projectsTable, tasksTable } from "@workspace/db";
import { toSqlDate } from "../lib/dates";
import {
  CreateProjectBody,
  CreateProjectResponse,
  GetProjectParams,
  GetProjectResponse,
  UpdateProjectParams,
  UpdateProjectBody,
  UpdateProjectResponse,
  DeleteProjectParams,
  ListProjectsResponse,
  GetProjectSummaryParams,
  GetProjectSummaryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      description: projectsTable.description,
      status: projectsTable.status,
      dueDate: projectsTable.dueDate,
      createdAt: projectsTable.createdAt,
      taskCount: sql<number>`count(${tasksTable.id})`.as("task_count"),
      doneCount:
        sql<number>`count(${tasksTable.id}) filter (where ${tasksTable.status} = 'done')`.as(
          "done_count",
        ),
    })
    .from(projectsTable)
    .leftJoin(tasksTable, eq(tasksTable.projectId, projectsTable.id))
    .groupBy(projectsTable.id)
    .orderBy(projectsTable.createdAt);

  const projects = rows.map((row) => ({
    ...row,
    taskCount: Number(row.taskCount),
    doneCount: Number(row.doneCount),
    progressPercent:
      Number(row.taskCount) === 0
        ? 0
        : Math.round((Number(row.doneCount) / Number(row.taskCount)) * 100),
  }));

  res.json(ListProjectsResponse.parse(projects));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .insert(projectsTable)
    .values({ ...parsed.data, dueDate: toSqlDate(parsed.data.dueDate) })
    .returning();

  res.status(201).json(CreateProjectResponse.parse(project));
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(GetProjectResponse.parse(project));
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .update(projectsTable)
    .set({ ...parsed.data, dueDate: toSqlDate(parsed.data.dueDate) })
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(UpdateProjectResponse.parse(project));
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .delete(projectsTable)
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/projects/:id/summary", async (req, res): Promise<void> => {
  const params = GetProjectSummaryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.projectId, params.data.id));

  const statusBreakdown: Record<string, number> = {};
  const priorityBreakdown: Record<string, number> = {};
  let doneCount = 0;
  let overdueCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const task of tasks) {
    statusBreakdown[task.status] = (statusBreakdown[task.status] ?? 0) + 1;
    priorityBreakdown[task.priority] =
      (priorityBreakdown[task.priority] ?? 0) + 1;
    if (task.status === "done") doneCount += 1;
    if (task.dueDate && task.dueDate < today && task.status !== "done") {
      overdueCount += 1;
    }
  }

  const summary = {
    projectId: params.data.id,
    totalTasks: tasks.length,
    progressPercent:
      tasks.length === 0 ? 0 : Math.round((doneCount / tasks.length) * 100),
    statusBreakdown,
    priorityBreakdown,
    overdueCount,
  };

  res.json(GetProjectSummaryResponse.parse(summary));
});

export default router;
