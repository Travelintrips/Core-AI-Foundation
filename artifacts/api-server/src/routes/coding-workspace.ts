import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  aiCodeChangesTable,
  aiCodingRunsTable,
  aiCodingTasksTable,
} from "@workspace/db";
import {
  CreateCodingTaskBody,
  CreateCodingTaskResponse,
  GetCodingTaskParams,
  GetCodingTaskResponse,
  ListCodingTasksResponse,
  UpdateCodingTaskBody,
  UpdateCodingTaskParams,
  UpdateCodingTaskResponse,
} from "@workspace/api-zod";

const router = Router();

function createTaskNumber(): string {
  return `CWS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

router.get("/ai/coding/tasks", async (_req, res): Promise<void> => {
  const tasks = await db
    .select()
    .from(aiCodingTasksTable)
    .orderBy(desc(aiCodingTasksTable.createdAt));

  res.json(ListCodingTasksResponse.parse(tasks));
});

router.post("/ai/coding/tasks", async (req, res): Promise<void> => {
  const parsed = CreateCodingTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [task] = await db
    .insert(aiCodingTasksTable)
    .values({
      taskNumber: createTaskNumber(),
      projectName: parsed.data.projectName,
      repository: parsed.data.repository,
      branch: parsed.data.branch,
      instruction: parsed.data.instruction,
      priority: parsed.data.priority,
      status: "PENDING",
    })
    .returning();

  res.status(201).json(CreateCodingTaskResponse.parse(task));
});

router.get("/ai/coding/tasks/:id", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, params.data.id));

  if (!task) {
    res.status(404).json({ error: "Coding task not found" });
    return;
  }

  const [runs, changes] = await Promise.all([
    db
      .select()
      .from(aiCodingRunsTable)
      .where(eq(aiCodingRunsTable.taskId, task.id))
      .orderBy(desc(aiCodingRunsTable.startedAt)),
    db
      .select()
      .from(aiCodeChangesTable)
      .where(eq(aiCodeChangesTable.taskId, task.id))
      .orderBy(desc(aiCodeChangesTable.createdAt)),
  ]);

  res.json(GetCodingTaskResponse.parse({ task, runs, changes }));
});

router.post("/ai/coding/tasks/:id/run", async (req, res): Promise<void> => {
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, req.params.id));

  if (!task) {
    res.status(404).json({ error: "Coding task not found" });
    return;
  }

  const [run] = await db
    .insert(aiCodingRunsTable)
    .values({
      taskId: task.id,
      agentName: "Repository Analyzer",
      status: "RUNNING",
      startedAt: new Date(),
    })
    .returning();

  await db
    .update(aiCodingTasksTable)
    .set({ status: "ANALYZING" })
    .where(eq(aiCodingTasksTable.id, task.id));

  res.status(201).json(run);
});

router.patch("/ai/coding/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCodingTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {
    status: parsed.data.status,
  };
  if (parsed.data.resultSummary !== undefined) updateData.resultSummary = parsed.data.resultSummary;
  if (parsed.data.commitSha !== undefined) updateData.commitSha = parsed.data.commitSha;

  const [task] = await db
    .update(aiCodingTasksTable)
    .set(updateData)
    .where(eq(aiCodingTasksTable.id, params.data.id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Coding task not found" });
    return;
  }

  res.json(UpdateCodingTaskResponse.parse(task));
});

export default router;