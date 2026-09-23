import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
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
  StartCodingRunResponse,
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

class CodingTaskNotFoundError extends Error {}
class CodingRunAlreadyActiveError extends Error {}

router.post("/ai/coding/tasks/:id/run", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await db.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(aiCodingTasksTable)
        .where(eq(aiCodingTasksTable.id, params.data.id))
        .for("update");

      if (!task) {
        throw new CodingTaskNotFoundError("Coding task not found");
      }

      const [activeRun] = await tx
        .select({ id: aiCodingRunsTable.id })
        .from(aiCodingRunsTable)
        .where(and(eq(aiCodingRunsTable.taskId, task.id), eq(aiCodingRunsTable.status, "RUNNING")))
        .limit(1);

      if (activeRun) {
        throw new CodingRunAlreadyActiveError("Coding task already has an active run");
      }

      const [createdRun] = await tx
        .insert(aiCodingRunsTable)
        .values({
          taskId: task.id,
          agentName: "Repository Analyzer",
          status: "RUNNING",
          startedAt: new Date(),
        })
        .returning();

      await tx
        .update(aiCodingTasksTable)
        .set({ status: "ANALYZING" })
        .where(eq(aiCodingTasksTable.id, task.id));

      return createdRun;
    });

    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof CodingTaskNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof CodingRunAlreadyActiveError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
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