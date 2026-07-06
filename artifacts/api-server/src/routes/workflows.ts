import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, aiWorkflowsTable, aiWorkflowExecutionsTable, aiAuditLogsTable } from "@workspace/db";
import {
  CreateWorkflowBody,
  UpdateWorkflowBody,
  GetWorkflowParams,
  UpdateWorkflowParams,
  DeleteWorkflowParams,
  ExecuteWorkflowParams,
  ExecuteWorkflowBody,
  ListWorkflowExecutionsQueryParams,
  GetWorkflowExecutionParams,
  ListWorkflowsResponse,
  CreateWorkflowResponse,
  GetWorkflowResponse,
  UpdateWorkflowResponse,
  DeleteWorkflowResponse,
  ExecuteWorkflowResponse,
  ListWorkflowExecutionsResponse,
  GetWorkflowExecutionResponse,
} from "@workspace/api-zod";

const router = Router();

async function logAudit(module: string, action: string, resourceId: string, resourceType: string, status: "success" | "failure" = "success", details?: object) {
  await db.insert(aiAuditLogsTable).values({ module, action, resourceId, resourceType, status, details: details ?? null });
}

router.get("/ai/workflows", async (_req, res): Promise<void> => {
  const workflows = await db.select().from(aiWorkflowsTable).orderBy(aiWorkflowsTable.createdAt);
  res.json(ListWorkflowsResponse.parse(workflows));
});

router.post("/ai/workflows", async (req, res): Promise<void> => {
  const parsed = CreateWorkflowBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [workflow] = await db.insert(aiWorkflowsTable).values({
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    status: parsed.data.status ?? "draft",
    steps: parsed.data.steps,
    triggerType: parsed.data.triggerType ?? null,
    triggerConfig: parsed.data.triggerConfig ?? null,
    defaultModelId: parsed.data.defaultModelId ?? null,
    tags: parsed.data.tags ?? [],
  }).returning();
  await logAudit("workflow", "create_workflow", String(workflow.id), "workflow");
  res.status(201).json(CreateWorkflowResponse.parse(workflow));
});

router.get("/ai/workflows/:id", async (req, res): Promise<void> => {
  const params = GetWorkflowParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [workflow] = await db.select().from(aiWorkflowsTable).where(eq(aiWorkflowsTable.id, params.data.id));
  if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json(GetWorkflowResponse.parse(workflow));
});

router.patch("/ai/workflows/:id", async (req, res): Promise<void> => {
  const params = UpdateWorkflowParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateWorkflowBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.steps !== undefined) updateData.steps = parsed.data.steps;
  if (parsed.data.triggerType !== undefined) updateData.triggerType = parsed.data.triggerType;
  if (parsed.data.triggerConfig !== undefined) updateData.triggerConfig = parsed.data.triggerConfig;
  if (parsed.data.defaultModelId !== undefined) updateData.defaultModelId = parsed.data.defaultModelId;
  if (parsed.data.tags !== undefined) updateData.tags = parsed.data.tags;
  const [workflow] = await db.update(aiWorkflowsTable).set(updateData).where(eq(aiWorkflowsTable.id, params.data.id)).returning();
  if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }
  await logAudit("workflow", "update_workflow", String(workflow.id), "workflow");
  res.json(UpdateWorkflowResponse.parse(workflow));
});

router.delete("/ai/workflows/:id", async (req, res): Promise<void> => {
  const params = DeleteWorkflowParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [workflow] = await db.delete(aiWorkflowsTable).where(eq(aiWorkflowsTable.id, params.data.id)).returning();
  if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }
  await logAudit("workflow", "delete_workflow", String(params.data.id), "workflow");
  res.sendStatus(204);
  DeleteWorkflowResponse.parse(undefined);
});

router.post("/ai/workflows/:id/execute", async (req, res): Promise<void> => {
  const params = ExecuteWorkflowParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = ExecuteWorkflowBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [workflow] = await db.select().from(aiWorkflowsTable).where(eq(aiWorkflowsTable.id, params.data.id));
  if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }

  const startTime = Date.now();
  const [execution] = await db.insert(aiWorkflowExecutionsTable).values({
    workflowId: params.data.id,
    status: "running",
    inputs: parsed.data.inputs ?? null,
  }).returning();

  // Simulate execution
  const tokensUsed = Math.floor(Math.random() * 500 + 100);
  const durationMs = Date.now() - startTime + Math.floor(Math.random() * 2000);

  const [updated] = await db.update(aiWorkflowExecutionsTable)
    .set({
      status: "completed",
      outputs: { result: "Workflow executed successfully", steps: (workflow.steps as unknown[]).length },
      tokensUsed,
      durationMs,
      completedAt: new Date(),
    })
    .where(eq(aiWorkflowExecutionsTable.id, execution.id))
    .returning();

  // Increment execution count
  await db.update(aiWorkflowsTable)
    .set({ executionCount: workflow.executionCount + 1 })
    .where(eq(aiWorkflowsTable.id, params.data.id));

  await logAudit("workflow", "execute_workflow", String(params.data.id), "workflow", "success", { executionId: execution.id, tokensUsed });

  res.json(ExecuteWorkflowResponse.parse({ ...updated, workflowName: workflow.name }));
});

router.get("/ai/workflow-executions", async (req, res): Promise<void> => {
  const query = ListWorkflowExecutionsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const executions = await db
    .select({
      id: aiWorkflowExecutionsTable.id,
      workflowId: aiWorkflowExecutionsTable.workflowId,
      workflowName: aiWorkflowsTable.name,
      status: aiWorkflowExecutionsTable.status,
      inputs: aiWorkflowExecutionsTable.inputs,
      outputs: aiWorkflowExecutionsTable.outputs,
      stepResults: aiWorkflowExecutionsTable.stepResults,
      errorMessage: aiWorkflowExecutionsTable.errorMessage,
      tokensUsed: aiWorkflowExecutionsTable.tokensUsed,
      durationMs: aiWorkflowExecutionsTable.durationMs,
      createdAt: aiWorkflowExecutionsTable.createdAt,
      completedAt: aiWorkflowExecutionsTable.completedAt,
    })
    .from(aiWorkflowExecutionsTable)
    .leftJoin(aiWorkflowsTable, eq(aiWorkflowExecutionsTable.workflowId, aiWorkflowsTable.id))
    .orderBy(aiWorkflowExecutionsTable.createdAt);

  let filtered = executions;
  if (query.data.workflowId != null) filtered = filtered.filter(e => e.workflowId === query.data.workflowId);
  if (query.data.status != null) filtered = filtered.filter(e => e.status === query.data.status);

  res.json(ListWorkflowExecutionsResponse.parse(filtered));
});

router.get("/ai/workflow-executions/:id", async (req, res): Promise<void> => {
  const params = GetWorkflowExecutionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [execution] = await db
    .select({ id: aiWorkflowExecutionsTable.id, workflowId: aiWorkflowExecutionsTable.workflowId, workflowName: aiWorkflowsTable.name, status: aiWorkflowExecutionsTable.status, inputs: aiWorkflowExecutionsTable.inputs, outputs: aiWorkflowExecutionsTable.outputs, stepResults: aiWorkflowExecutionsTable.stepResults, errorMessage: aiWorkflowExecutionsTable.errorMessage, tokensUsed: aiWorkflowExecutionsTable.tokensUsed, durationMs: aiWorkflowExecutionsTable.durationMs, createdAt: aiWorkflowExecutionsTable.createdAt, completedAt: aiWorkflowExecutionsTable.completedAt })
    .from(aiWorkflowExecutionsTable)
    .leftJoin(aiWorkflowsTable, eq(aiWorkflowExecutionsTable.workflowId, aiWorkflowsTable.id))
    .where(eq(aiWorkflowExecutionsTable.id, params.data.id));
  if (!execution) { res.status(404).json({ error: "Execution not found" }); return; }
  res.json(GetWorkflowExecutionResponse.parse(execution));
});

export default router;
