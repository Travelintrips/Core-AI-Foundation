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
import { startCodingOrchestration } from "../services/codingOrchestratorService.js";
import { approvePlanAndStartCoding } from "../services/codingAgentService.js";
import {
  approveAndValidateLocalPatch,
  LocalPatchApprovalError,
} from "../services/localCodingPatchApprovalService.js";
import {
  approveCommitAndCreatePullRequest,
  LocalCommitApprovalError,
} from "../services/localCodingCommitApprovalService.js";
import {
  approveAndMergePullRequest,
  LocalPullRequestGateError,
  startPullRequestVerification,
} from "../services/localCodingPullRequestGateService.js";
import {
  LocalCodingSandboxGateError,
  startSandboxVerification,
} from "../services/localCodingSandboxGateService.js";
import {
  LocalDeterministicRecoveryError,
  startDeterministicLocalRecovery,
} from "../services/localCodingDeterministicRecoveryService.js";
import {
  approveAiHandoff,
  LocalAiHandoffError,
  revokeAiHandoff,
  startAiHandoffPreparation,
} from "../services/localCodingAiHandoffService.js";

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
    const { run, task } = await db.transaction(async (tx) => {
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
          agentName: "Coding Orchestrator",
          status: "RUNNING",
          startedAt: new Date(),
        })
        .returning();

      await tx
        .update(aiCodingTasksTable)
        .set({ status: "ANALYZING" })
        .where(eq(aiCodingTasksTable.id, task.id));

      return { run: createdRun, task };
    });

    try {
      await startCodingOrchestration({ task, run });
    } catch {
      res.status(503).json({ error: "Coding Orchestrator could not be started" });
      return;
    }

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

router.post("/ai/coding/tasks/:id/approve-plan", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approvePlanAndStartCoding(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Coding task not found") {
      res.status(404).json({ error: message });
      return;
    }
    if (
      message.includes("not awaiting plan approval") ||
      message.includes("APPROVE_PLAN") ||
      message.includes("approval")
    ) {
      res.status(409).json({ error: message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/approve-local-patch", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approveAndValidateLocalPatch(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalPatchApprovalError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/run-sandbox-verification", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await startSandboxVerification(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalCodingSandboxGateError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.kind === "SANDBOX_BLOCKED") {
        res.status(503).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/run-local-recovery", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await startDeterministicLocalRecovery(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalDeterministicRecoveryError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.kind === "SANDBOX_BLOCKED") {
        res.status(503).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/prepare-ai-handoff", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await startAiHandoffPreparation(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalAiHandoffError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/approve-ai-handoff", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approveAiHandoff(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalAiHandoffError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/revoke-ai-handoff", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await revokeAiHandoff(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalAiHandoffError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (
        error.kind === "NOT_READY" ||
        error.kind === "STALE_HEAD" ||
        error.kind === "EXPIRED" ||
        error.kind === "REVOKED"
      ) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/approve-commit", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approveCommitAndCreatePullRequest(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalCommitApprovalError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.kind === "GITHUB_AUTH") {
        res.status(503).json({ error: error.message });
        return;
      }
      if (error.kind === "PUBLISH_FAILED") {
        res.status(502).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/verify-pull-request", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await startPullRequestVerification(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalPullRequestGateError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "CHECKS_PENDING") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.kind === "GITHUB_AUTH") {
        res.status(503).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/approve-merge", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approveAndMergePullRequest(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalPullRequestGateError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (
        error.kind === "NOT_READY" ||
        error.kind === "CHECKS_PENDING" ||
        error.kind === "STALE_PR"
      ) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.kind === "GITHUB_AUTH") {
        res.status(503).json({ error: error.message });
        return;
      }
      if (error.kind === "MERGE_FAILED") {
        res.status(502).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
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