import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, tasksTable, membersTable, projectsTable } from "@workspace/db";
import { toSqlDate } from "../lib/dates";
import {
  CreateTaskBody,
  CreateTaskResponse,
  GetTaskParams,
  GetTaskResponse,
  UpdateTaskParams,
  UpdateTaskBody,
  UpdateTaskResponse,
  DeleteTaskParams,
  ListTasksQueryParams,
  ListTasksResponse,
} from "@workspace/api-zod";
import { sendTaskAssignmentEmail } from "../lib/notifications";

const router: IRouter = Router();

async function notifyAssignment(
  task: { id: number; title: string; projectId: number; assigneeId: number | null; dueDate: string | null },
  previousAssigneeId?: number | null,
): Promise<{ assignmentEmailStatus: "sent" | "failed" | "skipped"; assignmentEmailError: string | null }> {
  if (task.assigneeId == null || task.assigneeId === previousAssigneeId) {
    return { assignmentEmailStatus: "skipped", assignmentEmailError: null };
  }
  const [[member], [project]] = await Promise.all([
    db.select({ name: membersTable.name, email: membersTable.email }).from(membersTable).where(eq(membersTable.id, task.assigneeId)),
    db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, task.projectId)),
  ]);
  if (!member) return { assignmentEmailStatus: "failed", assignmentEmailError: "Assigned member not found" };
  if (!member.email.trim()) return { assignmentEmailStatus: "failed", assignmentEmailError: "Assigned member has no email address" };
  const result = await sendTaskAssignmentEmail({
    to: member.email.trim(),
    memberName: member.name,
    taskTitle: task.title,
    projectName: project?.name ?? "ProjectHub",
    taskId: task.id,
    dueDate: task.dueDate,
  });
  return { assignmentEmailStatus: result.status, assignmentEmailError: result.error ?? null };
}

router.get("/tasks", async (req, res): Promise<void> => {
  const query = ListTasksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [];
  if (query.data.projectId !== undefined) {
    conditions.push(eq(tasksTable.projectId, query.data.projectId));
  }
  if (query.data.assigneeId !== undefined) {
    conditions.push(eq(tasksTable.assigneeId, query.data.assigneeId));
  }
  if (query.data.status !== undefined) {
    conditions.push(eq(tasksTable.status, query.data.status));
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(tasksTable.dueDate);

  res.json(ListTasksResponse.parse(tasks));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [task] = await db
    .insert(tasksTable)
    .values({ ...parsed.data, dueDate: toSqlDate(parsed.data.dueDate) })
    .returning();

  const assignment = await notifyAssignment(task);
  res.status(201).json(CreateTaskResponse.parse({ ...task, ...assignment }));
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, params.data.id));

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json(GetTaskResponse.parse(task));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [previousTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, params.data.id));
  const [task] = await db
    .update(tasksTable)
    .set({ ...parsed.data, dueDate: toSqlDate(parsed.data.dueDate) })
    .where(eq(tasksTable.id, params.data.id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const assignment = await notifyAssignment(task, parsed.data.assigneeId === undefined ? previousTask?.assigneeId : previousTask?.assigneeId);
  res.json(UpdateTaskResponse.parse({ ...task, ...assignment }));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [task] = await db
    .delete(tasksTable)
    .where(eq(tasksTable.id, params.data.id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
